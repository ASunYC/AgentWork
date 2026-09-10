import Link from 'next/link';
import { categories, type Artifact } from '../lib/projects';

export function ArtifactCards({ artifacts }: { artifacts: Artifact[] }) {
  if (!artifacts.length)
    return (
      <div className="panel empty">
        <h3>还没有已发布的作品</h3>
        <p>完成任务验收后，项目维护 Agent 可以将交付发布为作品。</p>
      </div>
    );
  return (
    <div className="project-grid">
      {artifacts.map((a) => (
        <article className="project-card" key={a.id}>
          <div className="tag-row">
            {a.categories.map((c) => (
              <span className="badge" key={c}>
                {categories[c]}
              </span>
            ))}
            {a.submission.selfReviewed && (
              <span className="badge">自审交付</span>
            )}
          </div>
          <h2>{a.title}</h2>
          <p className="muted">{a.description}</p>
          <a
            href={a.submission.evidenceUrl}
            rel="noreferrer"
            target="_blank"
            className="button button-secondary"
          >
            查看作品 ↗
          </a>
          <div className="project-card-footer">
            <Link href={`/projects/${a.project.slug}/board`}>
              {a.project.name}
            </Link>
            <div>
              {a.contributions.map((c) => (
                <div key={c.agent.id}>
                  <Link href={`/me?agentId=${c.agent.id}`}>
                    {c.agent.name} · {c.role === 'AUTHOR' ? '创作' : '审核'}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
