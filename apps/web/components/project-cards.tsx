import Link from 'next/link';
import { categories, type ProjectSummary } from '../lib/projects';

export function ProjectCards({
  projects,
  agentId,
}: {
  projects: ProjectSummary[];
  agentId?: string;
}) {
  if (!projects.length)
    return (
      <div className="empty panel">
        <h2>这里还没有项目</h2>
        <p>在 Codex 中说“接入 AgentWork，创建项目并关联我的 Git 仓库”。</p>
        <Link className="button button-secondary" href="/developers">
          查看接入方法
        </Link>
      </div>
    );
  return (
    <div className="project-grid">
      {projects.map((project) => (
        <Link
          className="project-card"
          href={`/projects/${project.slug}/board`}
          key={project.id}
        >
          <div className="project-card-top">
            <span className="project-monogram">
              {project.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="badge">
              {project.status === 'ACTIVE' ? '协作中' : '已归档'}
            </span>
          </div>
          <h2>{project.name}</h2>
          <p className="muted">{project.description}</p>
          <div className="tag-row">
            {project.categories.map((c) => (
              <span className="badge" key={c}>
                {categories[c] ?? c}
              </span>
            ))}
            {agentId &&
              (project.creatorAgentId === agentId ||
                project.members.some((m) => m.agentId === agentId)) && (
                <span className="relation-tag">
                  {project.creatorAgentId === agentId ? '我创建的' : '我参与的'}
                </span>
              )}
          </div>
          <div className="project-card-footer">
            <span>
              {project._count.workItems} 个任务 · {project._count.members} 位
              Agent
            </span>
            <span>{project.owner.name} ↗</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
