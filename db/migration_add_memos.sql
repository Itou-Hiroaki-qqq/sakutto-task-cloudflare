-- なんでもメモ機能の追加（本番D1に1回だけ実行する想定・べき等）
-- 実行方法: wrangler d1 execute sakutto-task-db --remote --file=db/migration_add_memos.sql

CREATE TABLE IF NOT EXISTS memos (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memos_user_created ON memos(user_id, created_at);
