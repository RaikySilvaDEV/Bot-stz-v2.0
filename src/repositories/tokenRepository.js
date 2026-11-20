import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIRECTORY, readJsonData, writeJsonData } from '../data/jsonStore.js';

const FILE = 'tokens.json';
const legacyFiles = [
    path.resolve(DATA_DIRECTORY, '../src/commands/tokens.json'),
    path.join(DATA_DIRECTORY, 'access-tokens.json')
];

export function getAccessTokens() {
    let tokens = readJsonData(FILE, {});
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) throw new TypeError('O arquivo de tokens precisa conter um objeto.');
    // Migra as versões anteriores sem perder tokens já utilizados pelo aplicativo.
    for (const file of legacyFiles) {
        if (!fs.existsSync(file)) continue;
        const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new TypeError('Arquivo legado de tokens inválido.');
        tokens = { ...legacy, ...tokens };
        writeJsonData(FILE, tokens);
        fs.unlinkSync(file);
    }
    return tokens;
}

export function saveAccessTokens(tokens) {
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) throw new TypeError('Tokens inválidos.');
    writeJsonData(FILE, tokens);
}

export function createAccessToken(userId, type) {
    const tokens = getAccessTokens();
    const prefix = type === 'test' ? 'TEST' : 'GOATS';
    let code;
    do { code = `${prefix}-${randomBytes(8).toString('hex').toUpperCase()}`; } while (tokens[code]);
    tokens[code] = {
        type, createdAt: Date.now(), discordId: userId, hwid: null, boundUsername: null,
        expiresAt: Date.now() + (type === 'test' ? 3 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000)
    };
    saveAccessTokens(tokens);
    return code;
}

export function resetAccessToken(code) {
    const tokens = getAccessTokens();
    if (!Object.hasOwn(tokens, code)) return false;
    tokens[code].hwid = null;
    // Mantém a conta proprietária para impedir a reutilização em outra conta.
    saveAccessTokens(tokens);
    return true;
}
