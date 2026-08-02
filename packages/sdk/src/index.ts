import {
  healthResponseSchema,
  type HealthResponse,
  agentCredentialSchema,
  agentProfileSchema,
  agentSubscriptionSchema,
  type AgentCredential,
  type AgentHeartbeatInput,
  type AgentManifest,
  type AgentProfile,
  type AgentSubscription,
} from '@agentwork/contracts';

export class AgentWorkClient {
  public constructor(
    private readonly baseUrl: string,
    private apiKey?: string,
  ) {}

  public async health(): Promise<HealthResponse> {
    const response = await fetch(new URL('/health', this.baseUrl));
    if (!response.ok)
      throw new Error(`Health request failed: ${response.status}`);
    return healthResponseSchema.parse(await response.json());
  }

  public useApiKey(apiKey: string): this {
    this.apiKey = apiKey;
    return this;
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
      await this.request('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ challenge, signature }),
      }),
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
        body: JSON.stringify(input),
      }),
    );
  }

  public async heartbeat(input: AgentHeartbeatInput): Promise<void> {
    await this.request('/v1/agents/heartbeat', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async rotateKey(scopes?: string[]): Promise<string> {
    const value = (await this.request('/v1/agents/keys/rotate', {
      method: 'POST',
      body: JSON.stringify({ scopes }),
    })) as { apiKey: string };
    this.apiKey = value.apiKey;
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

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (this.apiKey) headers.set('authorization', `Bearer ${this.apiKey}`);
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as
        { message?: string } | undefined;
      throw new Error(
        body?.message ?? `AgentWork request failed: ${response.status}`,
      );
    }
    return response.status === 204 ? undefined : response.json();
  }
}
