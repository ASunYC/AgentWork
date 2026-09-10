import { createServer } from 'node:http';
const owner = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'atlas',
  name: 'Atlas',
  description: '开发与设计协作 Agent',
  status: 'ACTIVE',
  capabilities: [],
};
const member = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'nova',
  name: 'Nova',
  description: '设计 Agent',
  status: 'ACTIVE',
  capabilities: [],
};
const project = {
  defects: [
    {
      id: 'defect-1',
      title: '小屏幕按钮被遮挡',
      reproduction: '在手机宽度打开项目页',
      expectedBehavior: '按钮保持可见',
      environment: '390px 手机浏览器',
      severity: 'HIGH',
      status: 'IN_VERIFICATION',
      fixTaskId: 'task-1',
      sourceTaskId: null,
      resolution: '已修复，等待验证',
      version: 4,
    },
  ],
  id: '33333333-3333-4333-8333-333333333333',
  slug: 'design-system',
  name: 'Orbit 设计系统',
  description: '为 Agent 协作平台打造一致的组件、交互和视觉语言。',
  categories: ['DEVELOPMENT', 'DESIGN'],
  ownerAgentId: owner.id,
  creatorAgentId: owner.id,
  creator: owner,
  owner,
  status: 'ACTIVE',
  version: 8,
  reviewPolicy: 'INDEPENDENT',
  joinPolicy: 'OPEN',
  defaultBranch: 'main',
  members: [
    { agentId: owner.id, agent: owner, role: 'OWNER' },
    { agentId: member.id, agent: member, role: 'MEMBER' },
  ],
  _count: { members: 2, workItems: 3, defects: 1 },
  roadmaps: [
    {
      id: 'phase-1',
      title: '第一阶段：基础组件',
      description: '建立颜色规范并交付项目卡片。',
      startAt: '2026-09-10T00:00:00Z',
      endAt: '2026-09-30T00:00:00Z',
      taskCount: 2,
      completedTaskCount: 0,
    },
  ],
  workItems: [
    {
      id: 'task-1',
      title: '项目卡片组件',
      description: '实现项目与关系标签。',
      acceptanceCriteria: '手机与桌面均可阅读，关系标签准确。',
      assigneeAgentId: owner.id,
      status: 'IN_PROGRESS',
      category: 'DEVELOPMENT',
      priority: 'HIGH',
      roadmapId: 'phase-1',
      blockedReason: null,
      version: 3,
      submissions: [],
    },
    {
      id: 'task-2',
      title: '颜色与排版规范',
      description: '建立可访问的配色规范。',
      acceptanceCriteria: '色彩对比度达标。',
      assigneeAgentId: member.id,
      status: 'IN_REVIEW',
      category: 'DESIGN',
      priority: 'MEDIUM',
      roadmapId: 'phase-1',
      blockedReason: null,
      version: 4,
      submissions: [
        {
          id: 'submission-1',
          summary: '规范已提交，待独立审核。',
          evidenceUrl: 'https://example.com/design',
          reviewDecision: null,
          reviewReason: null,
          selfReviewed: false,
        },
      ],
    },
    {
      id: 'task-3',
      title: '接入使用指南',
      description: '编写 Agent 接入说明。',
      acceptanceCriteria: '新用户可按步骤完成接入。',
      assigneeAgentId: null,
      status: 'READY',
      category: 'DOCUMENTATION',
      priority: 'LOW',
      roadmapId: null,
      blockedReason: null,
      version: 2,
      submissions: [],
    },
  ],
};
createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const projectPage = url.pathname === '/v2/public/project-pages';
  const artifactPage = url.pathname === '/v2/public/artifacts/page';
  if (projectPage) url.pathname = '/v2/public/projects';
  if (artifactPage) url.pathname = '/v2/public/artifacts';
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/fixture/bump' && req.method === 'POST') {
    project.description = 'Agent 刚刚更新了项目目标';
    project.version++;
    res.end(JSON.stringify({ version: project.version }));
    return;
  }
  if (req.method !== 'GET') {
    res.statusCode = 403;
    res.end('{}');
    return;
  }
  const value =
    url.pathname === '/v2/public/projects/design-system/version'
      ? { id: project.id, version: project.version }
      : url.pathname === '/health'
        ? { status: 'ok' }
        : url.pathname === '/v1/agents'
          ? [owner, member]
          : url.pathname === '/v2/public/projects'
            ? [project]
            : url.pathname === '/v2/public/projects/design-system'
              ? project
              : url.pathname === '/v2/public/artifacts'
                ? [
                    {
                      id: 'artifact-1',
                      title: 'Orbit 视觉规范',
                      description: '经过验收的配色与排版规范',
                      categories: ['DESIGN'],
                      project: {
                        id: project.id,
                        slug: project.slug,
                        name: project.name,
                      },
                      submission: {
                        evidenceUrl: 'https://example.com/design',
                        selfReviewed: false,
                      },
                      contributions: [
                        { role: 'AUTHOR', agent: member },
                        { role: 'REVIEWER', agent: owner },
                      ],
                    },
                  ]
                : undefined;
  if (!value) res.statusCode = 404;
  let result = value;
  if (projectPage || artifactPage) {
    const category = url.searchParams.get('category');
    const q = url.searchParams.get('q');
    const items = value.filter(
      (item) =>
        (!category || item.categories.includes(category)) &&
        (!q || `${item.name ?? item.title} ${item.description}`.includes(q)),
    );
    result = { items, total: items.length, nextCursor: null };
  } else if (url.pathname === '/v2/public/projects/design-system') {
    const later = !!url.searchParams.get('taskCursor');
    result = {
      ...project,
      workItems: later
        ? project.workItems.slice(2)
        : project.workItems.slice(0, 2),
      workItemsPage: { total: 3, nextCursor: later ? null : 'task-2' },
      defectsPage: { total: 1, nextCursor: null },
    };
  }
  res.end(JSON.stringify(result ?? { message: 'Not found' }));
}).listen(3411, '127.0.0.1');
