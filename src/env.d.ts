// Cloudflare バインディングの型定義
// wrangler types --env-interface CloudflareEnv で自動生成される（wrangler.toml変更後に再実行）
interface CloudflareEnv {
    DB: D1Database;
    KV: KVNamespace;
    JWT_SECRET: string;
    CRON_SECRET: string;
    RESEND_API_KEY: string;
    RESEND_FROM_EMAIL: string;
    GEMINI_API_KEY: string;
}
