export const TRELLIS_COMPATIBILITY = {
  package: '@mindfoldhq/trellis',
  version: '0.6.16',
  format: 'task.json',
};
const statuses = {
  DRAFT: 'planning',
  READY: 'planning',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'review',
  DONE: 'completed',
  CANCELLED: 'completed',
};
const priorities = { URGENT: 'P0', HIGH: 'P1', MEDIUM: 'P2', LOW: 'P3' };
const taskName = (id) => {
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new Error('Invalid platform task identifier');
  return `aw-${id}`;
};

const managedTaskFields = [
  'id',
  'name',
  'title',
  'description',
  'status',
  'priority',
  'creator',
  'assignee',
  'createdAt',
  'completedAt',
  'children',
  'parent',
];
const canonical = (value) => {
  if (Array.isArray(value))
    return value.every((v) => typeof v === 'string')
      ? [...value].sort()
      : value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};
const controlled = (task) =>
  JSON.stringify(
    canonical({
      ...Object.fromEntries(managedTaskFields.map((key) => [key, task[key]])),
      agentwork: task.meta?.agentwork,
    }),
  );

/** Preserve Trellis-native branch, scope, notes and unrelated metadata while
 * detecting local edits to fields whose authority is the platform. */
export function mergeTrellisTask(generated, current, baseline) {
  const next = JSON.parse(generated);
  const local = JSON.parse(current);
  const previous = JSON.parse(baseline);
  const conflict =
    controlled(local) !== controlled(previous) &&
    controlled(local) !== controlled(next);
  const merged = {
    ...next,
    ...local,
    ...Object.fromEntries(managedTaskFields.map((key) => [key, next[key]])),
    meta: { ...local.meta, agentwork: next.meta.agentwork },
  };
  return { content: `${JSON.stringify(merged, null, 2)}\n`, conflict };
}

/** An original interoperability adapter; no upstream framework code or hooks are installed. */
export function trellisFiles(snapshot) {
  const project = snapshot.project;
  if (
    !project ||
    !Number.isSafeInteger(snapshot.snapshotVersion) ||
    snapshot.snapshotVersion !== project.version
  )
    throw new Error('A consistent versioned project snapshot is required');
  const files = {};
  const children = new Map();
  for (const task of project.workItems) {
    if (!task.parentId) continue;
    const names = children.get(task.parentId) ?? [];
    names.push(taskName(task.id));
    children.set(task.parentId, names);
  }
  for (const task of project.workItems) {
    if (!statuses[task.status]) throw new Error('Unknown platform task state');
    const name = taskName(task.id);
    const taskFile = {
      id: name,
      name,
      title:
        task.status === 'CANCELLED' ? `[已取消] ${task.title}` : task.title,
      description: task.description,
      status: statuses[task.status],
      dev_type:
        task.category === 'DEVELOPMENT'
          ? 'fullstack'
          : task.category === 'DOCUMENTATION'
            ? 'docs'
            : null,
      scope: null,
      package: null,
      priority: priorities[task.priority],
      creator: task.creatorAgentId,
      assignee: task.assigneeAgentId,
      createdAt: task.createdAt?.slice(0, 10) ?? null,
      completedAt: ['DONE', 'CANCELLED'].includes(task.status)
        ? (task.updatedAt?.slice(0, 10) ?? null)
        : null,
      branch: null,
      base_branch: project.defaultBranch,
      worktree_path: null,
      commit: null,
      pr_url: null,
      subtasks: [],
      children: (children.get(task.id) ?? []).sort(),
      parent: task.parentId ? taskName(task.parentId) : null,
      relatedFiles: [],
      notes:
        task.status === 'CANCELLED'
          ? '已在 AgentWork 取消。Trellis 侧归入关闭状态，不表示验收完成。'
          : '状态通过 AgentWork 命令修改；编辑本文件不会领取或验收任务。',
      meta: {
        agentwork: {
          projectId: project.id,
          taskId: task.id,
          version: task.version,
          status: task.status,
          category: task.category,
          acceptanceCriteria: task.acceptanceCriteria,
          dependsOnIds: (task.dependencies ?? [])
            .map((d) => d.dependsOnId)
            .sort(),
        },
      },
    };
    files[`.trellis/tasks/${name}/task.json`] =
      `${JSON.stringify(taskFile, null, 2)}\n`;
    files[`.trellis/tasks/${name}/prd.md`] =
      `# ${task.title}\n\n## 目标\n\n${task.description}\n\n## 验收标准\n\n${task.acceptanceCriteria}\n\n## 平台记录\n\n任务 ID：${task.id}\n版本：${task.version}\n状态：${task.status}\n`;
  }
  files['.trellis/spec/agentwork/index.md'] =
    `# ${project.name}\n\n${project.description}\n\n## 协作规则\n\n平台状态为准；所有写操作使用 Agent 身份、权限和版本检查。本地文件用于执行上下文，不自动产生领取或验收。\n\n## Roadmap\n\n${project.roadmaps.map((r) => `### ${r.title}\n\n${r.description}\n\n${r.startAt.slice(0, 10)} — ${r.endAt.slice(0, 10)}\n`).join('\n') || '尚未建立 Roadmap。\n'}`;
  files['.trellis/agentwork.json'] =
    `${JSON.stringify({ adapterVersion: 1, compatibility: TRELLIS_COMPATIBILITY, projectId: project.id, snapshotVersion: snapshot.snapshotVersion, note: 'AgentWork task-file adapter only; upstream CLI, hooks and skills are not installed.' }, null, 2)}\n`;
  return files;
}
