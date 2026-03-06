#!/usr/bin/env node
/**
 * Neon PostgreSQL → Cloudflare D1 データ移行スクリプト
 *
 * 使い方:
 *   1. .env.migration ファイルを作成して Neon の接続情報を設定:
 *      NEON_DATABASE_URL=postgres://user:password@host/dbname
 *
 *   2. 依存パッケージをインストール:
 *      npm install pg dotenv
 *      （または: npx --yes pg dotenv ← 一時的に使うだけの場合）
 *
 *   3. スクリプトを実行:
 *      node scripts/migrate-neon-to-d1.js
 *
 *   4. 生成された migration.sql を D1 に適用:
 *      npx wrangler d1 execute sakutto-task-db --file=scripts/migration.sql --remote
 *      ※ --remote を省くとローカルの D1 に適用されます（テスト用）
 *
 * 注意:
 *   - 実行前に D1 のスキーマ（db/schema.sql）が適用済みであることを確認してください
 *   - 既にデータがある場合は INSERT OR IGNORE を使うため重複は無視されます
 *   - パスワードハッシュはそのまま移行されます（PBKDF2 → PBKDF2 で同じ形式）
 */

const fs = require('fs');
const path = require('path');

// .env.migration を読み込む（存在する場合）
const envPath = path.join(__dirname, '..', '.env.migration');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) return;
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
        process.env[key] = value;
    });
    console.log('Loaded .env.migration');
}

const DATABASE_URL = process.env.NEON_DATABASE_URL;
if (!DATABASE_URL) {
    console.error('Error: NEON_DATABASE_URL が設定されていません。');
    console.error('.env.migration ファイルに NEON_DATABASE_URL=postgres://... を設定してください。');
    process.exit(1);
}

let pg;
try {
    pg = require('pg');
} catch (e) {
    console.error('Error: pg パッケージがインストールされていません。');
    console.error('以下のコマンドを実行してください: npm install pg');
    process.exit(1);
}

const { Client } = pg;

// ===== ユーザーID マッピング =====
// 旧アプリ（Supabase Auth）のuser_id → 新アプリ（D1）のuser_id
const USER_ID_MAP = {
    'b2154f63-83d8-4ed4-8158-2a2f55e3ad32': 'db6fe065-3708-49ce-93ba-730f85d72e4c',
};
const TARGET_OLD_USER_IDS = Object.keys(USER_ID_MAP);

function remapUserId(oldId) {
    return USER_ID_MAP[oldId] || null;
}

/**
 * 文字列をSQLite用にエスケープする（シングルクォートを2つに）
 */
function sqlEscape(value) {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? '1' : '0';
    return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * PostgreSQL の BOOLEAN → D1 INTEGER (0/1)
 */
function boolToInt(value) {
    return value ? 1 : 0;
}

/**
 * PostgreSQL の INTEGER[] (weekdays) → D1 TEXT (JSON)
 * 例: {0,1,2} → '[0,1,2]'
 */
function weekdaysToJson(value) {
    if (!value) return 'NULL';
    // pg ドライバは INTEGER[] を JavaScript 配列として返すことがある
    if (Array.isArray(value)) {
        return sqlEscape(JSON.stringify(value));
    }
    // 文字列として {0,1,2} で来る場合もある
    if (typeof value === 'string') {
        const cleaned = value.replace(/^\{|\}$/g, '');
        if (!cleaned) return sqlEscape('[]');
        const arr = cleaned.split(',').map(Number);
        return sqlEscape(JSON.stringify(arr));
    }
    return 'NULL';
}

/**
 * タイムスタンプを ISO8601 テキストに変換
 */
function toIsoText(value) {
    if (!value) return 'NULL';
    const d = new Date(value);
    if (isNaN(d.getTime())) return 'NULL';
    return sqlEscape(d.toISOString());
}

/**
 * 日付を YYYY-MM-DD テキストに変換
 */
function toDateText(value) {
    if (!value) return 'NULL';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return sqlEscape(value);
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) return 'NULL';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return sqlEscape(`${yyyy}-${mm}-${dd}`);
}

async function main() {
    console.log('Neon PostgreSQL に接続中...');
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    console.log('接続成功');

    const sqlLines = [];
    sqlLines.push('-- Neon PostgreSQL → Cloudflare D1 移行SQL');
    sqlLines.push(`-- 生成日時: ${new Date().toISOString()}`);
    sqlLines.push(`-- 移行対象ユーザー: ${TARGET_OLD_USER_IDS.join(', ')}`);
    sqlLines.push('');
    // D1はBEGIN TRANSACTION/COMMITをサポートしないため省略

    // ===== users はスキップ（旧アプリはSupabase Auth管理のため public.users テーブルなし）=====
    console.log('users テーブルはスキップ（Supabase Auth管理のため）');
    sqlLines.push('-- users: スキップ（Supabase Authのためpublic.usersなし。D1のusersテーブルは既存データを使用）');
    sqlLines.push('');

    // ===== tasks =====
    console.log('tasks テーブルを移行中...');
    const placeholders = TARGET_OLD_USER_IDS.map((_, i) => `$${i + 1}`).join(', ');
    const tasks = await client.query(
        `SELECT id, user_id, title, due_date, notification_time, notification_enabled, created_at, updated_at FROM tasks WHERE user_id IN (${placeholders})`,
        TARGET_OLD_USER_IDS
    );
    sqlLines.push('-- tasks');
    let taskCount = 0;
    for (const row of tasks.rows) {
        const newUserId = remapUserId(row.user_id);
        if (!newUserId) continue;
        sqlLines.push(
            `INSERT OR IGNORE INTO tasks (id, user_id, title, due_date, notification_time, notification_enabled, created_at, updated_at) VALUES (` +
            `${sqlEscape(row.id)}, ${sqlEscape(newUserId)}, ${sqlEscape(row.title)}, ${toDateText(row.due_date)}, ` +
            `${sqlEscape(row.notification_time)}, ${boolToInt(row.notification_enabled)}, ` +
            `${toIsoText(row.created_at)}, ${toIsoText(row.updated_at)});`
        );
        taskCount++;
    }
    console.log(`  ${taskCount} 件`);
    sqlLines.push('');

    // ===== task_recurrences（tasksに紐づく） =====
    console.log('task_recurrences テーブルを移行中...');
    const taskIds = tasks.rows.map(r => r.id);
    let recurrenceCount = 0;
    sqlLines.push('-- task_recurrences');
    if (taskIds.length > 0) {
        const recPlaceholders = taskIds.map((_, i) => `$${i + 1}`).join(', ');
        const recurrences = await client.query(
            `SELECT id, task_id, type, custom_days, custom_unit, weekdays, created_at FROM task_recurrences WHERE task_id IN (${recPlaceholders})`,
            taskIds
        );
        for (const row of recurrences.rows) {
            sqlLines.push(
                `INSERT OR IGNORE INTO task_recurrences (id, task_id, type, custom_days, custom_unit, weekdays, created_at) VALUES (` +
                `${sqlEscape(row.id)}, ${sqlEscape(row.task_id)}, ${sqlEscape(row.type)}, ` +
                `${row.custom_days !== null ? row.custom_days : 'NULL'}, ${sqlEscape(row.custom_unit)}, ` +
                `${weekdaysToJson(row.weekdays)}, ${toIsoText(row.created_at)});`
            );
            recurrenceCount++;
        }
    }
    console.log(`  ${recurrenceCount} 件`);
    sqlLines.push('');

    // ===== task_completions（tasksに紐づく） =====
    console.log('task_completions テーブルを移行中...');
    let completionCount = 0;
    sqlLines.push('-- task_completions');
    if (taskIds.length > 0) {
        const compPlaceholders = taskIds.map((_, i) => `$${i + 1}`).join(', ');
        const completions = await client.query(
            `SELECT id, task_id, completed_date, completed, created_at, updated_at FROM task_completions WHERE task_id IN (${compPlaceholders})`,
            taskIds
        );
        for (const row of completions.rows) {
            sqlLines.push(
                `INSERT OR IGNORE INTO task_completions (id, task_id, completed_date, completed, created_at, updated_at) VALUES (` +
                `${sqlEscape(row.id)}, ${sqlEscape(row.task_id)}, ${toDateText(row.completed_date)}, ` +
                `${boolToInt(row.completed)}, ${toIsoText(row.created_at)}, ${toIsoText(row.updated_at)});`
            );
            completionCount++;
        }
    }
    console.log(`  ${completionCount} 件`);
    sqlLines.push('');

    // ===== task_exclusions（tasksに紐づく） =====
    console.log('task_exclusions テーブルを移行中...');
    let exclusionCount = 0;
    sqlLines.push('-- task_exclusions');
    if (taskIds.length > 0) {
        const exclPlaceholders = taskIds.map((_, i) => `$${i + 1}`).join(', ');
        const exclusions = await client.query(
            `SELECT id, task_id, excluded_date, exclusion_type, created_at FROM task_exclusions WHERE task_id IN (${exclPlaceholders})`,
            taskIds
        );
        for (const row of exclusions.rows) {
            sqlLines.push(
                `INSERT OR IGNORE INTO task_exclusions (id, task_id, excluded_date, exclusion_type, created_at) VALUES (` +
                `${sqlEscape(row.id)}, ${sqlEscape(row.task_id)}, ${toDateText(row.excluded_date)}, ` +
                `${sqlEscape(row.exclusion_type)}, ${toIsoText(row.created_at)});`
            );
            exclusionCount++;
        }
    }
    console.log(`  ${exclusionCount} 件`);
    sqlLines.push('');

    // ===== user_notification_settings =====
    console.log('user_notification_settings テーブルを移行中...');
    const notifSettings = await client.query(
        `SELECT id, user_id, email, email_notification_enabled, created_at, updated_at FROM user_notification_settings WHERE user_id IN (${placeholders})`,
        TARGET_OLD_USER_IDS
    );
    sqlLines.push('-- user_notification_settings');
    let notifCount = 0;
    for (const row of notifSettings.rows) {
        const newUserId = remapUserId(row.user_id);
        if (!newUserId) continue;
        sqlLines.push(
            `INSERT OR IGNORE INTO user_notification_settings (id, user_id, email, email_notification_enabled, created_at, updated_at) VALUES (` +
            `${sqlEscape(row.id)}, ${sqlEscape(newUserId)}, ${sqlEscape(row.email)}, ` +
            `${boolToInt(row.email_notification_enabled)}, ${toIsoText(row.created_at)}, ${toIsoText(row.updated_at)});`
        );
        notifCount++;
    }
    console.log(`  ${notifCount} 件`);
    sqlLines.push('');

    // ===== memorials =====
    console.log('memorials テーブルを移行中...');
    const memorials = await client.query(
        `SELECT id, user_id, title, due_date, notification_time, notification_enabled, is_holiday, created_at, updated_at FROM memorials WHERE user_id IN (${placeholders})`,
        TARGET_OLD_USER_IDS
    );
    sqlLines.push('-- memorials');
    let memorialCount = 0;
    for (const row of memorials.rows) {
        const newUserId = remapUserId(row.user_id);
        if (!newUserId) continue;
        sqlLines.push(
            `INSERT OR IGNORE INTO memorials (id, user_id, title, due_date, notification_time, notification_enabled, is_holiday, created_at, updated_at) VALUES (` +
            `${sqlEscape(row.id)}, ${sqlEscape(newUserId)}, ${sqlEscape(row.title)}, ${toDateText(row.due_date)}, ` +
            `${sqlEscape(row.notification_time)}, ${boolToInt(row.notification_enabled)}, ` +
            `${boolToInt(row.is_holiday)}, ${toIsoText(row.created_at)}, ${toIsoText(row.updated_at)});`
        );
        memorialCount++;
    }
    console.log(`  ${memorialCount} 件`);
    sqlLines.push('');

    // ===== memorial_recurrences（memorialsに紐づく） =====
    console.log('memorial_recurrences テーブルを移行中...');
    const memorialIds = memorials.rows.map(r => r.id);
    let memRecurrenceCount = 0;
    sqlLines.push('-- memorial_recurrences');
    if (memorialIds.length > 0) {
        const memRecPlaceholders = memorialIds.map((_, i) => `$${i + 1}`).join(', ');
        const memorialRecurrences = await client.query(
            `SELECT id, memorial_id, type, custom_days, custom_unit, weekdays, created_at FROM memorial_recurrences WHERE memorial_id IN (${memRecPlaceholders})`,
            memorialIds
        );
        for (const row of memorialRecurrences.rows) {
            sqlLines.push(
                `INSERT OR IGNORE INTO memorial_recurrences (id, memorial_id, type, custom_days, custom_unit, weekdays, created_at) VALUES (` +
                `${sqlEscape(row.id)}, ${sqlEscape(row.memorial_id)}, ${sqlEscape(row.type)}, ` +
                `${row.custom_days !== null ? row.custom_days : 'NULL'}, ${sqlEscape(row.custom_unit)}, ` +
                `${weekdaysToJson(row.weekdays)}, ${toIsoText(row.created_at)});`
            );
            memRecurrenceCount++;
        }
    }
    console.log(`  ${memRecurrenceCount} 件`);
    sqlLines.push('');


    await client.end();
    console.log('Neon 接続を切断しました');

    // ファイルに書き出す
    const outputPath = path.join(__dirname, 'migration.sql');
    fs.writeFileSync(outputPath, sqlLines.join('\n'), 'utf-8');
    console.log('');
    console.log(`✓ SQL ファイルを生成しました: ${outputPath}`);
    console.log('');
    console.log('次のステップ:');
    console.log('  D1 にリモート適用:');
    console.log('    npx wrangler d1 execute sakutto-task-db --file=scripts/migration.sql --remote');
    console.log('');
    console.log('  D1 にローカル適用（テスト用）:');
    console.log('    npx wrangler d1 execute sakutto-task-db --file=scripts/migration.sql');
}

main().catch((err) => {
    console.error('エラーが発生しました:', err);
    process.exit(1);
});
