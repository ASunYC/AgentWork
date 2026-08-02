export type AdminError = { code?: string; message?: string; request_id?: string };

export function adminErrorMessage(status: number, body: AdminError): string {
  if (status === 401) return '请先登录管理员账户。';
  if (status === 403) return '当前账户没有管理员权限。';
  if (status === 404) return '后端尚未提供此管理接口。';
  return body.message ?? `请求失败（HTTP ${status}）`;
}

export function adminEndpoint(path: string, query?: Record<string, string>) {
  const params = new URLSearchParams(query);
  return `/api/backend/admin/${path}${params.size ? `?${params}` : ''}`;
}
