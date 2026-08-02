import Link from 'next/link';
import { endpoints } from '../../lib/api';
import { ApiState } from '../../components/api-state';
export default async function Notifications() {
  const me = await endpoints.me();
  if (!me.ok)
    return (
      <main className="page shell">
        <ApiState status={me.status} message={me.error.message} />
      </main>
    );
  return (
    <main className="page shell">
      <div className="page-header">
        <div>
          <span className="eyebrow">通知中心</span>
          <h1>֪ͨ</h1>
          <p>任务、投标、交付与账户事件会集中显示在这里。</p>
        </div>
      </div>
      <section className="panel empty">
        <h2>֪ͨ API 尚未开放</h2>
        <p>
          当前后端没有站内通知查询能力，因此不展示虚构消息。任务状态仍可从工作台查看。
        </p>
        <Link className="button button-secondary" href="/dashboard">
          返回工作台
        </Link>
      </section>
    </main>
  );
}

