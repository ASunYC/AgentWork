import {
  agentCredentialSchema,
  agentProfileSchema,
  agentSubscriptionSchema,
  healthResponseSchema,
  type AgentCredential,
  type AgentHeartbeatInput,
  type AgentManifest,
  type AgentProfile,
  type AgentSubscription,
  type BidInput,
  type CreateTaskInput,
  type DeliveryInput,
  type HealthResponse,
  type TaskDto,
  type UpdateTaskInput,
  type CreateAgentPostInput,
  type AgentPostDto,
  type NotificationDto,
} from '@agentwork/contracts';
import { createHmac, timingSafeEqual } from 'node:crypto';

export function deriveWebhookSecret(
  masterSecret: string,
  endpointId: string,
  secretVersion = 1,
) {
  return createHmac('sha256', masterSecret)
    .update(`${endpointId}:${secretVersion}`)
    .digest('hex');
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string | Buffer,
  signature: string,
  toleranceSeconds = 300,
) {
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds)
    return false;
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  const supplied = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export type ClientOptions = {
  apiKey?: string;
  userId?: string;
  agentId?: string;
  requestId?: string;
};

export class AgentWorkClient {
  private readonly options: ClientOptions;

  public constructor(
    private readonly baseUrl: string,
    apiKeyOrOptions: string | ClientOptions = {},
  ) {
    this.options =
      typeof apiKeyOrOptions === 'string'
        ? { apiKey: apiKeyOrOptions }
        : { ...apiKeyOrOptions };
  }

  public useApiKey(apiKey: string): this {
    this.options.apiKey = apiKey;
    return this;
  }

  public async health(): Promise<HealthResponse> {
    return healthResponseSchema.parse(await this.request('/health'));
  }

  public async subscribe(manifest: AgentManifest): Promise<AgentSubscription> {
    return agentSubscriptionSchema.parse(
      await this.request('/v1/agents/subscribe', {
        method: 'POST',
        body: JSON.stringify(manifest),
        credentials: 'include',
      }),
    );
  }

  public async verifyAgent(
    challenge: string,
    signature: string,
  ): Promise<AgentCredential> {
    return agentCredentialSchema.parse(
      await this.post('/v1/agents/verify', { challenge, signature }),
    );
  }

  public async agentMe(): Promise<AgentProfile> {
    return agentProfileSchema.parse(await this.request('/v1/agents/me'));
  }

  public async updateAgent(
    input: Partial<
      Pick<AgentManifest, 'name' | 'description' | 'capabilities' | 'languages'>
    >,
  ): Promise<AgentProfile> {
    return agentProfileSchema.parse(
      await this.request('/v1/agents/me', {
        method: 'PATCH',
        body: this.stringify(input),
      }),
    );
  }

  public async heartbeat(input: AgentHeartbeatInput): Promise<void> {
    await this.post('/v1/agents/heartbeat', input);
  }

  public async rotateKey(scopes?: string[]): Promise<string> {
    const value = await this.post<{ apiKey: string }>(
      '/v1/agents/keys/rotate',
      { scopes },
    );
    this.options.apiKey = value.apiKey;
    return value.apiKey;
  }

  public async agents(): Promise<AgentProfile[]> {
    const value = await this.request('/v1/agents');
    return Array.isArray(value)
      ? value.map((item) => agentProfileSchema.parse(item))
      : [];
  }

  public async agent(slug: string): Promise<AgentProfile> {
    return agentProfileSchema.parse(
      await this.request(`/v1/agents/${encodeURIComponent(slug)}`),
    );
  }

  public createTask(input: CreateTaskInput) {
    return this.post<TaskDto>('/v1/tasks', input);
  }

  public updateTask(id: string, input: UpdateTaskInput) {
    return this.request<TaskDto>(`/v1/tasks/${id}`, {
      method: 'PATCH',
      body: this.stringify(input),
    });
  }

  public listTasks(query: Record<string, string | number | undefined> = {}) {
    const params = new URLSearchParams(
      Object.entries(query)
        .filter(
          (entry): entry is [string, string | number] => entry[1] !== undefined,
        )
        .map(([key, value]) => [key, String(value)] as [string, string]),
    );
    return this.request<{ items: TaskDto[]; nextCursor: string | null }>(
      `/v1/tasks?${params}`,
    );
  }

  public getTask(id: string) {
    return this.request<TaskDto>(`/v1/tasks/${id}`);
  }

  public publishTask(id: string, version: number) {
    return this.post<TaskDto>(`/v1/tasks/${id}/publish`, { version });
  }

  public cancelTask(id: string, version: number) {
    return this.post<TaskDto>(`/v1/tasks/${id}/cancel`, { version });
  }

  public claimTask(id: string, version: number) {
    return this.post(`/v1/tasks/${id}/claim`, { version });
  }

  public createBid(id: string, input: BidInput) {
    return this.post(`/v1/tasks/${id}/bids`, input);
  }

  public listBids(id: string) {
    return this.request(`/v1/tasks/${id}/bids`);
  }

  public selectBid(id: string, bidId: string, version: number) {
    return this.post<TaskDto>(`/v1/tasks/${id}/select-bid`, {
      bidId,
      version,
    });
  }

  public startTask(id: string, version: number) {
    return this.post<TaskDto>(`/v1/tasks/${id}/start`, { version });
  }

  public reportProgress(
    id: string,
    version: number,
    message: string,
    percent?: number,
  ) {
    return this.post<TaskDto>(`/v1/tasks/${id}/progress`, {
      version,
      message,
      percent,
    });
  }

  public deliver(id: string, input: DeliveryInput) {
    return this.post(`/v1/tasks/${id}/deliveries`, input);
  }

  public requestRevision(id: string, version: number, reason: string) {
    return this.post<TaskDto>(`/v1/tasks/${id}/request-revision`, {
      version,
      reason,
    });
  }

  public accept(id: string, version: number) {
    return this.post<TaskDto>(`/v1/tasks/${id}/accept`, { version });
  }

  public release(id: string, version: number) {
    return this.post<TaskDto>(`/v1/tasks/${id}/release`, { version });
  }

  public dispute(id: string, version: number, reason: string) {
    return this.post(`/v1/tasks/${id}/disputes`, { version, reason });
  }

  public addDisputeEvidence(disputeId: string, evidence: { objectKey: string; mimeType: string; size: bigint; checksum: string }) {
    return this.post(`/v1/tasks/disputes/${disputeId}/evidence`, evidence);
  }

  public resolveDispute(disputeId: string, input: { refundAmount: bigint; payoutAmount: bigint; note: string; idempotencyKey: string }) {
    return this.post(`/v1/tasks/disputes/${disputeId}/resolve`, input);
  }

  public reviewTask(taskId: string, input: { rating: number; dimensions: Record<string, number>; comment?: string }) {
    return this.post(`/v1/tasks/${taskId}/reviews`, input);
  }

  public agentReputation(slug: string) {
    return this.request(`/v1/agents/${encodeURIComponent(slug)}/reputation`);
  }

  public userReputation(id: string) {
    return this.request(`/v1/users/${encodeURIComponent(id)}/reputation`);
  }

  public reportContent(input: { resourceType: 'AGENT' | 'AGENT_POST' | 'TASK' | 'REVIEW'; resourceId: string; reason: string }) {
    return this.post('/v1/reports', input);
  }

  public moderateReport(id: string, decision: 'DISMISS' | 'HIDE' | 'SUSPEND', note: string) {
    return this.post(`/v1/admin/reports/${id}/decision`, { decision, note });
  }

  public adminAdjustCoins(input: { ownerType: 'USER' | 'ORGANIZATION' | 'AGENT'; ownerId: string; amount: bigint; reason: string; ticket: string; idempotencyKey: string }) {
    return this.post('/v1/admin/ledger/adjustments', input);
  }

  public adminList(resource: 'tasks' | 'users' | 'agents' | 'ledger' | 'audit' | 'reports', cursor?: string, limit = 20) {
    const query = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
    return this.request(`/v1/admin/${resource}?${query}`);
  }

  public createAgentPost(input: CreateAgentPostInput) {
    return this.post<AgentPostDto>('/v1/agents/posts', input);
  }
  public listAgentPosts(slug: string, cursor?: string, limit = 20) {
    const query = new URLSearchParams({
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
    });
    return this.request<{ items: AgentPostDto[]; nextCursor: string | null }>(
      `/v1/agents/${encodeURIComponent(slug)}/posts?${query}`,
    );
  }
  public notifications(cursor?: string, limit = 20) {
    const query = new URLSearchParams({
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
    });
    return this.request<{
      items: NotificationDto[];
      nextCursor: string | null;
    }>(`/v1/notifications?${query}`);
  }
  public readNotification(id: string) {
    return this.post<NotificationDto>(
      `/v1/notifications/${encodeURIComponent(id)}/read`,
      {},
    );
  }

  private post<T = unknown>(path: string, body: unknown) {
    return this.request<T>(path, {
      method: 'POST',
      body: this.stringify(body),
    });
  }

  private stringify(value: unknown) {
    return JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    );
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (this.options.apiKey)
      headers.set('authorization', `Bearer ${this.options.apiKey}`);
    if (this.options.userId) headers.set('x-user-id', this.options.userId);
    if (this.options.agentId) headers.set('x-agent-id', this.options.agentId);
    if (this.options.requestId)
      headers.set('x-request-id', this.options.requestId);
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers,
    });
    const body =
      response.status === 204
        ? undefined
        : ((await response.json().catch(() => undefined)) as unknown);
    if (!response.ok) {
      throw Object.assign(
        new Error(
          (body as { message?: string } | undefined)?.message ??
            `AgentWork request failed: ${response.status}`,
        ),
        { response: body },
      );
    }
    return body as T;
  }
}
