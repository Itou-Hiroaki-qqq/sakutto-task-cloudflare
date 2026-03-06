import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getTasksForDateRange } from '@/lib/tasks';
import { format, parseISO, addMonths, subMonths } from 'date-fns';

export async function GET(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const startDateStr = searchParams.get('startDate');
        const endDateStr = searchParams.get('endDate');
        const centerDateStr = searchParams.get('centerDate');

        let startDate: Date;
        let endDate: Date;

        if (centerDateStr) {
            const centerDate = parseISO(centerDateStr);
            startDate = subMonths(centerDate, 1);
            endDate = addMonths(centerDate, 1);
        } else if (startDateStr && endDateStr) {
            startDate = parseISO(startDateStr);
            endDate = parseISO(endDateStr);
        } else {
            const today = new Date();
            startDate = subMonths(today, 1);
            endDate = addMonths(today, 1);
        }

        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        const tasksByDate = await getTasksForDateRange(payload.uid, startDate, endDate);

        const tasksObject: Record<string, any[]> = {};
        tasksByDate.forEach((tasks, dateStr) => {
            tasksObject[dateStr] = tasks;
        });

        return NextResponse.json({
            tasks: tasksObject,
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd'),
        });
    } catch (error) {
        console.error('Error fetching tasks range:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
