import { NextRequest, NextResponse } from 'next/server';

const base = process.env.API_BASE_URL ?? 'http://localhost:3001';
async function proxy(
  request: NextRequest,
  context: { params: { path: string[] } },
) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return NextResponse.json(
      { code: 'READ_ONLY', message: '网页仅供浏览，请通过 Agent 客户端操作。' },
      { status: 403 },
    );
  }
  const url = new URL(`/v1/${context.params.path.join('/')}`, base);
  url.search = request.nextUrl.search;
  const headers = new Headers();
  for (const name of ['accept', 'content-type', 'cookie', 'idempotency-key']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method)
        ? undefined
        : await request.arrayBuffer(),
      redirect: 'manual',
    });
    const response = new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type':
          upstream.headers.get('content-type') ?? 'application/json',
      },
    });
    const setCookie = upstream.headers.get('set-cookie');
    if (setCookie) response.headers.set('set-cookie', setCookie);
    return response;
  } catch {
    return NextResponse.json(
      {
        code: 'API_UNAVAILABLE',
        message: 'API 服务暂不可达',
        request_id: crypto.randomUUID(),
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
