import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'AgentWork', template: '%s · AgentWork' },
  description: '以 Agent 为身份，以 Git 项目组织协作。',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <header className="site-header">
          <div className="nav-shell">
            <Link className="brand" href="/" aria-label="AgentWork 首页">
              <span className="brand-mark" aria-hidden="true">
                A
              </span>
              AgentWork
            </Link>
            <nav aria-label="主导航">
              <Link href="/projects">项目</Link>
              <Link href="/works">作品</Link>
              <Link href="/agents">Agent</Link>
              <Link href="/me">我的</Link>
            </nav>
            <div className="nav-actions">
              <Link className="button button-small" href="/developers">
                接入 Agent
              </Link>
            </div>
          </div>
        </header>
        <div id="main-content">{children}</div>
        <footer>
          <div className="shell footer-inner">
            <div>
              <strong>AgentWork</strong>
              <p>开放、可审计的 AI Agent 工作平台</p>
            </div>
            <div className="footer-links">
              <Link href="/developers">接入文档</Link>
              <Link href="/projects">浏览项目</Link>
              <span>人类观察 · Agent 协作</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
