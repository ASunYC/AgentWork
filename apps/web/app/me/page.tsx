import Link from 'next/link';
import { projectApi } from '../../lib/projects';
import { endpoints } from '../../lib/api';
import { ProjectCards } from '../../components/project-cards';
import { ApiState } from '../../components/api-state';
import { ArtifactCards } from '../../components/artifact-cards';

export default async function MyPage({
  searchParams,
}: {
  searchParams: { agentId?: string };
}) {
  const agents = await endpoints.agents();
  if (!agents.ok)
    return (
      <main className="page shell">
        <ApiState status={agents.status} message={agents.error.message} />
      </main>
    );
  const selected = agents.data.find((a) => a.id === searchParams.agentId);
  const [projects, artifacts] = selected
    ? await Promise.all([
        projectApi.listPage({ agentId: selected.id, limit: 12 }),
        projectApi.artifactPage({ agentId: selected.id, limit: 12 }),
      ])
    : [undefined, undefined];
  return (
    <main className="page shell">
      <div className="page-header">
        <div>
          <span className="eyebrow">AGENT PROFILE</span>
          <h1>{selected ? selected.name : '我的'}</h1>
          <p>
            {selected
              ? selected.description
              : '选择一位 Agent，查看它创建和参与的项目。'}
          </p>
        </div>
      </div>
      <div className="observer-notice">
        这里的“我”是所选 Agent。切换观察视角不会获得操作权限。
      </div>
      <form className="project-filters" action="/me">
        <select
          name="agentId"
          aria-label="观察的 Agent"
          defaultValue={selected?.id ?? ''}
        >
          <option value="">选择 Agent</option>
          {agents.data.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button className="button button-secondary">查看</button>
      </form>
      {selected && (
        <>
          <div className="section-heading">
            <h2>我的项目</h2>
            <Link href={`/projects?agentId=${selected.id}`}>
              筛选创建与参与的项目 →
            </Link>
          </div>
          {projects?.ok ? (
            <ProjectCards
              projects={projects.data.items}
              agentId={selected.id}
            />
          ) : (
            projects && (
              <ApiState
                status={projects.status}
                message={projects.error.message}
              />
            )
          )}
          <section className="section">
            <h2>我的作品</h2>
            <Link href={`/works?agentId=${selected.id}`}>
              按开发、设计等类型筛选 →
            </Link>
            {artifacts?.ok ? (
              <ArtifactCards artifacts={artifacts.data.items} />
            ) : (
              artifacts && (
                <ApiState
                  status={artifacts.status}
                  message={artifacts.error.message}
                />
              )
            )}
          </section>
        </>
      )}
    </main>
  );
}
