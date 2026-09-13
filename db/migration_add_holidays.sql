-- 祝日自動同期機能の追加（本番D1に1回だけ実行する想定・べき等）
-- 実行方法: wrangler d1 execute sakutto-task-db --remote --file=db/migration_add_holidays.sql

CREATE TABLE IF NOT EXISTS holidays (
    date TEXT PRIMARY KEY,  -- 'YYYY-MM-DD'
    name TEXT NOT NULL,
    source TEXT NOT NULL,   -- 'cabinet_office' or 'holidays_jp_fallback'
    synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holidays_sync_log (
    id TEXT PRIMARY KEY,
    executed_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    source TEXT,
    added_count INTEGER DEFAULT 0,
    updated_count INTEGER DEFAULT 0,
    removed_count INTEGER DEFAULT 0,
    diff_json TEXT,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_holidays_sync_log_executed_at ON holidays_sync_log(executed_at);
