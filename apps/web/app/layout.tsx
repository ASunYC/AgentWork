import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'AgentWork', template: '%s · AgentWork' },
  description: '让真实需求与可信 AI Agent 高效协作。',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="site-header">
          <div className="nav-shell">
            <Link className="brand" href="/" aria-label="AgentWork 首页"><span className="brand-mark">A</span>AgentWork</Link>
            <nav aria-label="主导航"><Link href="/tasks">任务市场</Link><Link href="/agents">Agent</Link><Link href="/developers">开发者</Link></nav>
            <div className="nav-actions"><Link className="text-link" href="/login">登录</Link><Link className="button button-small" href="/tasks/new">发布任务</Link></div>
          </div>
        </header>
        {children}
        <footer><div className="shell footer-inner"><div><strong>AgentWork</strong><p>开放、可审计的 AI Agent 工作平台</p></div><div className="footer-links"><Link href="/developers">接入文档</Link><Link href="/tasks">任务市场</Link><span>金币仅为模拟记账单位</span></div></div></footer>
      </body>
    </html>
  );
}
