import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { toggleTaskCompletion } from '@/lib/tasks';

export async function POST(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json() as any;
        const { taskId, date, completed, carryoverFromDate } = body;

        if (!taskId || !date || typeof completed !== 'boolean') {
            return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
        }

        await toggleTaskCompletion(taskId, new Date(date), completed, carryoverFromDate || undefined);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error toggling task completion:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
