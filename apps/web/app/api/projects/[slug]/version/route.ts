import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } },
) {
  try {
    const response = await fetch(
      `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/v2/public/projects/${encodeURIComponent(params.slug)}/version`,
      { cache: 'no-store', signal: AbortSignal.timeout(5000) },
    );
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ message: '项目更新暂不可用' }, { status: 503 });
  }
}
