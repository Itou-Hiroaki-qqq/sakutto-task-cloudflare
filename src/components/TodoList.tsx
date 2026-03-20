'use client';

import { DisplayTask } from '@/types/database';
import { format, isSameDay } from 'date-fns';
import { ja } from 'date-fns/locale';
import { getHoliday } from '@/lib/holidays';
import Link from 'next/link';

interface TodoListProps {
    date: Date;
    tasks: DisplayTask[];
    onToggleCompletion: (taskId: string, completed: boolean) => void;
    memorials?: Array<{ id: string; title: string }>;
}

export default function TodoList({ date, tasks, onToggleCompletion, memorials = [] }: TodoListProps) {
    const holiday = getHoliday(date);
    const dateStr = format(date, 'yyyy年M月d日(E)', { locale: ja });

    // ソート: 未完了(通常) → 未完了(引継ぎ) → 完了(通常) → 完了(引継ぎ)
    const sortedTasks = tasks
        .map((task, index) => ({ task, index }))
        .sort((a, b) => {
            // 1. 完了状態で分ける（未完了が先）
            if (a.task.completed !== b.task.completed) {
                return a.task.completed ? 1 : -1;
            }
            // 2. 同じ完了状態内で、引継ぎタスクは後ろ
            const aCarryover = a.task.is_carryover ? 1 : 0;
            const bCarryover = b.task.is_carryover ? 1 : 0;
            if (aCarryover !== bCarryover) {
                return aCarryover - bCarryover;
            }
            // 3. 元の順序を維持
            return a.index - b.index;
        })
        .map(({ task }) => task);

    return (
        <div className="todo-zone">
            {holiday && (
                <div className="alert alert-info mb-4">
                    <span>{holiday.name}</span>
                </div>
            )}

            {memorials.map((memorial) => (
                <div key={memorial.id} className="alert alert-success mb-4">
                    <span>{memorial.title}</span>
                </div>
            ))}

            <h2 className="text-xl font-bold mb-4">{dateStr}</h2>

            <div className="space-y-2">
                {sortedTasks.map((task) => (
                    <TodoItem
                        key={task.id}
                        task={task}
                        onToggleCompletion={onToggleCompletion}
                    />
                ))}

                {tasks.length === 0 && (
                    <div className="text-center text-base-content/50 py-8">
                        この日にタスクはありません
                    </div>
                )}
            </div>
        </div>
    );
}

function TodoItem({
    task,
    onToggleCompletion,
}: {
    task: DisplayTask;
    onToggleCompletion: (taskId: string, completed: boolean) => void;
}) {
    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onToggleCompletion(task.task_id, e.target.checked);
    };

    // 引継ぎタスクの場合は original_date を使ったURLでリンク先を設定する
    const taskLinkHref = task.is_carryover
        ? `/task?taskId=${task.task_id}&date=${format(task.original_date!, 'yyyy-MM-dd')}&carryover=true&returnUrl=${encodeURIComponent('/top')}`
        : `/task?taskId=${task.task_id}&date=${format(task.date, 'yyyy-MM-dd')}&returnUrl=${encodeURIComponent('/top')}`;

    return (
        <div className={`flex items-center gap-3 p-3 rounded-lg shadow hover:shadow-md transition-shadow ${
            task.is_carryover ? 'bg-warning/10' : 'bg-base-100'
        }`}>
            <input
                type="checkbox"
                className="checkbox checkbox-primary"
                checked={task.completed}
                onChange={handleCheckboxChange}
            />
            <Link
                href={taskLinkHref}
                className={`flex-1 cursor-pointer ${task.completed
                    ? 'line-through text-base-content/50'
                    : 'text-base-content'
                    }`}
            >
                <div className="flex items-center gap-2">
                    {task.is_carryover && (
                        <span className="material-icons text-warning text-sm">warning</span>
                    )}
                    {task.notification_time && (
                        <span className="badge badge-outline badge-sm">
                            {task.notification_time}
                        </span>
                    )}
                    <span className="whitespace-pre-line">{task.title}</span>
                </div>
            </Link>
        </div>
    );
}
