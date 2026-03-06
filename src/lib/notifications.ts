import { Resend } from 'resend';
import { getDB } from './db';
import { format, isSameDay } from 'date-fns';
import { ja } from 'date-fns/locale';
import { shouldIncludeRecurringTaskWithExclusions } from './tasks';

// Resendクライアントの初期化（環境変数はgetCloudflareContextから取得するため実行時に初期化）
function getResendClient(apiKey: string | undefined) {
    return apiKey ? new Resend(apiKey) : null;
}

// 通知送信が必要なタスクを取得
export async function getTasksToNotify(
    targetDate: Date,
    targetTime: string, // HH:mm形式
    resendApiKey?: string
): Promise<
    Array<{
        taskId: string;
        userId: string;
        title: string;
        dueDate: Date;
        notificationTime: string;
    }>
> {
    const db = await getDB();

    const { results: tasks } = await db
        .prepare(`
            SELECT
                t.id as task_id, t.user_id, t.title, t.due_date, t.notification_time,
                tr.type as recurrence_type, tr.custom_days, tr.custom_unit,
                tr.weekdays as recurrence_weekdays
            FROM tasks t
            LEFT JOIN task_recurrences tr ON t.id = tr.task_id
            WHERE
                t.notification_enabled = 1
                AND TRIM(t.notification_time) = TRIM(?)
        `)
        .bind(targetTime)
        .all<any>();

    const result: Array<{
        taskId: string;
        userId: string;
        title: string;
        dueDate: Date;
        notificationTime: string;
    }> = [];

    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);

        if (!task.recurrence_type) {
            if (isSameDay(taskDueDate, targetDate)) {
                result.push({
                    taskId: task.task_id,
                    userId: task.user_id,
                    title: task.title,
                    dueDate: taskDueDate,
                    notificationTime: task.notification_time,
                });
            }
        } else {
            // 除外日を取得してからチェック
            const { results: exclusionRows } = await db
                .prepare('SELECT excluded_date, exclusion_type FROM task_exclusions WHERE task_id = ?')
                .bind(task.task_id)
                .all<any>();

            const exclusions = exclusionRows.map((ex: any) => ({
                excluded_date: new Date(ex.excluded_date),
                exclusion_type: ex.exclusion_type,
            }));

            const weekdays = task.recurrence_weekdays
                ? (() => { try { return JSON.parse(task.recurrence_weekdays); } catch { return null; } })()
                : null;

            const shouldInclude = shouldIncludeRecurringTaskWithExclusions(
                task.task_id,
                task.recurrence_type,
                taskDueDate,
                targetDate,
                task.custom_days ?? null,
                task.custom_unit ?? null,
                weekdays,
                exclusions
            );

            if (shouldInclude) {
                result.push({
                    taskId: task.task_id,
                    userId: task.user_id,
                    title: task.title,
                    dueDate: taskDueDate,
                    notificationTime: task.notification_time,
                });
            }
        }
    }

    return result;
}

// メール通知を送信
export async function sendEmailNotification(
    email: string,
    taskTitle: string,
    dueDate: Date,
    notificationTime: string,
    apiKey: string,
    fromEmail: string
): Promise<{ success: boolean; error?: string }> {
    const resend = getResendClient(apiKey);
    if (!resend) {
        const errorMsg = 'Resend API key is not configured';
        console.error(errorMsg);
        return { success: false, error: errorMsg };
    }

    try {
        const formattedDate = format(dueDate, 'yyyy年M月d日(E)', { locale: ja });
        const subject = `【さくっとタスク】${taskTitle} の通知`;
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">タスクの通知</h2>
                <p>以下のタスクの期日・通知時刻になりました。</p>
                <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">${taskTitle}</h3>
                    <p><strong>期日:</strong> ${formattedDate}</p>
                    <p><strong>通知時刻:</strong> ${notificationTime}</p>
                </div>
                <p style="color: #666; font-size: 14px;">
                    このメールは、さくっとタスクの通知設定により自動送信されました。
                </p>
            </div>
        `;

        const result = await resend.emails.send({
            from: fromEmail || 'Sakutto Task <onboarding@resend.dev>',
            to: email,
            subject: subject,
            html: htmlContent,
        });

        if (result.error) {
            const errorMsg = `Resend API error: ${JSON.stringify(result.error)}`;
            console.error('[Email] Failed to send email notification:', result.error);
            return { success: false, error: errorMsg };
        }

        return { success: true };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Email] Error sending email notification:', error);
        return { success: false, error: errorMsg };
    }
}

// 指定日・時刻の通知をすべて送信
export async function sendNotificationsForDateTime(
    targetDate: Date,
    targetTime: string,
    apiKey: string,
    fromEmail: string
): Promise<{ emailCount: number; errors: string[] }> {
    const db = await getDB();
    const tasks = await getTasksToNotify(targetDate, targetTime);

    if (tasks.length === 0) {
        return { emailCount: 0, errors: [] };
    }

    const errors: string[] = [];
    let emailCount = 0;

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        const setting = await db
            .prepare('SELECT email, email_notification_enabled FROM user_notification_settings WHERE user_id = ? LIMIT 1')
            .bind(task.userId)
            .first<any>();

        if (!setting) continue;

        if (setting.email_notification_enabled === 1 && setting.email) {
            // Resendのレート制限（2リクエスト/秒）に対応するため、前のメール送信から0.6秒待機
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 600));
            }
            const emailResult = await sendEmailNotification(
                setting.email,
                task.title,
                task.dueDate,
                task.notificationTime,
                apiKey,
                fromEmail
            );
            if (emailResult.success) {
                emailCount++;
            } else {
                const errorMsg = emailResult.error
                    ? `Failed to send email to ${setting.email}: ${emailResult.error}`
                    : `Failed to send email to user ${task.userId} for task ${task.taskId}`;
                errors.push(errorMsg);
                console.error(`[Notification] ${errorMsg}`);

                if (emailResult.error && emailResult.error.includes('rate_limit')) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
    }

    return { emailCount, errors };
}
