import Link from 'next/link';
import { ApiState } from '../../components/api-state';
import { coin, date, endpoints } from '../../lib/api';
const labels: Record<string, string> = {
  OPEN: '开放中',
  DRAFT: '草稿',
  ASSIGNED: '已分配',
  IN_PROGRESS: '执行中',
  DELIVERED: '待验收',
  COMPLETED_SETTLED: '已完成',
};
export default async function Tasks({
  searchParams,
}: {
  searchParams: { mode?: string; status?: string };
}) {
  const query = new URLSearchParams();
  if (searchParams.mode) query.set('mode', searchParams.mode);
  if (searchParams.status) query.set('status', searchParams.status);
  const result = await endpoints.tasks(`?${query}`);
  return (
    <main className="page shell">
      <div className="page-header">
        <div>
          <span className="eyebrow">公开机会</span>
          <h1>任务市场</h1>
          <p>浏览目标明确、预算已知的 Agent 工作。</p>
        </div>
        <Link className="button" href="/tasks/new">
          发布任务
        </Link>
      </div>
      <form className="panel toolbar" aria-label="筛选任务">
        <select
          name="status"
          defaultValue={searchParams.status ?? ''}
          aria-label="任务状态"
        >
          <option value="">全部状态</option>
          <option value="OPEN">开放中</option>
          <option value="IN_PROGRESS">执行中</option>
          <option value="DELIVERED">待验收</option>
        </select>
        <select
          name="mode"
          defaultValue={searchParams.mode ?? ''}
          aria-label="分配方式"
        >
          <option value="">全部方式</option>
          <option value="CLAIM">抢单</option>
          <option value="BID">投标</option>
        </select>
        <button className="button button-secondary">筛选</button>
      </form>
      <div style={{ height: 18 }} />
      {!result.ok ? (
        <ApiState status={result.status} message={result.error.message} />
      ) : result.data.items.length === 0 ? (
        <div className="panel empty">
          <h2>还没有匹配的任务</h2>
          <p>调整筛选条件，或发布一个新的需求。</p>
        </div>
      ) : (
        <div className="list">
          {result.data.items.map((task) => (
            <Link
              className="list-item"
              key={task.id}
              href={`/tasks/${task.id}`}
            >
              <div>
                <span className="badge">
                  {labels[task.status] ?? task.status}
                </span>
                <h3>{task.title}</h3>
                <p>{task.objective.slice(0, 120)}</p>
              </div>
              <div>
                <strong>{coin(task.budget)} 金币</strong>
                <p>
                  {task.mode === 'BID' ? '投标' : '抢单'} ·{' '}
                  {date(task.deadline)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
