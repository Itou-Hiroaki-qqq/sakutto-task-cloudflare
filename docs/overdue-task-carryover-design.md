# 設計ドキュメント: 未完了タスク引継ぎ機能

> 作成日: 2026-03-21
> ステータス: レビュー待ち

---

## 1. 要件定義

### 機能要件

| # | 要件 | 詳細 |
|---|------|------|
| F1 | 本日のタスクリストへの自動引継ぎ | 本日より前の日付に未完了タスクがある場合、本日のタスクの最後尾に自動的に引き継ぐ |
| F2 | 警告マーク表示 | 引継ぎタスクのタイトル冒頭に警告マーク（三角に感嘆符）を表示 |
| F3 | タスク編集ページでの表示 | 引継ぎタスクのタスク編集ページで「X月X日の未完了タスクです」と表示 |
| F4 | 完了時の表示 | 完了後「X月X日の未完了タスク - Y月Y日に完了」と表示 |

### 非機能要件

| # | 要件 | 詳細 |
|---|------|------|
| NF1 | タイムゾーン対応 | Cloudflare Workers (UTC) 上で日本時間ベースの「今日」判定が正しく動作すること |
| NF2 | パフォーマンス | 引継ぎタスクの取得が既存のタスク取得と同等のレスポンス時間であること |
| NF3 | 後方互換性 | 既存のタスク完了/未完了トグル機能を壊さないこと |
| NF4 | 繰り返しタスク対応 | 7種類の繰り返しタスクすべてに対応すること |

### 削除対象

| 対象 | 理由 |
|------|------|
| `TodoList.tsx` の `overdueDates` プロップ | 引継ぎタスクとして表示されるため不要 |
| `getOverdueTaskDates()` 関数 | `getCarryoverTasks()` に置き換え |
| API レスポンスの `overdueDates` フィールド | `carryoverTasks` を tasks 配列に含めるため不要 |
| `top/page.tsx` の `overdueDates` state | 不要 |

---

## 2. 設計方針

**方針: サーバーサイドマージ方式（案A）を採用**

`GET /api/tasks?date=YYYY-MM-DD` で今日のタスクを取得する際、サーバー側で過去の未完了タスクを引継ぎタスクとしてマージし、1つのレスポンスで返す。

### 案の比較

| 観点 | 案A: サーバーサイドマージ | 案B: クライアントサイドマージ |
|------|--------------------------|------------------------------|
| API変更 | 既存API拡張 | 新規API追加 |
| フロント複雑度 | 低 | 高（マージロジック必要） |
| キャッシュ整合性 | 高（1つのキャッシュ） | 低（2系統のキャッシュ管理） |
| パフォーマンス | 1リクエスト | 2リクエスト |

**案A採用理由**: 個人開発プロジェクトにおいてコードの複雑さを最小限に抑えることが最重要。既存のキャッシュ機構をそのまま活用できる。

### 判定ロジック

```
if リクエスト日 === 今日(JST) then
  通常タスク = getTasksForDate(userId, today)
  引継ぎタスク = getCarryoverTasks(userId, today)
  return 通常タスク + 引継ぎタスク
else
  return getTasksForDate(userId, requestDate)
```

---

## 3. 変更対象ファイル一覧

| ファイル | 変更内容 | 変更規模 |
|----------|----------|----------|
| `src/types/database.ts` | DisplayTask 型に2フィールド追加 | 小 |
| `src/lib/timezone.ts` | **新規作成** JST日付ユーティリティ | 小 |
| `src/lib/tasks.ts` | `getOverdueTaskDates()` → `getCarryoverTasks()` 置換、引継ぎマージロジック追加 | 中 |
| `src/app/api/tasks/route.ts` | `overdueDates` ロジック除去、タイムゾーン修正 | 小 |
| `src/components/TodoList.tsx` | `overdueDates` プロップ削除、警告マーク表示追加 | 小 |
| `src/app/top/page.tsx` | `overdueDates` state 削除、parseTasksFromAPI修正 | 小 |
| `src/app/task/page.tsx` | 引継ぎ情報表示追加 | 小 |

---

## 4. API設計

### GET /api/tasks?date=YYYY-MM-DD

**変更点**: レスポンスの `tasks` 配列に引継ぎタスクを含める。`overdueDates` フィールドを廃止。

**レスポンス例（今日のリクエスト時）:**
```json
{
  "tasks": [
    {
      "id": "single-abc123",
      "task_id": "abc123",
      "title": "通常のタスク",
      "date": "2026-03-21",
      "due_date": "2026-03-21",
      "completed": false,
      "is_recurring": false,
      "is_carryover": false
    },
    {
      "id": "carryover-def456-2026-03-19",
      "task_id": "def456",
      "title": "やり忘れたタスク",
      "date": "2026-03-21",
      "due_date": "2026-03-19",
      "completed": false,
      "is_recurring": false,
      "is_carryover": true,
      "original_date": "2026-03-19"
    }
  ]
}
```

### POST /api/tasks/completion

**変更点**: 引継ぎタスクの完了時は `date` に `original_date`（元の期日）を送る。

```json
{
  "taskId": "def456",
  "date": "2026-03-19",
  "completed": true
}
```

これにより `task_completions` テーブルに元の日付で完了レコードが作成され、翌日以降に再引継ぎされなくなる。

---

## 5. DisplayTask型の拡張

```typescript
export interface DisplayTask {
    id: string;
    task_id: string;
    title: string;
    date: Date;
    due_date: Date;
    notification_time?: string;
    completed: boolean;
    is_holiday?: boolean;
    holiday_name?: string;
    is_recurring?: boolean;
    created_at?: Date;
    // --- 新規追加 ---
    is_carryover?: boolean;     // 引継ぎタスクかどうか
    original_date?: Date;       // 引継ぎ元の日付（元々のdue_dateまたは繰り返し出現日）
}
```

**設計判断**: `completed_date` フィールドは追加しない。完了日の表示が必要なのはタスク編集ページのみであり、`task_completions` テーブルから個別取得する。

---

## 6. TodoList.tsx の変更

### 削除するもの
- `overdueDates` プロップとその型定義
- `overdueDates.length > 0` で表示する alert-warning ブロック

### 追加するもの
- 引継ぎタスクの警告マーク表示

**TodoItem の表示ロジック:**
```
is_carryover === true の場合:  ⚠ {task.title}
is_carryover === false の場合: {task.title}
```

**ソート順の変更:**
```
未完了(通常) → 未完了(引継ぎ) → 完了(通常) → 完了(引継ぎ)
```

引継ぎタスクは通常タスクの後ろに配置し、「今日やるべきこと」が上、「やり残し」が下に来る。

### TodoItem の Link URL

引継ぎタスクの場合:
```
/task?taskId={task_id}&date={format(task.original_date, 'yyyy-MM-dd')}&carryover=true&returnUrl=/top
```

---

## 7. task/page.tsx の変更

### URLパラメータの追加
- `carryover`: `"true"` の場合、引継ぎタスクとして表示

### 表示の追加（タイトル入力欄と期日選択の間）

**未完了時:**
```
⚠ 3月19日の未完了タスクです
```

**完了時:**
```
⚠ 3月19日の未完了タスク - 3月21日に完了
```

完了日の取得: 既存の `GET /api/tasks/{taskId}` のレスポンスに完了情報を含める。

---

## 8. lib/tasks.ts の変更

### getCarryoverTasks() 新規作成

**シグネチャ:**
```typescript
getCarryoverTasks(userId: string, todayJST: Date): Promise<DisplayTask[]>
```

**処理フロー:**
1. 全タスクをDBから取得（ユーザーIDでフィルタ）
2. 単発タスク: `due_date < todayJST` かつ未完了のものを抽出
3. 繰り返しタスク: 過去30日以内の出現日で未完了のものを抽出
4. 各タスクに `is_carryover: true`, `original_date: 元の日付`, `date: todayJST` を設定
5. `id` を `carryover-{task_id}-{original_date_str}` 形式で生成
6. ソート: `original_date` の古い順
7. 上限50件で切り捨て

### getOverdueTaskDates() の削除

`getCarryoverTasks()` に完全に置き換える。

---

## 9. タイムゾーン対策

### 新規ファイル: src/lib/timezone.ts

```typescript
/**
 * Cloudflare Workers (UTC) 上でJST基準の「今日」を取得する
 */
export function getTodayJST(): Date {
    const now = new Date();
    const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
    const jstDate = new Date(jstMs);
    return new Date(jstDate.getFullYear(), jstDate.getMonth(), jstDate.getDate());
}

/**
 * 指定日がJST基準で「今日」かどうか判定する
 */
export function isTodayJST(date: Date): boolean {
    const todayJST = getTodayJST();
    return isSameDay(date, todayJST);
}
```

### 影響範囲

| 箇所 | 現在の実装 | 変更後 |
|------|-----------|--------|
| `GET /api/tasks` route | `startOfDay(new Date())` | `getTodayJST()` |
| `getCarryoverTasks()` | - | `getTodayJST()` で「今日」判定 |
| `top/page.tsx` (フロント) | `startOfDay(new Date())` | 変更不要（ブラウザはローカルTZ） |

---

## 10. エッジケース

### 10.1 繰り返しタスク（daily）の引継ぎ
- **シナリオ**: 毎日のタスクを3日間放置
- **動作**: 過去3日分の未完了がそれぞれ引継ぎタスクとして表示（3件）
- **対策**: 30日上限 + 50件上限

### 10.2 複数日にまたがる未完了
- **シナリオ**: 3月15日と3月18日のタスクが両方未完了
- **動作**: 両方とも引継ぎタスクとして表示。`original_date` で区別

### 10.3 完了取り消し
- **シナリオ**: 引継ぎタスクを完了した後、チェックを外す
- **動作**: `original_date` の完了レコードを `completed: false` に更新。翌日再度引継ぎ
- **注意**: `handleToggleCompletion` で引継ぎタスクの場合は `original_date` を `date` パラメータとして送信

### 10.4 引継ぎタスクの編集
- **シナリオ**: 引継ぎタスクのタイトルを変更して保存
- **動作**: 元のタスクのタイトルが変更される
- **注意**: 引継ぎタスクの期日は変更しない（元の日付を維持）

### 10.5 タスク作成直後の引継ぎ
- **シナリオ**: 過去日付を指定してタスクを新規作成
- **動作**: 即座に引継ぎタスクとして今日のリストに表示

### 10.6 日付をまたぐタイミング
- **シナリオ**: 深夜0時（JST）前後にアプリを操作
- **動作**: `getTodayJST()` により常にJST基準。UTCとのズレは発生しない

### 10.7 引継ぎタスクの除外日（task_exclusions）
- **シナリオ**: 繰り返しタスクの特定日が除外されている場合
- **動作**: 除外日のタスクは引き継がない

### 10.8 過去日を閲覧した場合
- **シナリオ**: カレンダーで3月15日を選択して閲覧
- **動作**: 引継ぎタスクは表示されない（今日のリストのみに表示）

---

## エージェント別実行計画

| エージェント | 担当フェーズ | 実行すべき作業内容 | 使用するSkill | 完了条件 |
|---|---|---|---|---|
| architect | Phase 0: 設計 | 本設計ドキュメント作成 | - | 設計ドキュメント完成、ユーザー承認 |
| implementer | Phase 1: 基盤 | `src/lib/timezone.ts` 新規作成、`src/types/database.ts` のDisplayTask型拡張 | - | 型定義が正しくコンパイルされること |
| implementer | Phase 2: バックエンド | `src/lib/tasks.ts` に `getCarryoverTasks()` 追加、`getOverdueTaskDates()` 削除 | skill-d1-api-patterns | `getCarryoverTasks()` が過去未完了タスクを正しく返すこと |
| implementer | Phase 3: API | `src/app/api/tasks/route.ts` から `overdueDates` ロジック削除、タイムゾーン修正 | - | APIレスポンスに引継ぎタスクが含まれること |
| implementer | Phase 4: フロントエンド | `TodoList.tsx` 警告マーク表示、`top/page.tsx` overdueDates削除、`task/page.tsx` 引継ぎ情報表示 | skill-fullstack-dev-workflow | 引継ぎタスクが警告マーク付きで表示されること |
| implementer | Phase 5: 完了処理 | `handleToggleCompletion` で引継ぎタスク完了時に `original_date` を送信 | - | 引継ぎタスク完了で翌日以降に再引継ぎされないこと |
| tester | Phase 6: テスト | エッジケース10項目の手動テスト項目作成 | - | 全テスト項目パス |
| engineering-code-reviewer | Phase 7: レビュー | コード品質、タイムゾーン処理の正確性確認 | - | レビュー指摘事項なし |
