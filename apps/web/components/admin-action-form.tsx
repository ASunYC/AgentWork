'use client';
import { FormEvent, useState } from 'react';
import {
  adminEndpoint,
  adminErrorMessage,
  type AdminError,
} from '../lib/admin';

export function AdminActionForm({
  kind,
}: {
  kind: 'dispute' | 'report' | 'adjustment';
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const config =
    kind === 'dispute'
      ? {
          title: '提交争议裁决',
          id: '争议 ID',
          action: 'resolution',
          path: 'disputes',
        }
      : kind === 'report'
        ? {
            title: '提交举报结论',
            id: '举报 ID',
            action: 'decision',
            path: 'reports',
          }
        : {
            title: '人工金币调整',
            id: '钱包 ID',
            action: 'amount',
            path: 'ledger/adjustments',
          };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const id = String(form.get('id') ?? '').trim();
    const payload =
      kind === 'adjustment'
        ? {
            walletId: id,
            amount: String(form.get('value')),
            reason: form.get('reason'),
            ticketId: form.get('ticketId'),
          }
        : { [config.action]: form.get('value'), reason: form.get('reason') };
    const path =
      kind === 'adjustment'
        ? config.path
        : `${config.path}/${encodeURIComponent(id)}/resolve`;
    try {
      const response = await fetch(adminEndpoint(path), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      setMessage(
        response.ok
          ? '操作已由 API 确认。'
          : adminErrorMessage(response.status, body as AdminError),
      );
    } catch {
      setMessage('无法连接 API 服务，操作未执行。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>{config.title}</h2>
      <div className="form-field">
        <label htmlFor={`${kind}-id`}>{config.id}</label>
        <input id={`${kind}-id`} name="id" required />
      </div>
      <div className="form-field">
        <label htmlFor={`${kind}-value`}>
          {kind === 'adjustment'
            ? '调整数量（可为负数）'
            : kind === 'dispute'
              ? '裁决结果'
              : '审核结论'}
        </label>
        <input id={`${kind}-value`} name="value" required />
      </div>
      {kind === 'adjustment' && (
        <div className="form-field">
          <label htmlFor="ticketId">关联工单</label>
          <input id="ticketId" name="ticketId" required />
        </div>
      )}
      <div className="form-field">
        <label htmlFor={`${kind}-reason`}>原因</label>
        <textarea id={`${kind}-reason`} name="reason" required />
      </div>
      <button className="button" disabled={busy}>
        {busy ? '正在提交…' : '提交到 API'}
      </button>
      {message && (
        <div className="alert" role="status">
          {message}
        </div>
      )}
    </form>
  );
}
