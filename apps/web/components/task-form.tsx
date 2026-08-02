'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
export function TaskForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const f = new FormData(e.currentTarget);
    const budget = String(f.get('budget') ?? '');
    if (!/^\d+$/.test(budget) || BigInt(budget) <= 0n) {
      setError('预算必须是大于 0 的整数金币');
      return;
    }
    const payload = {
      title: f.get('title'),
      objective: f.get('objective'),
      mode: f.get('mode'),
      visibility: 'PUBLIC',
      budget,
      deadline: f.get('deadline')
        ? new Date(String(f.get('deadline'))).toISOString()
        : undefined,
      maxRevisions: Number(f.get('maxRevisions')),
      deliverables: { description: f.get('deliverables') },
      acceptanceCriteria: { description: f.get('acceptanceCriteria') },
      capabilities: String(f.get('capabilities') ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    };
    setBusy(true);
    try {
      const r = await fetch('/api/backend/tasks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const body = (await r.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };
      if (!r.ok) {
        setError(
          r.status === 401
            ? '任务 API 尚未接入发布者会话。草稿未创建，也未使用临时身份头。'
            : (body.message ?? '创建失败'),
        );
        return;
      }
      if (!body.id) {
        setError('API 返回的数据缺少任务 ID');
        return;
      }
      router.push(`/tasks/${body.id}`);
    } catch {
      setError('API 服务暂不可达，草稿未创建');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <section className="panel stack">
        <h2>1. 描述需求</h2>
        <div className="form-field">
          <label htmlFor="title">任务标题</label>
          <input id="title" name="title" required maxLength={200} />
        </div>
        <div className="form-field">
          <label htmlFor="objective">目标</label>
          <textarea
            id="objective"
            name="objective"
            required
            maxLength={20000}
          />
        </div>
        <div className="form-field">
          <label htmlFor="deliverables">期望交付物</label>
          <textarea id="deliverables" name="deliverables" required />
        </div>
      </section>
      <section className="panel stack">
        <h2>2. 定义验收</h2>
        <div className="form-field">
          <label htmlFor="acceptanceCriteria">验收标准</label>
          <textarea
            id="acceptanceCriteria"
            name="acceptanceCriteria"
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="capabilities">所需能力</label>
          <input
            id="capabilities"
            name="capabilities"
            placeholder="research, coding（逗号分隔）"
          />
        </div>
      </section>
      <section className="panel stack">
        <h2>3. 预算与分配</h2>
        <div className="grid-2">
          <div className="form-field">
            <label htmlFor="budget">预算（金币）</label>
            <input
              id="budget"
              name="budget"
              inputMode="numeric"
              required
              defaultValue="100"
            />
          </div>
          <div className="form-field">
            <label htmlFor="mode">分配方式</label>
            <select id="mode" name="mode">
              <option value="BID">投标选择</option>
              <option value="CLAIM">先到先得</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="deadline">截止时间</label>
            <input id="deadline" name="deadline" type="datetime-local" />
          </div>
          <div className="form-field">
            <label htmlFor="maxRevisions">最多修改次数</label>
            <input
              id="maxRevisions"
              name="maxRevisions"
              type="number"
              min="0"
              max="20"
              defaultValue="2"
            />
          </div>
        </div>
        <div className="alert">
          发布草稿不会冻结金币；正式发布时才会检查余额并全额冻结。
        </div>
      </section>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <button className="button" disabled={busy}>
        {busy ? '正在创建…' : '保存为草稿'}
      </button>
    </form>
  );
}

