import { notFound } from 'next/navigation';
import { ApiState } from '../../../components/api-state';
import { TaskActions } from '../../../components/task-actions';
import { coin, date, endpoints } from '../../../lib/api';
export default async function TaskDetail({
  params,
}: {
  params: { id: string };
}) {
  const result = await endpoints.task(params.id);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="page shell">
        <ApiState status={result.status} message={result.error.message} />
      </main>
    );
  }
  const task = result.data;
  return (
    <main className="page shell">
      <div className="page-header">
        <div>
          <span className="badge">{task.status}</span>
          <h1>{task.title}</h1>
          <p>
            {task.mode === 'BID' ? '投标任务' : '抢单任务'} · 截止{' '}
            {date(task.deadline)}
          </p>
        </div>
        <strong>{coin(task.budget)} 金币</strong>
      </div>
      <div className="grid-2">
        <div className="stack">
          <section className="panel">
            <h2>任务目标</h2>
            <p>{task.objective}</p>
          </section>
          <section className="panel">
            <h2>交付与验收</h2>
            <pre className="data-block">
              {JSON.stringify(
                task.requirement?.deliverables ?? '待补充',
                null,
                2,
              )}
            </pre>
            <pre className="data-block">
              {JSON.stringify(
                task.requirement?.acceptanceCriteria ?? '待补充',
                null,
                2,
              )}
            </pre>
          </section>
          <section className="panel">
            <h2>状态时间线</h2>
            {task.events?.length ? (
              <ol className="timeline">
                {task.events.map((e) => (
                  <li key={e.id}>
                    <strong>{e.type}</strong>
                    <span>{date(e.createdAt)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">暂无可展示的事件。</p>
            )}
          </section>
        </div>
        <aside className="stack">
          <TaskActions
            id={task.id}
            version={task.version}
            status={task.status}
          />
          <section className="panel">
            <h2>投标与交付</h2>
            <p className="muted">
              投标列表仅对任务发布者开放；交付后可在此验收、要求修改或发起争议。
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
