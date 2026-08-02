import type {
  AgentProfile,
  ApiError,
  CursorPage,
  TaskDto,
  User,
} from '@agentwork/contracts';

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; status: number; error: ApiError };
export type TaskDetail = TaskDto & {
  requirement?: {
    deliverables?: unknown;
    acceptanceCriteria?: unknown;
    capabilities?: string[];
  };
  events?: Array<{
    id: string;
    type: string;
    createdAt: string;
    payload: unknown;
  }>;
  deliveries?: Array<{
    id: string;
    summary: string;
    version: number;
    submittedAt: string;
  }>;
};
export type Wallet = {
  id: string;
  ownerType: string;
  ownerId: string;
  balances: { available: string; frozen: string };
};
export type Transaction = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  entries?: Array<{ amount: string; direction: string }>;
};

const apiBase =
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:3001';

function normalizeError(status: number, body: unknown): ApiError {
  const value = body as Partial<ApiError> | undefined;
  return {
    code: value?.code ?? `HTTP_${status}`,
    message: value?.message ?? '服务暂时无法完成请求',
    details: value?.details,
    request_id: value?.request_id ?? 'unavailable',
  };
}

export async function serverApi<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const { cookies } = await import('next/headers');
  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        cookie: cookies().toString(),
        ...init?.headers,
      },
      cache: init?.cache ?? 'no-store',
    });
    const body = (await response.json().catch(() => undefined)) as T;
    return response.ok
      ? { ok: true, data: body }
      : {
          ok: false,
          status: response.status,
          error: normalizeError(response.status, body),
        };
  } catch {
    return {
      ok: false,
      status: 503,
      error: normalizeError(503, {
        message: 'API 服务暂不可达，请确认本地 API 已启动。',
      }),
    };
  }
}

export const endpoints = {
  me: () => serverApi<User>('/v1/me'),
  tasks: (query = '') => serverApi<CursorPage<TaskDetail>>(`/v1/tasks${query}`),
  task: (id: string) =>
    serverApi<TaskDetail>(`/v1/tasks/${encodeURIComponent(id)}`),
  agents: () => serverApi<AgentProfile[]>('/v1/agents'),
  agent: (slug: string) =>
    serverApi<AgentProfile>(`/v1/agents/${encodeURIComponent(slug)}`),
};

export function coin(value: string | bigint | number | undefined) {
  return BigInt(value ?? 0).toLocaleString('zh-CN');
}
export function date(value: string | Date | null | undefined) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(
        new Date(value),
      )
    : '未设置';
}
