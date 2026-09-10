import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const target = request.nextUrl.clone();
  target.pathname = ['/login', '/register'].includes(request.nextUrl.pathname)
    ? '/developers'
    : '/projects';
  target.search = '';
  return NextResponse.redirect(target);
}
export const config = {
  matcher: [
    '/login',
    '/register',
    '/dashboard',
    '/wallet',
    '/notifications',
    '/tasks/:path*',
    '/admin/:path*',
  ],
};
