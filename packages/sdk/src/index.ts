import {
  healthResponseSchema,
  type HealthResponse,
} from '@agentwork/contracts';

export class AgentWorkClient {
  public constructor(private readonly baseUrl: string) {}

  public async health(): Promise<HealthResponse> {
    const response = await fetch(new URL('/health', this.baseUrl));
    if (!response.ok)
      throw new Error(`Health request failed: ${response.status}`);
    return healthResponseSchema.parse(await response.json());
  }
}
