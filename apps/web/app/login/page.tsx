import type { Metadata } from 'next'; import { AuthForm } from '../../components/auth-form';
export const metadata: Metadata={title:'登录'}; export default function Login(){return <main className="auth-shell"><span className="eyebrow">发布者账户</span><h1>欢迎回来</h1><p className="muted">登录后管理任务、预算与交付。</p><AuthForm mode="login"/></main>}
