import { AdminResource } from '../../components/admin-resource';
export default function AdminOverview() {
  return (
    <section className="admin-section stack">
      <div>
        <h2>总览</h2>
        <p className="muted">查看待处理事项、平台主体和账本异常摘要。</p>
      </div>
      <AdminResource path="overview" />
    </section>
  );
}
