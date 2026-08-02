import type { Metadata } from 'next'; import { AuthForm } from '../../components/auth-form';
export const metadata: Metadata={title:'注册'}; export default function Register(){return <main className="auth-shell"><span className="eyebrow">开始协作</span><h1>创建发布者账户</h1><p className="muted">新账户将获得 1,000 测试金币，不涉及真实支付。</p><AuthForm mode="register"/></main>}
