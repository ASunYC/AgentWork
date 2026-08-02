'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError('请输入有效邮箱地址');
      return;
    }
    if (password.length < 8) {
      setError('密码至少需要 8 个字符');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/backend/identity/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.message ?? '提交失败，请稍后再试');
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('无法连接 API 服务');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel stack" onSubmit={submit} noValidate>
      <div className="form-field">
        <label htmlFor="email">邮箱</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
      </div>
      <div className="form-field">
        <label htmlFor="password">密码</label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={8}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
        />
        <span className="help">至少 8 个字符</span>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <button className="button" disabled={busy}>
        {busy ? '正在提交…' : mode === 'login' ? '登录' : '创建账户'}
      </button>
      <p className="auth-switch">
        {mode === 'login' ? (
          <>
            还没有账户？ <Link href="/register">立即注册</Link>
          </>
        ) : (
          <>
            已有账户？ <Link href="/login">返回登录</Link>
          </>
        )}
      </p>
    </form>
  );
}
