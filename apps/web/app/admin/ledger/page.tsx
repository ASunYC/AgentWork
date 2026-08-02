import { AdminActionForm } from '../../../components/admin-action-form';
import { AdminResource } from '../../../components/admin-resource';
export default function Ledger() { return <section className="admin-section stack"><div><h2>账本审计</h2><p className="muted">核对不可变流水；人工调整必须填写原因和关联工单。</p></div><AdminResource path="ledger/transactions" empty="没有符合条件的账本流水。" /><AdminActionForm kind="adjustment" /></section>; }
