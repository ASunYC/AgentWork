'use client';
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="page shell">
      <div className="panel empty">
        <h1>任务市场加载失败</h1>
        <p>请检查网络后重试。</p>
        <button className="button" onClick={reset}>
          重新加载
        </button>
      </div>
    </main>
  );
}
