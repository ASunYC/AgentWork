import { createHmac } from 'node:crypto';

export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const;
export const canonicalBody = (value: unknown) => JSON.stringify(value);
export const deriveEndpointSecret = (master: string, endpointId: string, version: number) =>
  createHmac('sha256', master).update(`${endpointId}:${version}`).digest('hex');
export const signWebhook = (secret: string, timestamp: string, body: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

type Delivery = {
  id: string; attempt: number;
  event: { payload: unknown };
  endpoint: { id: string; webhookUrl: string; secretVersion: number };
};

export class WebhookDeliveryEngine {
  constructor(
    private readonly db: any,
    private readonly masterSecret: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async materialize() {
    const events = await this.db.webhookEvent.findMany({
      where: { deliveries: { none: {} } }, select: { id: true, subjectId: true }, take: 100,
    });
    for (const event of events) {
      const endpoints = await this.db.agentEndpoint.findMany({ where: { agentId: event.subjectId, verifiedAt: { not: null } }, select: { id: true } });
      for (const endpoint of endpoints) await this.db.webhookDelivery.upsert({
        where: { eventId_endpointId_attempt: { eventId: event.id, endpointId: endpoint.id, attempt: 1 } },
        create: { eventId: event.id, endpointId: endpoint.id, attempt: 1 }, update: {},
      });
    }
  }

  async claim(): Promise<Delivery | null> {
    const now = this.now();
    const candidate = await this.db.webhookDelivery.findFirst({
      where: { OR: [{ status: 'PENDING' }, { status: 'RETRYING', nextRetryAt: { lte: now } }] },
      orderBy: { createdAt: 'asc' }, include: { event: true, endpoint: true },
    });
    if (!candidate) return null;
    const claimed = await this.db.webhookDelivery.updateMany({
      where: { id: candidate.id, status: candidate.status, nextRetryAt: candidate.nextRetryAt },
      data: { status: 'PROCESSING' },
    });
    return claimed.count === 1 ? candidate : null;
  }

  async deliver(delivery: Delivery) {
    const timestamp = Math.floor(this.now().getTime() / 1000).toString();
    const payload = { ...(delivery.event.payload as object), delivery_attempt: delivery.attempt };
    const body = canonicalBody(payload);
    const secret = deriveEndpointSecret(this.masterSecret, delivery.endpoint.id, delivery.endpoint.secretVersion);
    try {
      const response = await this.fetcher(delivery.endpoint.webhookUrl, {
        method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/json', 'x-agentwork-timestamp': timestamp, 'x-agentwork-signature': `sha256=${signWebhook(secret, timestamp, body)}`, 'x-agentwork-delivery': delivery.id },
      });
      const responseBody = (await response.text()).slice(0, 4096);
      if (!response.ok) return this.fail(delivery, response.status, responseBody);
      await this.db.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'SUCCEEDED', responseCode: response.status, responseBody, deliveredAt: this.now(), nextRetryAt: null } });
    } catch (error) { await this.fail(delivery, null, error instanceof Error ? error.message : String(error)); }
  }

  private async fail(delivery: Delivery, code: number | null, body: string) {
    if (delivery.attempt >= 5) {
      await this.db.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'DEAD_LETTER', responseCode: code, responseBody: body.slice(0, 4096), nextRetryAt: null } });
      return;
    }
    const nextRetryAt = new Date(this.now().getTime() + RETRY_DELAYS_MS[delivery.attempt - 1]!);
    await this.db.$transaction(async (tx: any) => {
      await tx.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'RETRYING', responseCode: code, responseBody: body.slice(0, 4096), nextRetryAt } });
      await tx.webhookDelivery.upsert({
        where: { eventId_endpointId_attempt: { eventId: (delivery as any).eventId, endpointId: (delivery as any).endpointId, attempt: delivery.attempt + 1 } },
        create: { eventId: (delivery as any).eventId, endpointId: (delivery as any).endpointId, attempt: delivery.attempt + 1, status: 'RETRYING', nextRetryAt }, update: {},
      });
    });
  }
}
