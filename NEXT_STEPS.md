# NEXT_STEPS — 「ぐるぐる→500エラー」改善ロードマップ

> **このファイルの目的**
> 「タスクの追加・編集・削除でローディングが長く Internal Server Error が出る」問題を、
> 段階的に解消するための作業計画書。
> Claude が次回の作業に入るときは、最初にこのファイルを参照すること。

---

## 現状（2026-05-03 時点）

| 項目 | 状態 |
|---|---|
| **Step 1（ミニマム3点）** | ✅ デプロイ済み（コミット `01df80c`） |
| **Step 2（TanStack Query 導入）** | ⬜ 未着手 |
| **Step 3（carryover_from_date 廃止）** | ⬜ 未着手 |
| 本番URL | https://sakutto-task.chiteijin315.workers.dev |

---

## 改善判断フロー

```
[Step 1 デプロイ後 1〜2日 様子見]
       │
       ├─ ✅ 症状ほぼ消えた → ここで完了（Step 2/3 不要）
       ├─ 🟡 改善したが少し残る → Step 2 へ
       └─ ❌ ほとんど変わらない → Step 2 へ（最有力）

[Step 2 デプロイ後 1〜2日 様子見]
       │
       ├─ ✅ 症状完全消滅 → ここで完了
       ├─ 🟡 まだ残る（特に過去未完了の引継ぎ操作） → Step 3 へ
       └─ ❌ 別の問題が出た → 個別調査
```

### 「次のステップへ進む」の判断材料

ユーザに以下を確認してから次ステップへ進むこと：

1. **体感**: 「ぐるぐる」の長さ、「Internal Server Error」トーストの頻度
2. **DevTools Network タブ**: 5xx を返している API があるか、その API は何か
3. **特にどの操作で症状が出るか**: 新規追加 / 編集 / 削除 / チェック / 引継ぎ完了 のどれ

---

## Step 1（実施済み）の要約

### やったこと

1. **プリフェッチ完全撤廃**: `/top` の前後14日×4並列プリフェッチを削除
2. **`/api/auth/me` 廃止**: layout.tsx (Server Component) で cookie→JWT→DB→AuthProvider に渡す形に変更
3. **記念日 fetch 統合**: `/api/tasks?includeMemorials=true` で memorials と memorialHolidays を同梱

### 変更ファイル

- 新規: `src/components/AuthProvider.tsx`
- 修正: `src/app/layout.tsx`, `src/app/api/tasks/route.ts`, `src/app/top/page.tsx`, `src/app/task/page.tsx`, `src/app/weekly/page.tsx`, `src/app/search/page.tsx`, `src/app/memorial/page.tsx`, `src/app/settings/notifications/page.tsx`, `src/app/settings/event-calendar/page.tsx`

### 効果見積

タスク保存→`/top`表示までの並行リクエスト本数：**約32本 → 2本（94%削減）**

---

## Step 2: TanStack Query 導入（症状が残ったら実施）

### 目的

楽観的更新・キャッシュ・バックグラウンド再フェッチの「自前管理」を全廃し、
状態整合 race condition の根本原因を解消する。

### 影響範囲

- 既存の `src/lib/tasksCache.ts`（自前 localStorage/sessionStorage キャッシュ）を**全廃**
- `/top`, `/task`, `/weekly`, `/search`, `/memorial` の状態管理を全面的に書き直し
- 楽観的更新は `useMutation` の `onMutate` パターンに統一
- 失敗時のロールバックも標準化

### 想定タスクリスト

1. `npm install @tanstack/react-query` で依存追加
2. `src/components/QueryClientProvider.tsx`（新規）を作って layout.tsx に組込
3. Query Key 設計：`['tasks', dateStr]`, `['memorials', dateStr]`, `['memorialHolidays']` など
4. `useTasksForDate(date)` カスタムフック新設、`/top`・`/weekly` で使用
5. `useTaskMutation()` で POST/PUT/DELETE/completion を統一、`onMutate` で楽観的更新、`onError` で rollback
6. `tasksCache.ts` を削除、各画面の自前キャッシュロジックを撤去
7. `/api/tasks` の GET を SWR 的に Stale-While-Revalidate キャッシング
8. ローカル動作確認 → デプロイ

### 想定所要時間

実作業 1〜1.5 日相当。

### 注意点

- TanStack Query v5 を使う（最新）
- React 19 と互換性あり
- Next.js App Router での Provider 配置は `'use client'` ラッパー必須

---

## Step 3: carryover_from_date 廃止（Step 2 後も残れば実施）

### 目的

引継ぎ機能の複雑性を根本から取り除く。
Phase 11〜15 で積み上げた `carryover_from_date` カラム＋専用クエリ群を全廃。

### 戦略

「引継ぎタスクは元の日付に普通に completed=1 を書く」だけ。
今日に表示するロジックはクライアント側だけで「過去N日で未完了の単発/繰り返しタスクを今日のリストに追加表示する」と決める。
完了したら自動的に completed=1 になるので、翌日からはどちらにも出ない。

### 影響範囲

- DB スキーマ: `task_completions.carryover_from_date` カラム削除
- `src/lib/tasks.ts` の `getCarryoverCompletionsBatch`, `getCarryoverAwayTaskIds`, `getPastCarryoverCompletedForDate` 全削除
- `getTasksForDateUnified` を大幅簡素化
- `src/app/top/page.tsx` の `carryoverFromDate` 送信処理削除
- `src/app/api/tasks/completion/route.ts` の `carryoverFromDate` パラメータ削除
- `src/app/api/tasks/[taskId]/route.ts` の `carryover_from_date` 検索削除
- 編集画面の「●月●日に完了」表示は維持（`task_completions.completed_date` の差から計算）

### 想定タスクリスト

1. **migration SQL を Claude が用意**：
   - 既存の `carryover_from_date IS NOT NULL` レコードを `completed_date = carryover_from_date` に書き換える
   - 完了済み引継ぎは「元の日付に completed=1」として扱う
2. **ユーザが本番 D1 に SQL を流す**（Claude からは流せない、慎重に）
3. コード修正をデプロイ

### 想定所要時間

実作業 1日相当 + ユーザの DB 操作待ち。

### 注意点

- 本番データに**不可逆操作**を含む。事前バックアップ（エクスポート）必須
- migration SQL は idempotent に書く
- スキーマからカラム削除は SQLite の制約上 ALTER TABLE で直接できないので、新テーブル作成→データコピー→旧テーブル削除→リネームの手順

---

## ロールバック手順（共通）

何か壊れた場合は、最後のコミットを revert してデプロイし直す。

```powershell
git revert HEAD
git push origin main
npx opennextjs-cloudflare build
npx wrangler deploy
```

---

## 過去ログ参照

詳細な経緯は以下を参照：
- `.claude/MEMORY.md`（プロジェクトメモリ：Phase 1〜15 の全履歴）
- 自動メモリ：`C:\Users\itonl\.claude\projects\c--Users-itonl-Desktop-01-Frontend-sakutto-task-cloudflare\memory\MEMORY.md`

---

## Claude の次回行動指針

1. ユーザから「ぐるぐる」「500」関連の相談があったら、まずこの NEXT_STEPS.md を読む
2. 現状（Step 1 完了済みか、Step 2 まで完了しているか）を確認
3. ユーザに体感と DevTools の状況をヒアリング
4. 上記の判断フローに従い、Step 2 か Step 3 か「ここで完了」を判断
5. 修正前に**必ずユーザの承認を取る**
