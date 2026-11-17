import fs from 'node:fs';
import path from 'node:path';
import { networkInterfaces } from 'node:os';

function obterIpLocal() {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            // Procura por um IPv4 ativo que não seja interno (localhost)
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return '127.0.0.1';
}

function atualizarEnv() {
    const ipAtual = obterIpLocal();
    const envPath = path.join(process.cwd(), '.env');
    const porta = '3001';

    if (!fs.existsSync(envPath)) {
        console.log('[ip.js] Ficheiro .env não encontrado.');
        return;
    }

    let envContent = fs.readFileSync(envPath, 'utf8');

    const publicUrlLine = envContent.match(/^DASHBOARD_PUBLIC_URL=(.*)$/m)?.[1]?.trim();
    if (publicUrlLine?.startsWith('https://')) {
        console.log(`[ip.js] URL pública HTTPS preservada: ${publicUrlLine}`);
        return;
    }

    const novaUrl = `DASHBOARD_PUBLIC_URL=http://${ipAtual}:${porta}/painel`;

    // Verifica se a linha DASHBOARD_PUBLIC_URL já existe no .env
    if (envContent.includes('DASHBOARD_PUBLIC_URL=')) {
        // Substitui a linha antiga pela nova com o IP atualizado
        envContent = envContent.replace(/^DASHBOARD_PUBLIC_URL=.*/m, novaUrl);
    } else {
        // Se não existir, adiciona no final
        envContent += `\n${novaUrl}\n`;
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log(`[ip.js] IP atualizado com sucesso no .env: http://${ipAtual}:${porta}/painel`);
}

atualizarEnv();