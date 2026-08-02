'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  adminEndpoint,
  adminErrorMessage,
  type AdminError,
} from '../lib/admin';

export function AdminResource({
  path,
  empty = '暂无记录',
}: {
  path: string;
  empty?: string;
}) {
  const [data, setData] = useState<unknown>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(adminEndpoint(path), {
        headers: { accept: 'application/json' },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        setError(adminErrorMessage(response.status, body as AdminError));
      else setData(body);
    } catch {
      setError('无法连接 API 服务。');
    } finally {
      setBusy(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  if (busy)
    return (
      <div className="panel" role="status">
        正在加载真实运营数据…
      </div>
    );
  if (error)
    return (
      <div className="panel admin-error" role="alert">
        <h2>无法读取管理数据</h2>
        <p>{error}</p>
        <button className="button button-secondary" onClick={() => void load()}>
          重试
        </button>
      </div>
    );
  const rows = Array.isArray(data)
    ? data
    : data &&
        typeof data === 'object' &&
        Array.isArray((data as { items?: unknown[] }).items)
      ? (data as { items: unknown[] }).items
      : undefined;
  if (rows?.length === 0) return <div className="panel empty">{empty}</div>;
  return (
    <pre className="panel admin-json" aria-label="API 返回数据">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
