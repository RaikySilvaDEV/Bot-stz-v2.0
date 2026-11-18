import 'dotenv/config';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveMercadoPagoSettings } from '../services/mercadoPagoSettings.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TUNNEL_URL_PATTERN = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
const STARTUP_TUNNEL_WAIT_MS = 12_000;
const UPDATE_CHECK_INTERVAL_MS = Math.max(30_000, Number(process.env.GIT_UPDATE_CHECK_MS) || 60_000);

let bot = null;
let tunnel = null;
let botRestartTimer = null;
let tunnelRestartTimer = null;
let updateCheckTimer = null;
let botRestartCount = 0;
let tunnelRestartCount = 0;
let stopping = false;
let restartingBotForUpdate = false;
let restartingBotForTunnel = false;
let tunnelUrlReady;
const firstTunnelUrl = new Promise(resolve => { tunnelUrlReady = resolve; });
let hasTunnelUrl = false;

function runGit(args) {
    return execFileSync('git', args, {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

async function checkForUpdates() {
    if (stopping || !bot) return;

    try {
        runGit(['fetch', '--prune', 'origin']);
        const branch = runGit(['branch', '--show-current']);
        if (!branch) return;

        const upstream = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
        const behind = Number(runGit(['rev-list', '--count', `HEAD..${upstream}`])) || 0;
        if (behind <= 0) return;

        const previousHead = runGit(['rev-parse', 'HEAD']);
        console.log(`[supervisor] Atualização encontrada (${behind} commit${behind === 1 ? '' : 's'}). Aplicando pull…`);
        runGit(['pull', '--ff-only', 'origin', branch]);

        const dependencyFilesChanged = runGit([
            'diff', '--name-only', previousHead, 'HEAD', '--', 'package.json', 'package-lock.json'
        ]);

        if (dependencyFilesChanged) {
            console.log('[supervisor] Dependências alteradas. Executando npm install…');
            const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
            execFileSync(npmCommand, ['install'], {
                cwd: PROJECT_ROOT,
                stdio: 'inherit',
                windowsHide: true
            });
        }

        const newHead = runGit(['rev-parse', '--short', 'HEAD']);
        console.log(`[supervisor] Atualização aplicada (${newHead}). Reiniciando o bot…`);
        restartingBotForUpdate = true;
        bot.kill('SIGTERM');
    } catch (error) {
        console.error('[supervisor] Falha ao verificar/aplicar atualização:', error.message);
    }
}

function startUpdateMonitor() {
    if (updateCheckTimer || stopping) return;
    console.log(`[supervisor] Atualizações automáticas ativadas (verificação a cada ${UPDATE_CHECK_INTERVAL_MS / 1000}s).`);
    updateCheckTimer = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
    updateCheckTimer.unref?.();
}

function retryDelay(count) {
    return Math.min(1000 * (2 ** Math.max(0, count - 1)), 30_000);
}

function startBot() {
    if (stopping || bot) return;

    console.log('[supervisor] Iniciando o bot…');
    bot = spawn(process.execPath, ['--watch', '--watch-path=src', 'index.js'], {
        cwd: PROJECT_ROOT,
        env: process.env,
        stdio: 'inherit',
        windowsHide: true
    });

    bot.on('error', error => {
        console.error('[supervisor] Não foi possível iniciar o bot:', error.message);
    });

    bot.on('close', (code, signal) => {
        bot = null;
        if (stopping) return;

        if (restartingBotForUpdate) {
            restartingBotForUpdate = false;
            startBot();
            return;
        }

        if (restartingBotForTunnel) {
            restartingBotForTunnel = false;
            startBot();
            return;
        }

        botRestartCount += 1;
        const delay = retryDelay(botRestartCount);
        console.error(`[supervisor] Bot encerrou (código ${code ?? 'indisponível'}${signal ? `, sinal ${signal}` : ''}). Nova tentativa em ${Math.ceil(delay / 1000)}s.`);
        botRestartTimer = setTimeout(startBot, delay);
    });
}

function restartBotWithNewTunnelUrl() {
    if (!bot || stopping) return;
    restartingBotForTunnel = true;
    console.log('[supervisor] Reiniciando o bot para aplicar o novo endereço público…');
    bot.kill('SIGTERM');
}

function processTunnelOutput(chunk) {
    const output = chunk.toString();
    for (const line of output.split(/\r?\n/).filter(Boolean)) {
        console.log(`[cloudflared] ${line}`);
        const publicUrl = line.match(TUNNEL_URL_PATTERN)?.[0];
        if (!publicUrl) continue;

        const dashboardUrl = `${publicUrl}/painel`;
        const webhookUrl = `${publicUrl}/api/webhooks/mercado-pago`;
        const webhookChanged = process.env.MERCADO_PAGO_WEBHOOK_URL !== webhookUrl;
        const changed = process.env.DASHBOARD_PUBLIC_URL !== dashboardUrl || webhookChanged;
        process.env.DASHBOARD_PUBLIC_URL = dashboardUrl;
        if (webhookChanged) {
            process.env.MERCADO_PAGO_WEBHOOK_URL = webhookUrl;
            try {
                saveMercadoPagoSettings({ webhookUrl });
                console.log('[cloudflared] URL do webhook do Mercado Pago atualizada.');
            } catch (error) {
                console.error('[cloudflared] Não foi possível persistir a nova URL do webhook:', error.message);
            }
        }
        if (!hasTunnelUrl) {
            hasTunnelUrl = true;
            tunnelUrlReady();
            console.log(`[cloudflared] Painel externo: ${dashboardUrl}`);
        } else if (changed) {
            console.log(`[cloudflared] Novo endereço público: ${dashboardUrl}`);
            restartBotWithNewTunnelUrl();
        }
    }
}

function startTunnel() {
    if (stopping || tunnel) return;

    console.log('[supervisor] Iniciando o túnel Cloudflare para http://127.0.0.1:3001…');
    tunnel = spawn('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:3001'], {
        cwd: PROJECT_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });

    tunnel.stdout.on('data', processTunnelOutput);
    tunnel.stderr.on('data', processTunnelOutput);
    tunnel.on('error', error => {
        console.error(`[cloudflared] Não foi possível iniciar o túnel: ${error.message}`);
        console.error('[cloudflared] Confira se o cloudflared está instalado e disponível no PATH.');
    });

    tunnel.on('close', (code, signal) => {
        tunnel = null;
        if (stopping) return;

        tunnelRestartCount += 1;
        const delay = retryDelay(tunnelRestartCount);
        console.error(`[cloudflared] Túnel encerrou (código ${code ?? 'indisponível'}${signal ? `, sinal ${signal}` : ''}). Nova tentativa em ${Math.ceil(delay / 1000)}s.`);
        tunnelRestartTimer = setTimeout(startTunnel, delay);
    });
}

function stop(signal) {
    if (stopping) return;
    stopping = true;
    if (botRestartTimer) clearTimeout(botRestartTimer);
    if (tunnelRestartTimer) clearTimeout(tunnelRestartTimer);
    if (updateCheckTimer) clearInterval(updateCheckTimer);

    console.log('\n[supervisor] Encerrando bot e túnel…');
    for (const child of [bot, tunnel]) {
        if (child && !child.killed) {
            const childSignal = process.platform === 'win32' ? 'SIGTERM' : signal;
            child.kill(childSignal);
        }
    }
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

async function main() {
    startTunnel();
    await Promise.race([
        firstTunnelUrl,
        new Promise(resolve => setTimeout(resolve, STARTUP_TUNNEL_WAIT_MS))
    ]);

    if (!hasTunnelUrl) {
        console.warn('[cloudflared] Ainda não detectei o endereço público. O bot será iniciado; confira as mensagens do túnel acima.');
    }

    startBot();
    startUpdateMonitor();
}

main().catch(error => {
    console.error('[supervisor] Falha ao iniciar os serviços:', error);
    stop('SIGTERM');
    process.exitCode = 1;
});
