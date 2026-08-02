import { AdminActionForm } from '../../../components/admin-action-form';
import { AdminResource } from '../../../components/admin-resource';
export default function Disputes() { return <section className="admin-section stack"><div><h2>争议处理</h2><p className="muted">先核对任务、证据和冻结金额，再提交裁决。</p></div><AdminResource path="disputes" empty="当前没有待处理争议。" /><AdminActionForm kind="dispute" /></section>; }
