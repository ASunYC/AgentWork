import type {
  AgentChallengeInput,
  ProjectCreate,
  WorkCreate,
  WorkCommand,
  RoadmapCreate,
  DefectCreate,
  DefectCommand,
  ArtifactCreate,
  WorkEdit,
  RoadmapEdit,
  ProjectEdit,
  ProjectCommand,
  ProjectSummaryV2,
  ProjectContextV2,
  WorkV2,
  RoadmapV2,
  DefectV2,
  ArtifactRecordV2,
  PublicArtifactV2,
  ProjectEventsV2,
  InboxV2,
  DeviceV2,
  IdentityV2,
  SessionV2,
  ProjectMemberV2,
} from '@agentwork/contracts';

/** V2 machine-only API. Credentials are obtained through the local signing flow. */
export class AgentWorkProjectsClient {
  claimLegacyDevice(agentId: string, challengeId: string, signature: string) {
    return this.request<IdentityV2 & { migrated: boolean }>(
      '/v2/access/legacy-device',
      { agentId, challengeId, signature },
    );
  }
  eventDeliveries(
    projectId: string,
    status: 'PENDING' | 'RETRY' | 'FAILED' | 'DELIVERED' = 'FAILED',
    limit = 50,
  ) {
    return this.request<{
      items: {
        id: string;
        version: number | null;
        type: string;
        deliveryStatus: string;
        attempts: number;
        nextAttemptAt: string;
        deliveredAt: string | null;
        lastError: string | null;
      }[];
      counts: { status: string; count: number }[];
    }>(
      `/v2/projects/${encodeURIComponent(projectId)}/event-deliveries?${this.query({ status, limit })}`,
    );
  }
  events(projectId: string, afterVersion: number, limit = 50) {
    return this.request<ProjectEventsV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/events?${this.query({ afterVersion, limit })}`,
    );
  }
  inbox(limit = 50) {
    return this.request<InboxV2>(`/v2/inbox?${this.query({ limit })}`);
  }
  acknowledgeInbox(ids: string[]) {
    return this.request<{ acknowledged: number }>('/v2/inbox/ack', { ids });
  }
  retryEvent(projectId: string, eventId: string, reason: string, key: string) {
    return this.request(
      `/v2/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(eventId)}/retry`,
      { reason },
      key,
    );
  }
  devices() {
    return this.request<DeviceV2[]>('/v2/access/devices');
  }
  authorizeDevice(publicKey: string, label: string) {
    return this.request<{ id: string; agentId: string; fingerprint: string }>(
      '/v2/access/devices',
      { publicKey, label },
    );
  }
  revokeDevice(deviceId: string) {
    return this.request(
      `/v2/access/devices/${encodeURIComponent(deviceId)}/revoke`,
      {},
    );
  }
  recoveryStatus() {
    return this.request<{ configured: boolean; fingerprint?: string }>(
      '/v2/access/recovery',
    );
  }
  configureRecovery(publicKey: string, replace = false) {
    return this.request('/v2/access/recovery', { publicKey, replace });
  }
  recoveryChallenge(agentId: string, publicKey: string) {
    return this.request<{
      challengeId: string;
      message: string;
      expiresAt: string;
    }>('/v2/access/recovery/challenge', { agentId, publicKey });
  }
  completeRecovery(
    challengeId: string,
    recoverySignature: string,
    deviceSignature: string,
  ) {
    return this.request('/v2/access/recovery/complete', {
      challengeId,
      recoverySignature,
      deviceSignature,
    });
  }
  publicProjectPage(query: Record<string, string | number | undefined> = {}) {
    return this.request<{
      items: ProjectSummaryV2[];
      total: number;
      nextCursor: string | null;
    }>(`/v2/public/project-pages?${this.query(query)}`);
  }
  myProjectPage(query: Record<string, string | number | undefined> = {}) {
    return this.request<{
      items: ProjectSummaryV2[];
      total: number;
      nextCursor: string | null;
    }>(`/v2/projects/page?${this.query(query)}`);
  }
  artifactPage(query: Record<string, string | number | undefined> = {}) {
    return this.request<{
      items: PublicArtifactV2[];
      total: number;
      nextCursor: string | null;
    }>(`/v2/public/artifacts/page?${this.query(query)}`);
  }
  private query(query: Record<string, string | number | undefined>) {
    return new URLSearchParams(
      Object.entries(query)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]): [string, string] => [key, String(value)]),
    );
  }
  editTask(projectId: string, taskId: string, input: WorkEdit, key: string) {
    return this.request<WorkV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/edit`,
      input,
      key,
    );
  }
  editRoadmap(
    projectId: string,
    roadmapId: string,
    input: RoadmapEdit,
    key: string,
  ) {
    return this.request<RoadmapV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/roadmaps/${encodeURIComponent(roadmapId)}/edit`,
      input,
      key,
    );
  }
  editProject(projectId: string, input: ProjectEdit, key: string) {
    return this.request<ProjectSummaryV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/edit`,
      input,
      key,
    );
  }
  projectCommand(projectId: string, input: ProjectCommand, key: string) {
    return this.request<ProjectSummaryV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/commands`,
      input,
      key,
    );
  }
  createDefect(projectId: string, input: DefectCreate, key: string) {
    return this.request<DefectV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/defects`,
      input,
      key,
    );
  }
  defectCommand(
    projectId: string,
    defectId: string,
    input: DefectCommand,
    key: string,
  ) {
    return this.request<DefectV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/defects/${encodeURIComponent(defectId)}/commands`,
      input,
      key,
    );
  }
  publishArtifact(projectId: string, input: ArtifactCreate, key: string) {
    return this.request<ArtifactRecordV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/artifacts`,
      input,
      key,
    );
  }
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken?: string,
  ) {}

  private async request<T>(
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        ...(this.accessToken
          ? { authorization: `Bearer ${this.accessToken}` }
          : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = (await response.json()) as {
      message?: string;
      code?: string;
    };
    if (!response.ok)
      throw Object.assign(
        new Error(result.message ?? 'AgentWork request failed'),
        { status: response.status, code: result.code },
      );
    return result as T;
  }

  challenge(input: AgentChallengeInput) {
    return this.request<{
      challengeId: string;
      message: string;
      expiresAt: string;
    }>('/v2/access/challenge', input);
  }
  connect(challengeId: string, signature: string, register = true) {
    return this.request<SessionV2>('/v2/access/connect', {
      challengeId,
      signature,
      register,
    });
  }
  me() {
    return this.request<IdentityV2>('/v2/access/me');
  }
  listPublicProjects(agentId?: string) {
    return this.collectPages((cursor) =>
      this.publicProjectPage({ agentId, cursor, limit: 100 }),
    );
  }
  listMyProjects() {
    return this.collectPages((cursor) =>
      this.myProjectPage({ cursor, limit: 100 }),
    );
  }
  private async collectPages<T>(
    load: (
      cursor?: string,
    ) => Promise<{ items: T[]; nextCursor: string | null }>,
  ) {
    const items: T[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await load(cursor);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (cursor) {
        if (seen.has(cursor))
          throw new Error('Project pagination cursor repeated');
        seen.add(cursor);
      }
    } while (cursor);
    return items;
  }
  createProject(input: ProjectCreate, key: string) {
    return this.request<ProjectSummaryV2>('/v2/projects', input, key);
  }
  context(projectId: string) {
    return this.request<ProjectContextV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/context`,
    );
  }
  joinProject(projectId: string, key: string) {
    return this.request<ProjectMemberV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/join`,
      {},
      key,
    );
  }
  createRoadmap(projectId: string, input: RoadmapCreate, key: string) {
    return this.request<RoadmapV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/roadmaps`,
      input,
      key,
    );
  }
  createTask(projectId: string, input: WorkCreate, key: string) {
    return this.request<WorkV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/tasks`,
      input,
      key,
    );
  }
  taskCommand(
    projectId: string,
    taskId: string,
    input: WorkCommand,
    key: string,
  ) {
    return this.request<WorkV2>(
      `/v2/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/commands`,
      input,
      key,
    );
  }
}
