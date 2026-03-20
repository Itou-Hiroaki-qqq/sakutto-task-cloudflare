# さくっとタスク（Cloudflare版）

Next.js + Cloudflare D1 + 自前JWT認証によるタスク管理PWAアプリ。

## 技術スタック

- **フレームワーク**: Next.js 15 (App Router)
- **デプロイ**: Cloudflare Workers (@opennextjs/cloudflare)
- **DB**: Cloudflare D1 (SQLite)
- **認証**: 自前JWT (PBKDF2 + HMAC-SHA256 / Web Crypto API)
- **メール通知**: Resend
- **AI機能**: Gemini API（行事予定表の画像解析）
- **スタイル**: Tailwind CSS v4 + DaisyUI v5
- **Cron**: Cloudflare Cron Triggers（1分毎）

## 主な機能

- タスク管理（単発・繰り返し7種類: daily/weekly/monthly/monthly_end/yearly/weekdays/custom）
- 記念日管理（同様の繰り返し設定）
- カレンダー表示（週間・月間）
- 検索機能（タスク・記念日）
- 行事予定カレンダー取込（Gemini APIで画像・PDF→予定）
- 未完了タスク自動引継ぎ（過去30日以内の未完了タスクを今日のリストに表示）
- メール通知
- データエクスポート/インポート（JSON）
- PWA対応

## 開発環境のセットアップ

```bash
npm install
```

### 環境変数

`wrangler.toml` の `[vars]` セクションまたは Cloudflare Secrets に以下を設定:

- `JWT_SECRET`: JWT署名用シークレット
- `RESEND_API_KEY`: Resend APIキー
- `RESEND_FROM_EMAIL`: 送信元メールアドレス
- `GEMINI_API_KEY`: Gemini APIキー
- `CRON_SECRET`: Cronエンドポイント認証用

### DBセットアップ

```bash
# ローカルD1の初期化
npx wrangler d1 execute sakutto-task-db --local --file=db/schema.sql

# 本番D1の初期化
npx wrangler d1 execute sakutto-task-db --remote --file=db/schema.sql
```

### 開発サーバー起動

```bash
npm run preview
```

### デプロイ

```bash
npm run deploy
```

## データ移行（NeonDB → Cloudflare D1）

```bash
# .env.migration を作成
echo "NEON_DATABASE_URL=postgres://..." > .env.migration

# pg パッケージをインストール
npm install pg

# スクリプト実行 → scripts/migration.sql が生成される
node scripts/migrate-neon-to-d1.js

# D1に適用
npx wrangler d1 execute sakutto-task-db --file=scripts/migration.sql --remote
```
