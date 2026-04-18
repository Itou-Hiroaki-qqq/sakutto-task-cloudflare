-- Phase 15: task_completions テーブルの carryover_from_date 検索を高速化
-- getTasksForDateUnified / getCarryoverCompletionsBatch / getCarryoverAwayTaskIds
-- が carryover_from_date で絞り込むため、部分インデックスを追加する

CREATE INDEX IF NOT EXISTS idx_task_completions_carryover
    ON task_completions(task_id, carryover_from_date)
    WHERE carryover_from_date IS NOT NULL;
