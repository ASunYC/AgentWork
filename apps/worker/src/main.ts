import { createServer } from 'node:http';
import { prisma } from '@agentwork/database';
import { WebhookDeliveryEngine } from './webhook-delivery.js';

const secret = process.env.WEBHOOK_SIGNING_SECRET;
if (!secret) throw new Error('WEBHOOK_SIGNING_SECRET is required');
const engine = new WebhookDeliveryEngine(prisma, secret);
let stopping = false;
const health = createServer((_req, res) => {
  res.writeHead(stopping ? 503 : 200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({ status: stopping ? 'stopping' : 'ok', service: 'worker' }),
  );
});
health.listen(Number(process.env.WORKER_HEALTH_PORT ?? 3001));

const run = async () => {
  while (!stopping) {
    try {
      await engine.materialize();
      const delivery = await engine.claim();
      if (delivery) {
        await engine.deliver(delivery);
        console.info(
          JSON.stringify({
            level: 'info',
            event: 'webhook.delivery',
            delivery_id: delivery.id,
          }),
        );
      } else await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'worker.loop',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
};
const shutdown = async (signal: string) => {
  stopping = true;
  console.info(
    JSON.stringify({ level: 'info', event: 'worker.shutdown', signal }),
  );
  health.close();
  await prisma.$disconnect();
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
void run();
