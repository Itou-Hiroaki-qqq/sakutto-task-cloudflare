const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.migration');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) return;
        process.env[trimmed.substring(0, eqIndex).trim()] = trimmed.substring(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    });
}

const client = new Client({ connectionString: process.env.NEON_DATABASE_URL });
client.connect()
    .then(() => client.query('SELECT DISTINCT user_id FROM tasks UNION SELECT DISTINCT user_id FROM memorials'))
    .then(r => {
        console.log('旧アプリのユーザーID一覧:');
        r.rows.forEach(row => console.log(' ', row.user_id));
        client.end();
    })
    .catch(e => { console.error(e.message); client.end(); });
