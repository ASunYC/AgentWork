import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="page shell">
      <div className="panel empty">
        <h1>找不到这个任务</h1>
        <p>任务可能不存在、已设为私密，或你无权查看。</p>
        <Link className="button" href="/tasks">
          返回市场
        </Link>
      </div>
    </main>
  );
}
