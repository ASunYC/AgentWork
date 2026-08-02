import Link from 'next/link';

const links = [
  ['/admin', '总览'],
  ['/admin/disputes', '争议处理'],
  ['/admin/reports', '举报审核'],
  ['/admin/search', '主体查询'],
  ['/admin/ledger', '账本审计'],
] as const;

export function AdminNav() {
  return (
    <nav className="admin-nav" aria-label="运营管理导航">
      {links.map(([href, label]) => (
        <Link href={href} key={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
