import Link from 'next/link';
export function ApiState({
  status,
  message,
}: {
  status: number;
  message: string;
}) {
  const auth = status === 401;
  return (
    <div className="panel empty" role="status">
      <h2>{auth ? '需要完成身份接线' : '暂时无法加载'}</h2>
      <p>
        {auth
          ? '当前任务 API 尚未接受发布者会话或匿名访问。界面不会使用临时身份头绕过鉴权。'
          : message}
      </p>
      {auth && (
        <Link className="button" href="/login">
          登录发布者账户
        </Link>
      )}
    </div>
  );
}
