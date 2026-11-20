import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);

export async function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = await deriveKey(password, salt, 64);
    return `scrypt:${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
    if (typeof stored !== 'string') return false;
    let expected;
    let supplied;
    if (/^[a-f0-9]{64}$/i.test(stored)) {
        // Contas antigas continuam acessíveis e são atualizadas no próximo login.
        expected = Buffer.from(stored, 'hex');
        supplied = createHash('sha256').update(password).digest();
    } else {
        const [version, salt, hash] = stored.split(':');
        if (version !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
        expected = Buffer.from(hash, 'hex');
        supplied = await deriveKey(password, salt, 64);
    }
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
