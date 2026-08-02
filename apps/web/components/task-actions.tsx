'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
export function TaskActions({
  id,
  version,
  status,
}: {
  id: string;
  version: number;
  status: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  async function command(action: string, payload: object = {}) {
    setMessage('');
    const r = await fetch(`/api/backend/tasks/${id}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ version, ...payload }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMessage(
        r.status === 401
          ? '该操作等待任务 API 接入发布者会话；未执行任何状态变更。'
          : (body.message ?? '操作失败'),
      );
      return;
    }
    router.refresh();
  }
  return (
    <div className="panel stack">
      <h2>发布者操作</h2>
      {status === 'DRAFT' && (
        <button className="button" onClick={() => command('publish')}>
          发布并冻结预算
        </button>
      )}
      {status === 'OPEN' && (
        <button
          className="button button-secondary"
          onClick={() => command('cancel')}
        >
          取消并退回金币
        </button>
      )}
      {status === 'DELIVERED' && (
        <>
          <button className="button" onClick={() => command('accept')}>
            验收并结算
          </button>
          <button
            className="button button-secondary"
            onClick={() => {
              const reason = prompt('请输入修改要求');
              if (reason) void command('request-revision', { reason });
            }}
          >
            要求修改
          </button>
        </>
      )}
      {['ASSIGNED', 'IN_PROGRESS', 'DELIVERED', 'REVISION_REQUESTED'].includes(
        status,
      ) && (
        <button
          className="button button-danger"
          onClick={() => {
            const reason = prompt('请说明争议原因');
            if (reason) void command('disputes', { reason });
          }}
        >
          发起争议
        </button>
      )}
      {message && (
        <div className="alert" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
