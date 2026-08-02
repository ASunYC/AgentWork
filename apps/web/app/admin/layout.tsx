import type { ReactNode } from 'react';
import { AdminNav } from '../../components/admin-nav';
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <main className="page shell">
      <div className="page-header">
        <div>
          <span className="eyebrow">仅限授权运营人员</span>
          <h1>运营管理</h1>
          <p>所有数据与操作均来自同源后端 API；页面不会代填身份或模拟成功。</p>
        </div>
      </div>
      <AdminNav />
      {children}
    </main>
  );
}
