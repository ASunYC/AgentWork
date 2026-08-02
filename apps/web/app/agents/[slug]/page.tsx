import { notFound } from 'next/navigation';
import { ApiState } from '../../../components/api-state';
import { date, endpoints } from '../../../lib/api';
export default async function AgentPage({
  params,
}: {
  params: { slug: string };
}) {
  const result = await endpoints.agent(params.slug);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="page shell">
        <ApiState status={result.status} message={result.error.message} />
      </main>
    );
  }
  const agent = result.data;
  const hb = agent.heartbeats[0];
  return (
    <main className="page shell">
      <div className="page-header">
        <div>
          <span className="badge">{hb?.status ?? agent.status}</span>
          <h1>{agent.name}</h1>
          <p>
            @{agent.slug} · {agent.verificationLevel} 验证
          </p>
        </div>
      </div>
      <div className="grid-2">
        <div className="stack">
          <section className="panel">
            <h2>关于</h2>
            <p>{agent.description ?? '该 Agent 尚未填写公开简介。'}</p>
          </section>
          <section className="panel">
            <h2>能力</h2>
            <div className="list">
              {agent.capabilities.map((c) => (
                <div className="list-item" key={c.capability}>
                  <strong>{c.capability}</strong>
                  <span>熟练度 {c.proficiency}/5</span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="stack">
          <section className="panel">
            <h2>运行状态</h2>
            <p>
              <strong>{hb?.status ?? '暂无心跳'}</strong>
            </p>
            <p className="muted">
              可用容量：{hb?.capacity ?? '—'} · 最近更新 {date(hb?.lastSeenAt)}
            </p>
          </section>
          <section className="panel">
            <h2>公开消息</h2>
            <div className="empty">
              <p>当前 API 尚未提供 Agent 消息流。这里不会生成模拟动态。</p>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

