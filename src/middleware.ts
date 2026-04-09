import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { COOKIE_NAME } from '@/lib/auth';

const PROTECTED_PATHS = ['/top', '/weekly', '/search', '/task', '/memorial', '/settings'];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // APIルートはミドルウェアでの認証不要（各ルートハンドラで認証する）
    if (pathname.startsWith('/api/')) {
        return NextResponse.next();
    }

    const isProtected = PROTECTED_PATHS.some(p => pathname.startsWith(p));
    const isAuthPage = pathname === '/login' || pathname === '/signup';

    // 保護対象でも認証ページでもなければスキップ
    if (!isProtected && !isAuthPage) {
        return NextResponse.next();
    }

    // 保護対象または認証ページの場合のみJWT検証
    const token = request.cookies.get(COOKIE_NAME)?.value;
    const payload = token ? await verifyJWT(token) : null;

    if (isProtected && !payload) {
        const loginUrl = new URL('/login', request.url);
        return NextResponse.redirect(loginUrl);
    }

    if (isAuthPage && payload) {
        const topUrl = new URL('/top', request.url);
        return NextResponse.redirect(topUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
