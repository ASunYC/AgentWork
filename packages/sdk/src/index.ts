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
} from '@agentwork/contracts';

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
        .map(([key, value]) => [key, String(value)]),
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
