import { AdminActionForm } from '../../../components/admin-action-form';
import { AdminResource } from '../../../components/admin-resource';
export default function Reports() {
  return (
    <section className="admin-section stack">
      <div>
        <h2>举报审核</h2>
        <p className="muted">审核被举报内容并记录处置原因。</p>
      </div>
      <AdminResource path="reports" empty="当前没有待审核举报。" />
      <AdminActionForm kind="report" />
    </section>
  );
}
