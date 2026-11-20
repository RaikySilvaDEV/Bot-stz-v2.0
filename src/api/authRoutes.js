import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadTokens, saveTokens } from '../commands/tokensStore.js';

import { getAppUsers as loadUsers, saveAppUsers as saveUsers } from '../repositories/appUsersRepository.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';

function responderJson(res, status, dados) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(dados));
}

export async function handleAppAuthRoute(req, res, url, lerJson) {
    if (!url.pathname.startsWith('/api/auth/')) return false;

    if (req.method !== 'POST') {
        responderJson(res, 405, { success: false, message: 'Método não permitido.' });
        return true;
    }

    let body = {};
    try {
        body = await lerJson(req);
    } catch (err) {
        responderJson(res, err.status || 400, { success: false, message: err.message });
        return true;
    }

    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.values(body).some(value => typeof value !== 'string' || value.length > 1024)) {
        responderJson(res, 400, { success: false, message: 'Dados inválidos.' });
        return true;
    }

    // --- ROTA DE REGISTRO E VINCULAÇÃO DE TOKEN ---
    if (url.pathname === '/api/auth/register') {
        const { username, password, token, hwid } = body || {};
        if (!username || !password || !token || !hwid) {
            responderJson(res, 400, { success: false, message: 'Preencha todos os campos.' });
            return true;
        }

        const passwordHash = await hashPassword(password);
        const tokens = loadTokens();
        const cleanToken = String(token).trim();
        const tokenData = tokens[cleanToken];

        if (!tokenData) {
            responderJson(res, 404, { success: false, message: 'Token inválido ou inexistente.' });
            return true;
        }
        if (Date.now() > Number(tokenData.expiresAt)) {
            responderJson(res, 400, { success: false, message: 'Este token já expirou.' });
            return true;
        }
        if (tokenData.boundUsername || loadUsers().some(u => u.token === cleanToken)) {
            responderJson(res, 409, { success: false, message: 'Token já vinculado a uma conta.' });
            return true;
        }
        if (tokenData.hwid && tokenData.hwid !== hwid) {
            responderJson(res, 403, { success: false, message: 'Este token já está vinculado a outro computador!' });
            return true;
        }

        const users = loadUsers();
        const cleanUser = String(username).trim();
        if (users.some(u => u.username.toLowerCase() === cleanUser.toLowerCase())) {
            responderJson(res, 409, { success: false, message: 'Este nome de utilizador já existe.' });
            return true;
        }

        tokenData.hwid = hwid;
        tokenData.boundUsername = cleanUser;
        saveTokens(tokens);

        users.push({
            username: cleanUser,
            passwordHash,
            token: cleanToken,
            hwid,
            lastSeen: Date.now()
        });
        saveUsers(users);

        responderJson(res, 200, { success: true, message: 'Conta criada e token vinculado!' });
        return true;
    }

    // --- ROTA DE LOGIN E VALIDAÇÃO DE HWID / EXPIRAÇÃO ---
    if (url.pathname === '/api/auth/login') {
        const { username, password, hwid } = body || {};
        if (!username || !password || !hwid) {
            responderJson(res, 400, { success: false, message: 'Dados incompletos.' });
            return true;
        }

        const users = loadUsers();
        const cleanUser = String(username).trim();
        const user = users.find(u => u.username.toLowerCase() === cleanUser.toLowerCase());

        if (!user || !await verifyPassword(password, user.passwordHash)) {
            responderJson(res, 401, { success: false, message: 'Utilizador ou palavra-passe incorretos.' });
            return true;
        }

        const tokens = loadTokens();
        const tokenData = tokens[user.token];
        const now = Date.now();

        if (!tokenData || !tokenData.expiresAt || now >= Number(tokenData.expiresAt)) {
            responderJson(res, 403, { success: false, message: 'O seu token expirou! Renove no Discord.' });
            return true;
        }

        if (!user.passwordHash.startsWith('scrypt:')) user.passwordHash = await hashPassword(password);
        let changed = false;
        if (!tokenData.hwid) {
            tokenData.hwid = hwid;
            tokenData.boundUsername = user.username;
            saveTokens(tokens);
            user.hwid = hwid;
            changed = true;
        } else if (tokenData.hwid !== hwid) {
            responderJson(res, 403, { success: false, message: 'Segurança: HWID incompatível com esta conta!' });
            return true;
        }

        user.lastSeen = now;
        changed = true;
        if (changed) saveUsers(users);

        responderJson(res, 200, {
            success: true,
            message: 'Autenticado! A abrir painel...',
            expiresAt: Number(tokenData.expiresAt)
        });
        return true;
    }

    // --- ROTA DE VERIFICAÇÃO CONTÍNUA (CONTA EXCLUÍDA / TOKEN EXPIRADO) ---
    if (url.pathname === '/api/auth/verify') {
        const { username, hwid } = body || {};
        if (!username || !hwid) {
            responderJson(res, 400, { valid: false, reason: 'invalid_request', message: 'Usuário não informado.' });
            return true;
        }

        const users = loadUsers();
        const cleanUser = String(username).trim().toLowerCase();
        const userIndex = users.findIndex(u => u.username.toLowerCase() === cleanUser);

        if (userIndex === -1) {
            responderJson(res, 401, {
                valid: false,
                reason: 'account_deleted',
                message: 'Sua conta foi removida do sistema.'
            });
            return true;
        }

        const user = users[userIndex];
        const tokens = loadTokens();
        const tokenData = user.token ? tokens[user.token] : null;
        const now = Date.now();

        if (!tokenData || !tokenData.expiresAt || now >= Number(tokenData.expiresAt)) {
            responderJson(res, 403, {
                valid: false,
                reason: 'token_expired',
                message: 'O tempo do seu token acabou! Renove para continuar.'
            });
            return true;
        }

        if (!tokenData.hwid || tokenData.hwid !== hwid) {
            responderJson(res, 403, {
                valid: false,
                reason: 'hwid_mismatch',
                message: 'HWID incompatível com o token vinculado.'
            });
            return true;
        }

        if (now - (Number(user.lastSeen) || 0) >= 10000) {
            users[userIndex].lastSeen = now;
            saveUsers(users);
        }

        responderJson(res, 200, {
            valid: true,
            expiresAt: Number(tokenData.expiresAt),
            remainingMs: Math.max(0, Number(tokenData.expiresAt) - now)
        });
        return true;
    }

    responderJson(res, 404, { success: false, message: 'Rota de autenticação inválida.' });
    return true;
}