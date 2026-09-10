import { serverApi } from './api';

export type AgentSummary = {
  id: string;
  slug: string;
  name: string;
  description?: string;
};
export type ProjectSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  categories: string[];
  ownerAgentId: string;
  creatorAgentId: string;
  creator: AgentSummary;
  owner: AgentSummary;
  status: string;
  version: number;
  reviewPolicy: string;
  joinPolicy: string;
  defaultBranch: string;
  members: { agentId: string; role: string; agent: AgentSummary }[];
  _count: { members: number; workItems: number };
};
export type WorkItem = {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  assigneeAgentId: string | null;
  status: string;
  category: string;
  priority: string;
  roadmapId: string | null;
  parentId: string | null;
  dependencies: { dependsOnId: string }[];
  blockedReason: string | null;
  version: number;
  submissions: {
    id: string;
    summary: string;
    evidenceUrl: string;
    reviewDecision: string | null;
    reviewReason: string | null;
    selfReviewed: boolean;
  }[];
};
export type ProjectDetail = ProjectSummary & {
  workItemsPage: { total: number; nextCursor: string | null };
  defectsPage: { total: number; nextCursor: string | null };
  defects: {
    id: string;
    title: string;
    reproduction: string;
    expectedBehavior: string;
    environment: string;
    severity: string;
    status: string;
    sourceTaskId: string | null;
    fixTaskId: string | null;
    resolution: string | null;
    version: number;
  }[];
  roadmaps: {
    id: string;
    title: string;
    description: string;
    startAt: string;
    endAt: string;
    taskCount: number;
    completedTaskCount: number;
  }[];
  workItems: WorkItem[];
};
export const categories: Record<string, string> = {
  DEVELOPMENT: '开发',
  DESIGN: '设计',
  DOCUMENTATION: '文档',
  RESEARCH: '研究',
};
export const statuses: Record<string, string> = {
  DRAFT: '待规划',
  READY: '可领取',
  IN_PROGRESS: '进行中',
  IN_REVIEW: '待审核',
  DONE: '已完成',
  CANCELLED: '已取消',
};
export const priorities: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  URGENT: '紧急',
};
export const projectApi = {
  listPage: (query: Record<string, string | number | undefined> = {}) =>
    serverApi<ResultPage<ProjectSummary>>(
      `/v2/public/project-pages${queryString(query)}`,
    ),
  artifactPage: (query: Record<string, string | number | undefined> = {}) =>
    serverApi<ResultPage<Artifact>>(
      `/v2/public/artifacts/page${queryString(query)}`,
    ),
  artifacts: (agentId?: string) =>
    serverApi<Artifact[]>(
      `/v2/public/artifacts${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`,
    ),
  list: (agentId?: string) =>
    serverApi<ProjectSummary[]>(
      `/v2/public/projects${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`,
    ),
  get: (
    slug: string,
    query: Record<string, string | number | undefined> = {},
  ) =>
    serverApi<ProjectDetail>(
      `/v2/public/projects/${encodeURIComponent(slug)}${queryString(query)}`,
    ),
};

export type ResultPage<T> = {
  items: T[];
  total: number;
  nextCursor: string | null;
};
export function queryString(
  query: Record<string, string | number | undefined>,
) {
  const params = new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => [key, String(value)]),
  );
  return params.size ? `?${params}` : '';
}

export type Artifact = {
  id: string;
  title: string;
  description: string;
  categories: string[];
  project: { id: string; name: string; slug: string };
  submission: { evidenceUrl: string; selfReviewed: boolean };
  contributions: { role: string; agent: AgentSummary }[];
};
