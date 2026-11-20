import { consumeDashboardLoginTicket } from './dashboardAuth.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { loadTokens, saveTokens } from '../commands/tokensStore.js';
import { getApiStatus } from './server.js';
import { client } from '../client.js';

import { getAppUsers as loadUsers, saveAppUsers as saveUsers } from '../repositories/appUsersRepository.js';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const sessions = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
function newSession() {
    const token = crypto.randomBytes(32).toString('base64url');
    for (const [key, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(key);
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
}

const UNIT_MS = {
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000
};

function calcularDuracaoMs(amount, unit) {
    const qtd = Number(amount);
    const fator = UNIT_MS[unit];
    if (!Number.isFinite(qtd) || qtd <= 0 || !fator) return null;
    return Math.round(qtd * fator);
}

function autenticado(req) {
    const token = (req.headers.authorization?.replace(/^Bearer\s+/i, '') || '').trim();
    return (sessions.get(token) || 0) > Date.now();
}

function responderJson(res, status, dados) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(dados));
}

function responderHtml(res, html) {
    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(html);
}

export async function handleForGoatsWebRoute(req, res, url, lerJson) {
    if (req.method === 'GET' && (url.pathname === '/forgoats' || url.pathname === '/forgoats/')) {
        responderHtml(res, renderForGoatsHtml());
        return true;
    }

    if (req.method === 'GET' && url.pathname === '/painel/community-for-goats-logo.jpg') {
        const logoPath = path.join(PUBLIC_DIR, 'community-for-goats-logo.jpg');
        try {
            const image = fs.readFileSync(logoPath);
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'public, max-age=3600',
                'X-Content-Type-Options': 'nosniff'
            });
            res.end(image);
        } catch (error) {
            console.error('[forgoats-web] Não foi possível carregar a logo:', error);
            responderJson(res, 500, { success: false, message: 'Logo do painel indisponível.' });
        }
        return true;
    }

    if (!url.pathname.startsWith('/api/forgoats/')) return false;

    if (req.method === 'POST' && url.pathname === '/api/forgoats/login-ticket') {
        const body = await lerJson(req);
        if (!consumeDashboardLoginTicket(body?.ticket)) {
            responderJson(res, 401, { success: false, message: 'Este acesso expirou ou já foi utilizado.' });
            return true;
        }
        const token = crypto.randomBytes(32).toString('base64url');
        sessions.set(token, Date.now() + SESSION_TTL_MS);
        responderJson(res, 200, { success: true, sessionToken: token });
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/forgoats/login') {
        const body = await lerJson(req).catch(() => ({}));
        const user = String(body?.username || '').trim().toLowerCase();
        const pass = String(body?.password || '').trim();

        if (user === (process.env.FORGOATS_WEB_USER || 'forgoats').toLowerCase() && pass && pass === (process.env.FORGOATS_WEB_PASSWORD || process.env.DASHBOARD_PASSWORD || process.env.API_KEY)) {
            responderJson(res, 200, { success: true, sessionToken: newSession() });
        } else {
            responderJson(res, 401, { success: false, message: 'Usuário ou senha inválidos.' });
        }
        return true;
    }

    if (!autenticado(req)) {
        responderJson(res, 401, { success: false, message: 'Sessão expirada. Faça login novamente.' });
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/forgoats/logout') {
        sessions.delete(req.headers.authorization?.replace(/^Bearer\s+/i, '').trim());
        responderJson(res, 200, { success: true });
        return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/forgoats/overview') {
        const tokensObj = loadTokens();
        const users = loadUsers();
        const now = Date.now();
        const apiStatus = getApiStatus();

        const tokens = Object.entries(tokensObj)
            .map(([code, info]) => {
                const expiresAt = Number(info.expiresAt) || 0;
                const remainingMs = Math.max(0, expiresAt - now);
                return {
                    token: code,
                    type: info.type || 'normal',
                    customLabel: info.customLabel || null,
                    createdAt: info.createdAt || null,
                    expiresAt,
                    expired: !expiresAt || now >= expiresAt,
                    remainingMs,
                    discordId: info.discordId || 'Painel Web',
                    hwid: info.hwid || null,
                    boundUsername: info.boundUsername || null
                };
            })
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        const safeUsers = users.map(u => {
            const tInfo = tokensObj[u.token];
            const tokenValid = Boolean(tInfo && Number(tInfo.expiresAt) > now);
            const isOnline = Boolean(u.lastSeen && (now - u.lastSeen) < 35000);
            return {
                username: u.username,
                token: u.token,
                hwid: u.hwid || null,
                online: isOnline,
                lastSeen: u.lastSeen || null,
                tokenValid
            };
        });

        responderJson(res, 200, {
            success: true,
            serverNow: now,
            status: {
                botOnline: Boolean(client?.isReady?.()),
                botTag: client?.user?.tag || 'Community For Goats',
                pingMs: Math.max(0, Math.round(client?.ws?.ping ?? 0)),
                uptimeMs: client?.uptime ?? Math.round(process.uptime() * 1000),
                apiRunning: Boolean(apiStatus?.running),
                apiPort: apiStatus?.port ?? 3001,
                memMb: Math.round(process.memoryUsage().rss / (1024 * 1024))
            },
            stats: {
                totalTokens: tokens.length,
                activeTokens: tokens.filter(t => !t.expired).length,
                boundTokens: tokens.filter(t => Boolean(t.hwid)).length,
                totalUsers: safeUsers.length,
                onlineUsers: safeUsers.filter(u => u.online).length
            },
            tokens,
            users: safeUsers
        });
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/forgoats/tokens/create') {
        const body = await lerJson(req).catch(() => ({}));
        const tokens = loadTokens();
        const now = Date.now();

        let durationMs;
        let type = 'normal';
        let customLabel = null;
        let prefix = 'GOATS-';

        if (body?.type === 'custom') {
            durationMs = calcularDuracaoMs(body?.amount, body?.unit);
            if (!durationMs) {
                responderJson(res, 400, { success: false, message: 'Informe um tempo válido maior que zero.' });
                return true;
            }
            const unitNames = { minutes: 'min', hours: 'h', days: 'd' };
            type = 'custom';
            customLabel = `${Number(body.amount)}${unitNames[body.unit]}`;
            prefix = 'TIME-';
        } else if (body?.type === 'test') {
            durationMs = 3 * 60 * 1000;
            type = 'test';
            customLabel = '3min';
            prefix = 'TEST-';
        } else {
            durationMs = 30 * 24 * 60 * 60 * 1000;
            type = 'normal';
            customLabel = '30d';
            prefix = 'GOATS-';
        }

        const code = prefix + crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 8);

        tokens[code] = {
            type,
            customLabel,
            createdAt: now,
            expiresAt: now + durationMs,
            discordId: 'Painel Web',
            hwid: null,
            boundUsername: null
        };
        saveTokens(tokens);

        responderJson(res, 201, {
            success: true,
            token: code,
            expiresAt: tokens[code].expiresAt
        });
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/forgoats/tokens/update-time') {
        const body = await lerJson(req).catch(() => ({}));
        const code = String(body?.token || '').trim();
        const mode = body?.mode === 'add' ? 'add' : 'set';
        const amount = Number(body?.amount);
        const unit = body?.unit;
        const fator = UNIT_MS[unit];

        const tokens = loadTokens();
        if (!tokens[code]) {
            responderJson(res, 404, { success: false, message: 'Token não encontrado.' });
            return true;
        }
        if (!Number.isFinite(amount) || amount === 0 || !fator) {
            responderJson(res, 400, { success: false, message: 'Valor ou unidade de tempo inválidos.' });
            return true;
        }

        const now = Date.now();
        const deltaMs = Math.round(amount * fator);

        if (mode === 'add') {
            const base = Math.max(now, Number(tokens[code].expiresAt) || now);
            tokens[code].expiresAt = Math.max(now, base + deltaMs);
        } else {
            if (deltaMs <= 0) {
                responderJson(res, 400, { success: false, message: 'Para definir tempo, informe um número positivo.' });
                return true;
            }
            tokens[code].expiresAt = now + deltaMs;
        }

        const unitNames = { minutes: 'min', hours: 'h', days: 'd' };
        tokens[code].customLabel = `${mode === 'add' ? '+' : ''}${amount}${unitNames[unit]}`;
        saveTokens(tokens);

        responderJson(res, 200, {
            success: true,
            message: `Tempo do token ${code} atualizado com sucesso!`,
            expiresAt: tokens[code].expiresAt
        });
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/forgoats/tokens/reset-hwid') {
        const body = await lerJson(req).catch(() => ({}));
        const code = String(body?.token || '').trim();
        const tokens = loadTokens();

        if (!tokens[code]) {
            responderJson(res, 404, { success: false, message: 'Token não encontrado.' });
            return true;
        }

        tokens[code].hwid = null;
        tokens[code].boundUsername = null;
        saveTokens(tokens);

        responderJson(res, 200, { success: true, message: `HWID de ${code} resetado.` });
        return true;
    }

    const deleteTokenMatch = url.pathname.match(/^\/api\/forgoats\/tokens\/([^/]+)$/);
    if (req.method === 'DELETE' && deleteTokenMatch) {
        const code = decodeURIComponent(deleteTokenMatch[1]);
        const tokens = loadTokens();

        if (!tokens[code]) {
            responderJson(res, 404, { success: false, message: 'Token não encontrado.' });
            return true;
        }

        delete tokens[code];
        saveTokens(tokens);

        responderJson(res, 200, { success: true, message: `Token ${code} revogado.` });
        return true;
    }

    const deleteUserMatch = url.pathname.match(/^\/api\/forgoats\/users\/([^/]+)$/);
    if (req.method === 'DELETE' && deleteUserMatch) {
        const targetUser = decodeURIComponent(deleteUserMatch[1]).toLowerCase();
        const users = loadUsers();
        const filtered = users.filter(u => u.username.toLowerCase() !== targetUser);
        saveUsers(filtered);
        responderJson(res, 200, { success: true, message: 'Conta removida.' });
        return true;
    }

    responderJson(res, 404, { success: false, message: 'Rota não encontrada.' });
    return true;
}

function renderForGoatsHtml() {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>Community For Goats • Painel Web</title>
<style>
  :root {
    --bg: #070708;
    --sidebar: #0d0d0f;
    --panel: #121215;
    --panel-2: #18181c;
    --border: #242429;
    --text: #f4f4f6;
    --muted: #8e8e98;
    --accent: #ed4245;
    --accent-hover: #c93235;
    --ok: #22c55e;
  }
  * { box-sizing: border-box; font-family: 'Segoe UI', Inter, system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; overflow-x: hidden; background: var(--bg); color: var(--text); }
  .icon-sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
  .icon { width: 18px; height: 18px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vertical-align: -4px; }
  .login-wrap { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); background: radial-gradient(circle at top, #1b0d0e 0%, #070708 60%); }
  .login-card { background: var(--panel); border: 1px solid var(--border); border-top: 3px solid var(--accent); border-radius: 14px; padding: 32px; width: 100%; max-width: 400px; box-shadow: 0 20px 50px rgba(0,0,0,0.6); }
  .login-brand { margin: 20px 0 0; color: var(--accent); }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 13px; color: var(--text); text-transform: none; letter-spacing: 0; }
  .brand-logo { display: block; width: 52px; height: 52px; flex: 0 0 auto; border-radius: 10px; object-fit: cover; background: var(--panel-2); }
  .brand-logo.small { width: 42px; height: 42px; }
  .sidebar-brand { padding: 0 4px 10px; }
  .brand-copy { min-width: 0; }
  .brand-copy strong { display: block; }
  .brand-copy small { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; font-weight: 500; }
  .sidebar-nav { display: grid; gap: 5px; }
  h1 { margin: 8px 0 6px; font-size: 22px; }
  p { margin: 0 0 20px; color: var(--muted); font-size: 13px; }
  label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  input[type="text"], input[type="password"], input[type="number"], select { width: 100%; min-height: 44px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: #0a0a0c; color: var(--text); outline: none; font-size: 13px; }
  input:focus, select:focus { border-color: var(--accent); }
  .login-card input[type="text"], .login-card input[type="password"] { margin-bottom: 14px; }
  .remember-row { display: flex; align-items: center; gap: 8px; margin: 2px 0 16px; cursor: pointer; user-select: none; }
  .remember-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; margin: 0; }
  .remember-row span { font-size: 13px; color: var(--text); }
  button { min-height: 44px; cursor: pointer; border: none; border-radius: 8px; padding: 10px 14px; font-weight: 600; font-size: 13px; transition: 0.15s; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #ff8587; outline-offset: 2px; }
  button .icon { margin-right: 7px; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-ghost { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
  .btn-ghost:hover { border-color: #444; }
  .btn-danger { background: rgba(237,66,69,0.14); color: #ff6b6e; border: 1px solid rgba(237,66,69,0.3); }
  .btn-danger:hover { background: rgba(237,66,69,0.25); }
  .layout { display: none; min-height: 100vh; min-height: 100dvh; }
  .sidebar { width: 250px; min-width: 0; height: 100vh; height: 100dvh; position: sticky; top: 0; background: var(--sidebar); border-right: 1px solid var(--border); padding: 24px 16px; display: flex; flex: 0 0 250px; flex-direction: column; justify-content: space-between; overflow-y: auto; }
  .nav-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; text-align: left; padding: 10px 12px; border-radius: 8px; background: transparent; color: var(--muted); margin-bottom: 0; font-size: 13px; }
  .nav-item .icon { color: #777780; }
  .nav-item:hover { background: var(--panel); color: var(--text); }
  .nav-item.active { background: rgba(237,66,69,0.15); color: #fff; border-left: 3px solid var(--accent); }
  .nav-item.active .icon { color: #ff888a; }
  .main { flex: 1; min-width: 0; padding: 28px; max-width: 1220px; }
  .mobile-top-logo { display: none; }
  .mobile-bottom-nav { display: none; }
  .section { min-width: 0; }
  .topbar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-bottom: 24px; }
  .stat { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
  .stat span { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
  .stat strong { display: block; font-size: 24px; margin-top: 6px; }
  .section { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 22px; }
  .section-head { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; }
  .form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; padding: 18px 20px; align-items: end; }
  table { width: 100%; min-width: 620px; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #1b1b20; }
  th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
  code { background: #1d1d22; padding: 3px 7px; border-radius: 5px; font-family: Consolas, monospace; color: #fff; }
  .badge { padding: 4px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; display: inline-block; font-variant-numeric: tabular-nums; }
  .badge-ok { background: rgba(34,197,94,0.15); color: var(--ok); }
  .badge-exp { background: rgba(237,66,69,0.15); color: var(--accent); }
  .badge-off { background: rgba(142,142,152,0.15); color: var(--muted); }
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }
  .toast { --toast-duration: 5s; position: fixed; right: max(20px, env(safe-area-inset-right)); bottom: max(20px, env(safe-area-inset-bottom)); display: flex; align-items: center; gap: 11px; width: min(420px, calc(100vw - 32px)); min-height: 58px; padding: 14px 16px 17px; overflow: hidden; border: 1px solid rgba(34,197,94,.42); border-radius: 10px; background: #151a17; color: #e8f7ed; box-shadow: 0 12px 36px rgba(0,0,0,.42); font-size: 13px; opacity: 0; visibility: hidden; transform: translateY(12px); z-index: 99; }
  .toast[hidden] { display: none; }
  .toast.is-visible { visibility: visible; animation: toast-enter .22s ease-out both; }
  .toast.is-hiding { visibility: visible; animation: toast-exit .18s ease-in both; }
  .toast.error { border-color: rgba(237,66,69,.55); background: #201415; color: #ffe7e7; }
  .toast-icon { width: 20px; height: 20px; flex: 0 0 auto; color: var(--ok); }
  .toast.error .toast-icon { color: #ff6b6e; }
  .toast-message { min-width: 0; line-height: 1.45; overflow-wrap: anywhere; }
  .toast-progress { position: absolute; right: 0; bottom: 0; left: 0; height: 3px; border-radius: 0 0 10px 10px; background: var(--ok); transform: scaleX(1); transform-origin: left; }
  .toast.error .toast-progress { background: #ff6b6e; }
  .toast.is-visible .toast-progress { animation: toast-countdown var(--toast-duration) linear both; }
  @keyframes toast-enter { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes toast-exit { to { opacity: 0; transform: translateY(8px); } }
  @keyframes toast-countdown { to { transform: scaleX(0); } }
  @media (max-width: 1000px) {
    .sidebar { width: 220px; flex-basis: 220px; padding: 20px 12px; }
    .main { padding: 22px 18px; }
  }
  @media (max-width: 780px) {
    .layout { flex-direction: column; }
    .sidebar { display: none; }
    .main { width: 100%; max-width: none; padding: 18px 16px calc(108px + env(safe-area-inset-bottom)); }
    .topbar { align-items: flex-start; }
    .topbar > div:first-child { display: flex; align-items: center; gap: 11px; }
    .mobile-top-logo { display: block; width: 42px; height: 42px; flex: 0 0 auto; border: 1px solid var(--border); border-radius: 11px; object-fit: cover; }
    .mobile-page-copy > .brand { display: none; }
    .mobile-bottom-nav { position: fixed; z-index: 30; right: 0; bottom: 0; left: 0; display: flex; align-items: stretch; justify-content: space-around; gap: 5px; padding: 8px max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); border-top: 1px solid rgba(255,255,255,.09); background: rgba(13,13,15,.94); box-shadow: 0 -12px 36px rgba(0,0,0,.32); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
    .mobile-bottom-nav .nav-item { display: flex; flex: 1 1 0; min-width: 0; min-height: 52px; align-items: center; justify-content: center; flex-direction: column; gap: 4px; padding: 5px 2px; border: 0; border-radius: 12px; color: var(--muted); font-size: 10px; font-weight: 750; line-height: 1.1; text-align: center; touch-action: manipulation; }
    .mobile-bottom-nav .nav-item .icon { width: 20px; height: 20px; margin: 0; color: currentColor; }
    .mobile-bottom-nav .nav-item.active { border: 0; background: rgba(237,66,69,.13); color: #fff; box-shadow: none; }
    .mobile-bottom-nav .nav-item.active .icon { color: #ff8587; }
    .mobile-bottom-nav .nav-item:focus-visible { outline: 2px solid #ff8587; outline-offset: 1px; }
    .top-actions { max-width: 100%; }
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .form-row { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 14px; }
    .stat strong { font-size: 21px; overflow-wrap: anywhere; }
    .section-head { padding: 14px; }
    .section > div[style*="overflow-x:auto"] { width: 100%; min-width: 0; overflow-x: auto; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
    .toast { right: max(12px, env(safe-area-inset-right)); bottom: calc(86px + env(safe-area-inset-bottom)); max-width: calc(100vw - 24px); }
  }
  @media (max-width: 480px) {
    .login-wrap { padding-right: 14px; padding-left: 14px; }
    .login-card { padding: 24px 20px; }
    .main { padding-right: 12px; padding-left: 12px; }
    .topbar { flex-direction: column; }
    .topbar > div:first-child { align-self: flex-start; }
    .top-actions { display: grid !important; grid-template-columns: 1fr 1fr; width: 100%; gap: 8px !important; }
    .top-actions button { min-width: 0; padding: 9px; font-size: 12px; }
    .top-actions button:last-child { grid-column: 1 / -1; }
    .grid { grid-template-columns: 1fr 1fr; gap: 9px; }
    .stat { min-width: 0; padding: 12px; }
    .stat span { font-size: 10px; letter-spacing: .03em; }
    .stat strong { font-size: 18px; }
    .form-row { grid-template-columns: 1fr; padding: 12px; }
    .section-head { align-items: flex-start; }
    .section-head strong { overflow-wrap: anywhere; }
    .section table { min-width: 620px; }
    .section > div[style*="overflow-x:auto"] { max-width: 100%; }
    .btn-primary, .btn-ghost, .btn-danger { min-height: 44px; }
    .mobile-bottom-nav { gap: 2px; padding-right: 4px; padding-left: 4px; }
    .mobile-bottom-nav .nav-item { font-size: 9px; }
    input[type="text"], input[type="password"], input[type="number"], select { font-size: 16px; }
  }
  @media (max-width: 340px) {
    .grid { grid-template-columns: 1fr; }
    .brand-copy strong { font-size: 12px; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
  }
</style>
</head>
<body>
<svg class="icon-sprite" aria-hidden="true">
  <symbol id="fg-icon-layout" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M9 21V9"/></symbol>
  <symbol id="fg-icon-key" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3"/></symbol>
  <symbol id="fg-icon-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></symbol>
  <symbol id="fg-icon-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></symbol>
  <symbol id="fg-icon-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
  <symbol id="fg-icon-flask" viewBox="0 0 24 24"><path d="M9 3h6M10 3v7l-5.5 9.2A1.8 1.8 0 0 0 6 22h12a1.8 1.8 0 0 0 1.5-2.8L14 10V3"/><path d="M8 16h8"/></symbol>
  <symbol id="fg-icon-refresh" viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 0-15-6.7L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/><path d="M21 21v-5h-5"/></symbol>
  <symbol id="fg-icon-log-out" viewBox="0 0 24 24"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></symbol>
  <symbol id="fg-icon-check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m8 12 2.5 2.5L16 9"/></symbol>
  <symbol id="fg-icon-alert" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></symbol>
</svg>

<div class="login-wrap" id="loginBox">
  <div class="login-card">
    <img class="brand-logo" src="/painel/community-for-goats-logo.jpg" alt="Logo Community For Goats" />
    <div class="brand login-brand">Community For Goats</div>
    <h1>Acesso ao Painel Web</h1>
    <p>Entre com as credenciais administrativas sincronizadas com o ForGoats.exe.</p>
    <form onsubmit="event.preventDefault(); entrar();">
      <label>Usuário</label>
      <input type="text" id="userInput" placeholder="forgoats" autocomplete="username" required />
      <label>Senha</label>
      <input type="password" id="passInput" placeholder="•••••" autocomplete="current-password" required />
      <label class="remember-row">
        <input type="checkbox" id="rememberInput" checked />
        <span>Lembrar login neste dispositivo</span>
      </label>
      <button type="submit" class="btn-primary" style="width:100%;"><svg class="icon" aria-hidden="true"><use href="#fg-icon-log-out"/></svg>Entrar no Painel</button>
    </form>
    <p id="loginErr" style="color:#ed4245;margin-top:12px;margin-bottom:0;"></p>
  </div>
</div>

<div class="layout" id="appBox">
  <aside class="sidebar">
    <div class="sidebar-content">
      <div class="brand sidebar-brand"><img class="brand-logo small" src="/painel/community-for-goats-logo.jpg" alt="" /><span class="brand-copy"><strong>Community For Goats</strong><small>ForGoats Sync</small></span></div>
      <nav class="sidebar-nav" aria-label="Seções do ForGoats Sync">
        <button class="nav-item active" id="nav-status" data-tab="status" onclick="mudarTab('status')"><svg class="icon" aria-hidden="true"><use href="#fg-icon-layout"/></svg>Status conectado</button>
        <button class="nav-item" id="nav-tokens" data-tab="tokens" onclick="mudarTab('tokens')"><svg class="icon" aria-hidden="true"><use href="#fg-icon-key"/></svg>Gerenciador de tokens</button>
        <button class="nav-item" id="nav-timetokens" data-tab="timetokens" onclick="mudarTab('timetokens')"><svg class="icon" aria-hidden="true"><use href="#fg-icon-clock"/></svg>Time tokens</button>
        <button class="nav-item" id="nav-accounts" data-tab="accounts" onclick="mudarTab('accounts')"><svg class="icon" aria-hidden="true"><use href="#fg-icon-users"/></svg>Contas &amp; HWID</button>
      </nav>
    </div>

    <div class="sidebar-logout" style="padding-top:16px;border-top:1px solid var(--border);">
      <button class="btn-danger" style="width:100%;" onclick="sair()"><svg class="icon" aria-hidden="true"><use href="#fg-icon-log-out"/></svg>Sair do Painel</button>
    </div>
  </aside>

  <main class="main">
    <div class="topbar">
      <div>
        <img class="mobile-top-logo" src="/painel/community-for-goats-logo.jpg" alt="" />
        <div class="mobile-page-copy">
          <div class="brand">Painel administrativo</div>
          <h1 id="pageTitle" style="margin:4px 0 0;">Status de Conectado</h1>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-primary" onclick="gerarToken('normal')"><svg class="icon" aria-hidden="true"><use href="#fg-icon-plus"/></svg>Token 30 dias</button>
        <button class="btn-ghost" onclick="gerarToken('test')"><svg class="icon" aria-hidden="true"><use href="#fg-icon-flask"/></svg>Token teste · 3 min</button>
        <button class="btn-ghost" onclick="atualizarPainel()"><svg class="icon" aria-hidden="true"><use href="#fg-icon-refresh"/></svg>Atualizar</button>
      </div>
    </div>

    <div class="tab-pane active" id="tab-status">
      <div class="grid">
        <div class="stat"><span>Bot Discord</span><strong id="stBot">—</strong></div>
        <div class="stat"><span>API ForGoats.exe</span><strong id="stApi">—</strong></div>
        <div class="stat"><span>Clientes Conectados Agora</span><strong id="stOnlineUsers">0</strong></div>
        <div class="stat"><span>Latência / Memória</span><strong id="stPerf">—</strong></div>
      </div>

      <div class="section">
        <div class="section-head"><strong>Sessões Ativas no ForGoats.exe</strong></div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Estado</th>
                <th>Token Vinculado</th>
                <th>HWID</th>
              </tr>
            </thead>
            <tbody id="onlineTable"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="tab-pane" id="tab-tokens">
      <div class="grid">
        <div class="stat"><span>Total de Tokens</span><strong id="stTotalTokens">0</strong></div>
        <div class="stat"><span>Tokens Ativos</span><strong id="stActiveTokens">0</strong></div>
        <div class="stat"><span>HWIDs Vinculados</span><strong id="stBoundTokens">0</strong></div>
      </div>

      <div class="section">
        <div class="section-head"><strong>Todos os Tokens Gerados (Discord + Web)</strong></div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Plano</th>
                <th>Tempo Restante (Real)</th>
                <th>Conta</th>
                <th>HWID</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody id="tokensTable"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="tab-pane" id="tab-timetokens">
      <div class="section">
        <div class="section-head"><strong>Criar Token com Tempo Personalizado</strong></div>
        <div class="form-row">
          <div>
            <label>Quantidade de Tempo</label>
            <input type="number" id="customAmount" min="1" value="15" placeholder="Ex: 15" />
          </div>
          <div>
            <label>Unidade</label>
            <select id="customUnit">
              <option value="minutes">Minutos</option>
              <option value="hours">Horas</option>
              <option value="days" selected>Dias</option>
            </select>
          </div>
          <div>
            <button class="btn-primary" style="width:100%;" onclick="criarTimeToken()">⏱️ Gerar Time Token</button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><strong>Alterar Tempo de Token Existente</strong></div>
        <div class="form-row">
          <div>
            <label>Selecione o Token</label>
            <select id="editTokenSelect"></select>
          </div>
          <div>
            <label>Ação</label>
            <select id="editTimeMode">
              <option value="set">Definir novo tempo (a partir de agora)</option>
              <option value="add">Adicionar / Subtrair tempo</option>
            </select>
          </div>
          <div>
            <label>Valor (use negativo para reduzir)</label>
            <input type="number" id="editTimeAmount" value="30" placeholder="Ex: 30 ou -10" />
          </div>
          <div>
            <label>Unidade</label>
            <select id="editTimeUnit">
              <option value="minutes">Minutos</option>
              <option value="hours">Horas</option>
              <option value="days" selected>Dias</option>
            </select>
          </div>
          <div>
            <button class="btn-primary" style="width:100%;" onclick="alterarTempoToken()">Salvar Novo Tempo</button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><strong>Monitor de Expiração ao Vivo</strong></div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Duração Configurada</th>
                <th>Expira em (Data/Hora)</th>
                <th>Contagem Regressiva</th>
                <th>Atalhos Rápidos</th>
              </tr>
            </thead>
            <tbody id="timeTokensTable"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="tab-pane" id="tab-accounts">
      <div class="section">
        <div class="section-head"><strong>Contas Registradas no ForGoats.exe</strong></div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Status</th>
                <th>Token</th>
                <th>Licença</th>
                <th>HWID da Máquina</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody id="accountsTable"></tbody>
          </table>
        </div>
      </div>
    </div>
  </main>
  <nav class="mobile-bottom-nav" aria-label="Navegação principal">
    <button class="nav-item active" data-tab="status" aria-current="page" onclick="mudarTab('status')"><svg class="icon" aria-hidden="true"><use href="#fg-icon-layout"/></svg><span>Início</span></button>
    <button class="nav-item" data-tab="tokens" onclick="mudarTab('tokens')"><svg class="icon" aria-hidden="true"><use href="#fg-icon-key"/></svg><span>Tokens</span></button>
    <button class="nav-item" data-tab="timetokens" onclick="mudarTab('timetokens')"><svg class="icon" aria-hidden="true"><use href="#fg-icon-clock"/></svg><span>Tempo</span></button>
    <button class="nav-item" data-tab="accounts" onclick="mudarTab('accounts')"><svg class="icon" aria-hidden="true"><use href="#fg-icon-users"/></svg><span>Contas</span></button>
  </nav>
</div>

<div class="toast" id="toast" role="status" aria-live="polite" aria-atomic="true" hidden>
  <svg class="icon toast-icon" aria-hidden="true"><use href="#fg-icon-check"/></svg>
  <span class="toast-message"></span>
  <span class="toast-progress" aria-hidden="true"></span>
</div>

<script>
const STORAGE_KEY = 'fg_web_token';
let sessionToken = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY) || '';
let cachedTokens = [];
let serverClockOffset = 0;
let toastTimer;
let toastExitTimer;
let refreshFailed = false;

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (toastTimer) clearTimeout(toastTimer);
  if (toastExitTimer) clearTimeout(toastExitTimer);
  el.querySelector('.toast-message').textContent = msg;
  el.querySelector('use').setAttribute('href', type === 'error' ? '#fg-icon-alert' : '#fg-icon-check');
  el.classList.toggle('error', type === 'error');
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  el.classList.remove('is-hiding', 'is-visible');
  el.hidden = !msg;
  void el.offsetWidth;
  if (!msg) return;
  el.classList.add('is-visible');
  toastTimer = setTimeout(() => {
    el.classList.remove('is-visible');
    el.classList.add('is-hiding');
    toastExitTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('is-hiding');
    }, 180);
  }, 4820);
}

async function atualizarAposAcao() {
  try { await carregarDados(); }
  catch (error) { toast(\`A ação foi concluída, mas o painel não atualizou: \${error.message}\`, 'error'); }
}

function mudarTab(tab) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('[data-tab]').forEach(el => {
    const active = el.dataset.tab === tab;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  document.getElementById('tab-' + tab).classList.add('active');
  const titles = {
    status: 'Status de Conectado',
    tokens: 'Gerenciador de Tokens',
    timetokens: 'Time Tokens • Controle de Duração',
    accounts: 'Contas & HWID'
  };
  document.getElementById('pageTitle').textContent = titles[tab] || 'Painel';
}

function getSyncedNow() {
  return Date.now() + serverClockOffset;
}

function formatCountdown(expiresAt) {
  const ms = Number(expiresAt) - getSyncedNow();
  if (!expiresAt || ms <= 0) return 'Expirado';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = n => String(n).padStart(2, '0');
  if (days > 0) return days + 'd ' + pad(hours) + 'h ' + pad(mins) + 'm ' + pad(secs) + 's';
  if (hours > 0) return pad(hours) + 'h ' + pad(mins) + 'm ' + pad(secs) + 's';
  return pad(mins) + 'm ' + pad(secs) + 's';
}

function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR');
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + sessionToken,
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Erro na requisição');
  return data;
}

async function entrar() {
  const username = document.getElementById('userInput').value.trim();
  const password = document.getElementById('passInput').value.trim();
  const remember = document.getElementById('rememberInput').checked;
  const errEl = document.getElementById('loginErr');
  errEl.textContent = '';

  try {
    const res = await fetch('/api/forgoats/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Falha no login');

    sessionToken = data.sessionToken;
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    if (remember) {
      localStorage.setItem(STORAGE_KEY, sessionToken);
    } else {
      sessionStorage.setItem(STORAGE_KEY, sessionToken);
    }

    await carregarDados();
    document.getElementById('loginBox').style.display = 'none';
    document.getElementById('appBox').style.display = 'flex';
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function sair() {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  location.reload();
}

function atualizarRelogiosAoVivo() {
  const now = getSyncedNow();
  document.querySelectorAll('[data-expires]').forEach(el => {
    const exp = Number(el.getAttribute('data-expires'));
    const expired = !exp || now >= exp;
    el.textContent = formatCountdown(exp);
    el.className = 'badge ' + (expired ? 'badge-exp' : 'badge-ok');
  });
}

async function carregarDados() {
  const data = await api('/api/forgoats/overview');
  if (data.serverNow) {
    serverClockOffset = Number(data.serverNow) - Date.now();
  }
  cachedTokens = data.tokens || [];

  document.getElementById('stBot').innerHTML = data.status.botOnline
    ? '<span style="color:#22c55e;">● Conectado</span>'
    : '<span style="color:#ed4245;">● Offline</span>';
  document.getElementById('stApi').innerHTML = data.status.apiRunning
    ? '<span style="color:#22c55e;">● Porta ' + data.status.apiPort + '</span>'
    : '<span style="color:#ed4245;">● Parada</span>';
  document.getElementById('stOnlineUsers').textContent = data.stats.onlineUsers + ' / ' + data.stats.totalUsers;
  document.getElementById('stPerf').textContent = data.status.pingMs + ' ms · ' + data.status.memMb + ' MB';

  document.getElementById('stTotalTokens').textContent = data.stats.totalTokens;
  document.getElementById('stActiveTokens').textContent = data.stats.activeTokens;
  document.getElementById('stBoundTokens').textContent = data.stats.boundTokens;

  document.getElementById('onlineTable').innerHTML = data.users.length
    ? data.users.map(u => \`
      <tr>
        <td><strong>\${u.username}</strong></td>
        <td><span class="badge \${u.online ? 'badge-ok' : 'badge-off'}">\${u.online ? '● Conectado' : 'Offline'}</span></td>
        <td><code>\${u.token || '—'}</code></td>
        <td><code>\${u.hwid ? u.hwid.slice(0, 14) + '...' : 'Livre'}</code></td>
      </tr>
    \`).join('')
    : '<tr><td colspan="4" style="color:#8e8e98;">Nenhuma conta sincronizada ainda.</td></tr>';

  document.getElementById('tokensTable').innerHTML = cachedTokens.length
    ? cachedTokens.map(t => \`
      <tr>
        <td><code>\${t.token}</code></td>
        <td>\${t.customLabel || (t.type === 'test' ? '3min' : '30d')}</td>
        <td><span class="badge \${t.expired ? 'badge-exp' : 'badge-ok'}" data-expires="\${t.expiresAt}">\${formatCountdown(t.expiresAt)}</span></td>
        <td>\${t.boundUsername || '—'}</td>
        <td><code>\${t.hwid ? t.hwid.slice(0, 12) + '...' : 'Livre'}</code></td>
        <td style="display:flex;gap:6px;">
          <button class="btn-ghost" onclick="resetHwid('\${t.token}')">Reset HWID</button>
          <button class="btn-danger" onclick="revogarToken('\${t.token}')">Revogar</button>
        </td>
      </tr>
    \`).join('')
    : '<tr><td colspan="6" style="color:#8e8e98;">Nenhum token gerado.</td></tr>';

  const selectEl = document.getElementById('editTokenSelect');
  const prevVal = selectEl.value;
  selectEl.innerHTML = cachedTokens.length
    ? cachedTokens.map(t => \`<option value="\${t.token}">\${t.token} (\${t.boundUsername || 'Livre'})</option>\`).join('')
    : '<option value="">Nenhum token disponível</option>';
  if (prevVal && cachedTokens.some(t => t.token === prevVal)) {
    selectEl.value = prevVal;
  }

  document.getElementById('timeTokensTable').innerHTML = cachedTokens.length
    ? cachedTokens.map(t => \`
      <tr>
        <td><code>\${t.token}</code></td>
        <td>\${t.customLabel || (t.type === 'test' ? '3min' : '30d')}</td>
        <td>\${formatDateTime(t.expiresAt)}</td>
        <td><span class="badge \${t.expired ? 'badge-exp' : 'badge-ok'}" data-expires="\${t.expiresAt}">\${formatCountdown(t.expiresAt)}</span></td>
        <td style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn-ghost" onclick="ajusteRapido('\${t.token}', 'add', 10, 'minutes')">+10m</button>
          <button class="btn-ghost" onclick="ajusteRapido('\${t.token}', 'add', 1, 'days')">+1d</button>
          <button class="btn-ghost" onclick="ajusteRapido('\${t.token}', 'set', 30, 'days')">30d</button>
        </td>
      </tr>
    \`).join('')
    : '<tr><td colspan="5" style="color:#8e8e98;">Nenhum token encontrado.</td></tr>';

  document.getElementById('accountsTable').innerHTML = data.users.length
    ? data.users.map(u => \`
      <tr>
        <td><strong>\${u.username}</strong></td>
        <td><span class="badge \${u.online ? 'badge-ok' : 'badge-off'}">\${u.online ? '● Online' : 'Offline'}</span></td>
        <td><code>\${u.token || '—'}</code></td>
        <td><span class="badge \${u.tokenValid ? 'badge-ok' : 'badge-exp'}">\${u.tokenValid ? 'Ativa' : 'Expirada'}</span></td>
        <td><code>\${u.hwid ? u.hwid.slice(0, 14) + '...' : 'Livre'}</code></td>
        <td><button class="btn-danger" onclick="removerConta('\${u.username}')">Remover Conta</button></td>
      </tr>
    \`).join('')
    : '<tr><td colspan="6" style="color:#8e8e98;">Nenhuma conta registrada.</td></tr>';

  atualizarRelogiosAoVivo();
}

async function gerarToken(type) {
  try {
    const res = await api('/api/forgoats/tokens/create', {
      method: 'POST',
      body: JSON.stringify({ type })
    });
    const copied = await navigator.clipboard?.writeText(res.token).then(() => true).catch(() => false);
    toast(\`Token criado\${copied ? ' e copiado' : ''}: \${res.token}\`);
    await atualizarAposAcao();
  } catch (error) { toast(error.message, 'error'); }
}

async function criarTimeToken() {
  const amount = Number(document.getElementById('customAmount').value);
  const unit = document.getElementById('customUnit').value;
  try {
    const res = await api('/api/forgoats/tokens/create', {
      method: 'POST',
      body: JSON.stringify({ type: 'custom', amount, unit })
    });
    const copied = await navigator.clipboard?.writeText(res.token).then(() => true).catch(() => false);
    toast(\`Time Token criado\${copied ? ' e copiado' : ''}: \${res.token}\`);
    await atualizarAposAcao();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function alterarTempoToken() {
  const token = document.getElementById('editTokenSelect').value;
  const mode = document.getElementById('editTimeMode').value;
  const amount = Number(document.getElementById('editTimeAmount').value);
  const unit = document.getElementById('editTimeUnit').value;
  if (!token) return toast('Selecione um token.', 'error');
  try {
    const res = await api('/api/forgoats/tokens/update-time', {
      method: 'POST',
      body: JSON.stringify({ token, mode, amount, unit })
    });
    toast(res.message);
    await atualizarAposAcao();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function ajusteRapido(token, mode, amount, unit) {
  try {
    const res = await api('/api/forgoats/tokens/update-time', {
      method: 'POST',
      body: JSON.stringify({ token, mode, amount, unit })
    });
    toast(res.message);
    await atualizarAposAcao();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function resetHwid(token) {
  try {
    await api('/api/forgoats/tokens/reset-hwid', {
      method: 'POST',
      body: JSON.stringify({ token })
    });
    toast('HWID resetado: ' + token);
    await atualizarAposAcao();
  } catch (error) { toast(error.message, 'error'); }
}

async function revogarToken(token) {
  try {
    await api('/api/forgoats/tokens/' + encodeURIComponent(token), { method: 'DELETE' });
    toast('Token revogado: ' + token);
    await atualizarAposAcao();
  } catch (error) { toast(error.message, 'error'); }
}

async function removerConta(username) {
  try {
    await api('/api/forgoats/users/' + encodeURIComponent(username), { method: 'DELETE' });
    toast('Conta removida: ' + username);
    await atualizarAposAcao();
  } catch (error) { toast(error.message, 'error'); }
}

async function atualizarPainel() {
  try { await carregarDados(); toast('Painel atualizado.'); }
  catch (error) { toast(error.message, 'error'); }
}

async function entrarComTicket(ticket) {
  try {
    history.replaceState(null, '', location.pathname + location.search);
    const res = await fetch('/api/forgoats/login-ticket', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Falha ao entrar.');
    sessionToken = data.sessionToken;
    sessionStorage.setItem(STORAGE_KEY, sessionToken);
    await carregarDados();
    document.getElementById('loginBox').style.display = 'none';
    document.getElementById('appBox').style.display = 'flex';
  } catch (error) {
    document.getElementById('loginErr').textContent = error.message;
    toast(error.message, 'error');
  }
}

const accessTicket = new URLSearchParams(location.hash.slice(1)).get('access');
if (accessTicket) {
  void entrarComTicket(accessTicket);
} else if (sessionToken) {
  carregarDados().then(() => {
    document.getElementById('loginBox').style.display = 'none';
    document.getElementById('appBox').style.display = 'flex';
  }).catch((error) => {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    toast(error.message, 'error');
  });
}

setInterval(atualizarRelogiosAoVivo, 1000);

setInterval(() => {
  if (document.getElementById('appBox').style.display === 'flex') {
    carregarDados().then(() => { refreshFailed = false; }).catch((error) => {
      if (!refreshFailed) toast(error.message, 'error');
      refreshFailed = true;
    });
  }
}, 8000);
</script>
</body>
</html>`;
}