-- さくっとタスク D1 (SQLite) スキーマ
-- PostgreSQL版から変換:
--   UUID → TEXT (アプリ側で crypto.randomUUID() を使用)
--   BOOLEAN → INTEGER (0=false, 1=true)
--   INTEGER[] (weekdays配列) → TEXT (JSON文字列: "[0,1,2]")
--   TIMESTAMP WITH TIME ZONE → TEXT (ISO8601形式)
--   DATE → TEXT (YYYY-MM-DD形式)
--   TRIGGER/FUNCTION → 削除 (updated_at はアプリ側で更新)

-- ユーザーテーブル（自前認証用・新規追加）
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- タスクテーブル
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    due_date TEXT NOT NULL,
    notification_time TEXT,
    notification_enabled INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- タスクの繰り返し設定テーブル
CREATE TABLE IF NOT EXISTS task_recurrences (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('daily', 'weekly', 'monthly', 'monthly_end', 'yearly', 'weekdays', 'custom')),
    custom_days INTEGER,
    custom_unit TEXT CHECK (custom_unit IN ('days', 'weeks', 'months', 'months_end', 'years')),
    weekdays TEXT,  -- JSON配列: "[0, 1, 2]" 形式で保存
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    UNIQUE (task_id)
);

-- タスクの完了状態テーブル
CREATE TABLE IF NOT EXISTS task_completions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    completed_date TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    UNIQUE (task_id, completed_date)
);

-- 繰り返しタスクの除外日管理テーブル
CREATE TABLE IF NOT EXISTS task_exclusions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    excluded_date TEXT NOT NULL,
    exclusion_type TEXT NOT NULL CHECK (exclusion_type IN ('single', 'after')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    UNIQUE (task_id, excluded_date, exclusion_type)
);

-- ユーザー通知設定テーブル
CREATE TABLE IF NOT EXISTS user_notification_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    email TEXT,
    email_notification_enabled INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 記念日テーブル
CREATE TABLE IF NOT EXISTS memorials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    due_date TEXT NOT NULL,
    notification_time TEXT,
    notification_enabled INTEGER DEFAULT 0,
    is_holiday INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 記念日の繰り返し設定テーブル
CREATE TABLE IF NOT EXISTS memorial_recurrences (
    id TEXT PRIMARY KEY,
    memorial_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('daily', 'weekly', 'monthly', 'monthly_end', 'yearly', 'weekdays', 'custom')),
    custom_days INTEGER,
    custom_unit TEXT CHECK (custom_unit IN ('days', 'weeks', 'months', 'months_end', 'years')),
    weekdays TEXT,  -- JSON配列: "[0, 1, 2]" 形式で保存
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (memorial_id) REFERENCES memorials(id) ON DELETE CASCADE,
    UNIQUE (memorial_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_task_recurrences_task_id ON task_recurrences(task_id);
CREATE INDEX IF NOT EXISTS idx_task_completions_task_id ON task_completions(task_id);
CREATE INDEX IF NOT EXISTS idx_task_completions_date ON task_completions(completed_date);
CREATE INDEX IF NOT EXISTS idx_task_exclusions_task_id ON task_exclusions(task_id);
CREATE INDEX IF NOT EXISTS idx_task_exclusions_date ON task_exclusions(excluded_date);
CREATE INDEX IF NOT EXISTS idx_user_notification_settings_user_id ON user_notification_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_memorials_user_id ON memorials(user_id);
CREATE INDEX IF NOT EXISTS idx_memorials_due_date ON memorials(due_date);
CREATE INDEX IF NOT EXISTS idx_memorial_recurrences_memorial_id ON memorial_recurrences(memorial_id);
