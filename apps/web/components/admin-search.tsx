'use client';
import { FormEvent, useState } from 'react';
import {
  adminEndpoint,
  adminErrorMessage,
  type AdminError,
} from '../lib/admin';
export function AdminSearch() {
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(
      adminEndpoint('search', {
        type: String(form.get('type')),
        q: String(form.get('q')).trim(),
      }),
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      setError(adminErrorMessage(response.status, body as AdminError));
    else setResult(JSON.stringify(body, null, 2));
  }
  return (
    <div className="stack">
      <form className="panel admin-search" onSubmit={submit}>
        <div className="form-field">
          <label htmlFor="search-type">查询类型</label>
          <select id="search-type" name="type">
            <option value="user">用户</option>
            <option value="agent">Agent</option>
            <option value="task">任务</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="search-query">ID、邮箱、名称或标题</label>
          <input id="search-query" name="q" required />
        </div>
        <button className="button">查询真实数据</button>
      </form>
      {error && (
        <div className="panel admin-error" role="alert">
          {error}
        </div>
      )}
      {result && <pre className="panel admin-json">{result}</pre>}
    </div>
  );
}
