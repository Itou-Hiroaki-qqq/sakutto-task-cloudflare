import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getCloudflareContext } from '@opennextjs/cloudflare';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.5-flash';

interface ExtractedEvent {
    date: string;
    title: string;
    description?: string;
    type?: string;
    keyword: string;
}

async function fileToBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function processWithGemini(
    base64Images: string[],
    mimeTypes: string[],
    apiKey: string
): Promise<ExtractedEvent[]> {
    const prompt = `以下の画像は学校や会社の年間行事予定表です。画像から行事予定を抽出して、以下のJSON形式で返してください。

{
    "events": [
    {
        "date": "YYYY-MM-DD形式の日付",
        "title": "行事のタイトル（時刻が含まれる場合は「HH:mm 行事名」の形式）",
        "description": "説明（あれば）",
        "type": "全校/2年/3年/会議/イベントなど",
        "keyword": "予定表を識別するキーワード（例: 三小、会社など）"
    }
    ]
}

注意事項:
- 日付は必ずYYYY-MM-DD形式で出力してください
- 年度表記があれば判定してください（例: 令和7年度 → 2025年4月～2026年3月）
- keywordは予定表の種類を表す識別子です（学校名、会社名など）
- すべての行事を抽出してください
- タイトルは予定表に記載されている通り、完全に抽出してください。括弧や数字（例: (6)、(1)(2)など）を含む場合は、それらも省略せずに含めてください。
- 予定表に時刻が記載されている場合、タイトルに時刻を含めて抽出してください（例: 「11:00 元旦会」）

JSONのみを返してください。`;

    const parts: any[] = [{ text: prompt }];
    for (let i = 0; i < base64Images.length; i++) {
        parts.push({ inline_data: { mime_type: mimeTypes[i], data: base64Images[i] } });
    }

    const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Gemini API error: ${response.status}`;
        try {
            const errorData = JSON.parse(errorText);
            if (errorData.error?.message) errorMessage += ` - ${errorData.error.message}`;
        } catch {
            if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
        }
        throw new Error(errorMessage);
    }

    const data = await response.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('No response from Gemini API');

    let jsonText = text.trim();
    if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(jsonText);
    return parsed.events || [];
}

export async function POST(request: NextRequest) {
    try {
        const payload = await getAuthUser(request);
        if (!payload) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { env } = await getCloudflareContext({ async: true });
        const apiKey = env.GEMINI_API_KEY;

        if (!apiKey) {
            return NextResponse.json({ error: 'GEMINI_API_KEY is not set' }, { status: 500 });
        }

        const formData = await request.formData();
        const files = formData.getAll('files') as File[];

        if (files.length === 0) {
            return NextResponse.json({ error: 'No files provided' }, { status: 400 });
        }
        if (files.length > 2) {
            return NextResponse.json({ error: 'Maximum 2 files allowed' }, { status: 400 });
        }

        const base64Images: string[] = [];
        const mimeTypes: string[] = [];

        for (const file of files) {
            const mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
            const base64 = await fileToBase64(file);
            base64Images.push(base64);
            mimeTypes.push(mimeType);
        }

        const events = await processWithGemini(base64Images, mimeTypes, apiKey);

        return NextResponse.json({ events });
    } catch (error) {
        console.error('Error in upload endpoint:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
