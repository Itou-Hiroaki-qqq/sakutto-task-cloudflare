import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { COOKIE_NAME, verifyJWT } from "@/lib/auth";
import { getDB } from "@/lib/db";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "さくっとタスク",
  description: "カレンダーと毎日のtodoリストが一体化したWebアプリ",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

async function loadAuthUser() {
  try {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (!token) return { userId: null, email: null, name: null };
    const payload = await verifyJWT(token);
    if (!payload) return { userId: null, email: null, name: null };
    const db = await getDB();
    const user = await db
      .prepare('SELECT id, email, name FROM users WHERE id = ? LIMIT 1')
      .bind(payload.uid)
      .first<{ id: string; email: string; name: string }>();
    if (!user) return { userId: null, email: null, name: null };
    return { userId: user.id, email: user.email, name: user.name };
  } catch {
    return { userId: null, email: null, name: null };
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await loadAuthUser();
  return (
    <html lang="ja">
      <head>
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider user={user}>{children}</AuthProvider>
      </body>
    </html>
  );
}
