// Cloudflare Workers対応: bcryptの代わりにPBKDF2 (Web Crypto API) を使用

const ITERATIONS = 100_000;
const KEY_LENGTH = 256; // bits

export async function hashPassword(password: string): Promise<string> {
    const enc = new TextEncoder();
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = Array.from(saltBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const hashBuffer = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        KEY_LENGTH
    );
    const hash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    return `${salt}:${hash}`; // "salt:hash" 形式で保存
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [salt, storedHash] = stored.split(':');
    if (!salt || !storedHash) return false;

    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const hashBuffer = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        KEY_LENGTH
    );
    const hash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    return hash === storedHash;
}
