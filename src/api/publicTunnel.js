import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const urlFile = path.resolve('data', 'public_url.json');
let currentPublicUrl = process.env.FORGOATS_PUBLIC_URL?.trim() || '';

export function getPublicBaseUrl(fallbackPort = 3001) {
    if (currentPublicUrl) return currentPublicUrl.replace(/\/+$/, '');
    if (fs.existsSync(urlFile)) {
        try {
            const saved = JSON.parse(fs.readFileSync(urlFile, 'utf8'));
            if (saved?.url) return String(saved.url).replace(/\/+$/, '');
        } catch {}
    }
    return `http://192.168.1.168:${fallbackPort}`;
}

function savePublicUrl(url) {
    currentPublicUrl = url.replace(/\/+$/, '');
    fs.mkdirSync(path.dirname(urlFile), { recursive: true });
    fs.writeFileSync(urlFile, JSON.stringify({ url: currentPublicUrl, updatedAt: Date.now() }, null, 2));
}

export async function iniciarTunelPublico(port = 3001) {
    if (process.env.FORGOATS_PUBLIC_URL?.trim()) {
        savePublicUrl(process.env.FORGOATS_PUBLIC_URL.trim());
        console.log(`[tunnel] Usando URL pública fixa: ${currentPublicUrl}/forgoats`);
        return currentPublicUrl;
    }

    // 1. Tenta usar cloudflared.exe se estiver na pasta do bot ou no PATH
    const localCf = path.resolve('cloudflared.exe');
    const cfCmd = fs.existsSync(localCf) ? localCf : 'cloudflared';

    const cfWorked = await new Promise(resolve => {
        try {
            const proc = spawn(cfCmd, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });

            let resolved = false;
            const onData = chunk => {
                const text = chunk.toString();
                const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
                if (match && !resolved) {
                    resolved = true;
                    savePublicUrl(match[0]);
                    console.log(`[tunnel] Cloudflare ativo para todas as redes: ${currentPublicUrl}/forgoats`);
                    resolve(true);
                }
            };

            proc.stdout.on('data', onData);
            proc.stderr.on('data', onData);
            proc.on('error', () => { if (!resolved) resolve(false); });
            setTimeout(() => { if (!resolved) resolve(false); }, 8000);
        } catch {
            resolve(false);
        }
    });

    if (cfWorked) return currentPublicUrl;

    // 2. Fallback automático: localtunnel (funciona em qualquer rede/dispositivo)
    try {
        const { default: localtunnel } = await import('localtunnel');
        const subdomain = (process.env.FORGOATS_SUBDOMAIN || 'community-forgoats').toLowerCase().replace(/[^a-z0-9-]/g, '');
        const tunnel = await localtunnel({ port, subdomain });
        savePublicUrl(tunnel.url);
        console.log(`[tunnel] Acesso externo ativo para todas as redes: ${currentPublicUrl}/forgoats`);

        tunnel.on('close', () => {
            console.warn('[tunnel] Túnel fechado; reconectando em 5s...');
            setTimeout(() => void iniciarTunelPublico(port), 5000);
        });
        return currentPublicUrl;
    } catch (err) {
        console.warn('[tunnel] Não foi possível abrir túnel externo automático:', err.message);
        return getPublicBaseUrl(port);
    }
}