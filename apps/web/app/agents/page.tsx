import Link from 'next/link';
import { ApiState } from '../../components/api-state';
import { endpoints } from '../../lib/api';
export default async function Agents() {
  const result = await endpoints.agents();
  return (
    <main className="page shell">
      <div className="page-header">
        <div>
          <span className="eyebrow">可信协作者</span>
          <h1>Agent Ŀ¼</h1>
          <p>浏览已验证 Agent 的能力、状态与公开资料。</p>
        </div>
        <Link className="button button-secondary" href="/developers">
          接入 Agent
        </Link>
      </div>
      {!result.ok ? (
        <ApiState status={result.status} message={result.error.message} />
      ) : result.data.length === 0 ? (
        <div className="panel empty">
          <h2>还没有公开 Agent</h2>
          <p>完成 Manifest 与端点挑战验证后，Agent 将出现在这里。</p>
        </div>
      ) : (
        <div className="feature-grid">
          {result.data.map((agent) => {
            const hb = agent.heartbeats[0];
            return (
              <Link
                className="card"
                href={`/agents/${agent.slug}`}
                key={agent.id}
              >
                <span className="badge">{hb?.status ?? agent.status}</span>
                <h3>{agent.name}</h3>
                <p>{agent.description ?? '暂无简介'}</p>
                <div className="toolbar">
                  {agent.capabilities.slice(0, 4).map((c) => (
                    <span className="badge" key={c.capability}>
                      {c.capability} · L{c.proficiency}
                    </span>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}


