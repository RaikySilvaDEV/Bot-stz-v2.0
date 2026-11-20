import { issueDashboardLoginTicket } from '../api/dashboardAuth.js';
import fs from 'node:fs';
import path from 'node:path';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    StringSelectMenuBuilder
} from 'discord.js';
import { client } from '../client.js';
import { loadTokens } from '../commands/tokensStore.js';
import { getApiStatus } from '../api/server.js';
import { getPublicBaseUrl } from '../api/publicTunnel.js';

export const FORGOATS_PANEL_CHANNEL_ID = '1567697086944649336';
const usersFile = path.resolve('data', 'app_users.json');

function loadUsersSafe() {
    if (!fs.existsSync(usersFile)) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function formatUptime(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
}

function formatRemaining(ms) {
    if (ms <= 0) return 'Expirado';
    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

export function criarPainelForGoats(view = 'overview') {
    const now = Date.now();
    const tokensObj = loadTokens();
    const entries = Object.entries(tokensObj);
    const activeTokens = entries.filter(([, info]) => info?.expiresAt && now <= info.expiresAt);
    const boundTokens = entries.filter(([, info]) => Boolean(info?.hwid));
    const users = loadUsersSafe();

    const pingMs = Math.max(0, Math.round(client.ws?.ping ?? 0));
    const uptimeStr = formatUptime((client.uptime ?? process.uptime() * 1000));
    const memMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    const apiStatus = getApiStatus();
    const apiPort = apiStatus?.port ?? 3001;
    const apiRunning = Boolean(apiStatus?.running);

    const webUrl = (process.env.FORGOATS_WEB_URL || `http://192.168.1.168:${apiPort}/forgoats`).trim();

    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('📊 Painel do bot · Community For Goats · 🏆')
        .setDescription('Resumo dos serviços, estado de conexão e recursos que precisam de atenção.');

    if (view === 'tokens') {
        const recentes = entries.slice(-8).reverse();
        const resumoTokens = recentes.length
            ? recentes.map(([code, info]) => {
                const statusTxt = !info?.expiresAt || now > info.expiresAt
                    ? '🔴 Expirado'
                    : `🟢 Ativo (${formatRemaining(info.expiresAt - now)})`;
                const hwidTxt = info?.hwid ? `\`${String(info.hwid).slice(0, 10)}...\`` : '`Livre`';
                const userTxt = info?.boundUsername ? ` · **${info.boundUsername}**` : '';
                return `• \`${code}\` · ${statusTxt} · HWID: ${hwidTxt}${userTxt}`;
            }).join('\n')
            : 'Nenhum token registrado ainda.';

        embed.addFields(
            { name: 'Tokens ativos', value: `🟢 **${activeTokens.length}** de ${entries.length}`, inline: true },
            { name: 'HWIDs vinculados', value: `🟢 **${boundTokens.length}** em uso`, inline: true },
            { name: 'Contas ForGoats.exe', value: `🟢 **${users.length}** registradas`, inline: true },
            { name: 'Tokens gerados', value: resumoTokens, inline: false }
        );
    } else if (view === 'accounts') {
        const listaContas = users.length
            ? users.slice(-8).reverse().map(u => {
                const online = u.lastSeen && (now - u.lastSeen < 35000) ? '🟢 Online' : '⚪ Offline';
                return `• ${online} **${u.username}** · Token: \`${u.token || '—'}\` · HWID: \`${u.hwid ? String(u.hwid).slice(0, 10) + '...' : 'Livre'}\``;
            }).join('\n')
            : 'Nenhuma conta sincronizada até o momento.';

        embed.addFields(
            { name: 'Contas sincronizadas', value: `🟢 **${users.length}** ativas`, inline: true },
            { name: 'Tokens vinculados', value: `🟢 **${boundTokens.length}** HWIDs`, inline: true },
            { name: 'API de autenticação', value: `${apiRunning ? '🟢' : '🔴'} Porta ${apiPort}`, inline: true },
            { name: 'Contas recentes', value: listaContas, inline: false }
        );
    } else {
        embed.addFields(
            { name: 'Discord', value: `🟢 Conectado`, inline: true },
            { name: 'Latência', value: `${pingMs} ms`, inline: true },
            { name: 'Tempo ligado', value: uptimeStr, inline: true },
            { name: 'API ForGoats', value: `${apiRunning ? '🟢 Operante' : '🔴 Parada'} · porta ${apiPort}`, inline: true },
            { name: 'Tokens ativos', value: `🟢 **${activeTokens.length}** ativos · ${boundTokens.length} HWID`, inline: true },
            { name: 'Memória do processo', value: `${memMb} MB`, inline: true },
            { name: 'Contas registradas', value: `🟢 **${users.length}** · sincronizadas`, inline: true },
            { name: 'Sincronização Web/App', value: `${apiRunning ? '🟢 Ativa' : '🔴 Offline'} · /api/auth`, inline: true }
        );
    }

    embed.setFooter({ text: `Atualizado · use o botão para consultar novamente · online há ${uptimeStr}` });
    embed.setTimestamp(new Date());

    const buttonsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`forgoats_painel_refresh:${view}`)
            .setLabel('Atualizar painel')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('forgoats_painel_tokens_quick')
            .setLabel('Gerenciar tokens')
            .setEmoji('🎟️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setLabel('Ver na web')
            .setEmoji('🌐')
            .setStyle(ButtonStyle.Secondary)
            .setCustomId('forgoats_painel_web')
    );

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('forgoats_painel_view')
            .setPlaceholder(
                view === 'tokens' ? 'Tokens' : view === 'accounts' ? 'Contas & HWID' : 'Visão geral'
            )
            .addOptions([
                { label: 'Visão geral', description: 'Status do bot, API, memória e sincronização', value: 'overview', default: view === 'overview' },
                { label: 'Tokens', description: 'Tokens ativos, expiração e HWIDs vinculados', value: 'tokens', default: view === 'tokens' },
                { label: 'Contas & HWID', description: 'Contas registradas no ForGoats.exe', value: 'accounts', default: view === 'accounts' }
            ])
    );

    return {
        embeds: [embed],
        components: [buttonsRow, selectRow]
    };
}

export async function publicarPainelForGoats(channel) {
    if (!channel || channel.id !== FORGOATS_PANEL_CHANNEL_ID) return false;
    try {
        const messages = await channel.messages.fetch({ limit: 50 });
        const existing = messages.find(message => message.author.id === client.user.id &&
            message.components.some(row => row.components.some(item => item.customId === 'forgoats_painel_view')));
        if (existing) await existing.edit(criarPainelForGoats('overview'));
        else await channel.send(criarPainelForGoats('overview'));
        return true;
    } catch (err) {
        console.error('[forgoats-panel] Erro ao publicar painel:', err);
        return false;
    }
}

export async function tratarInteracaoPainelForGoats(interaction) {
    if (interaction.channelId !== FORGOATS_PANEL_CHANNEL_ID) return false;

    if (interaction.isButton() && interaction.customId === 'forgoats_painel_web') {
        const ticket = issueDashboardLoginTicket(interaction.user.id, interaction.guild.id);
        if (!ticket) {
            await interaction.reply({ content: 'Configure DASHBOARD_PASSWORD ou API_KEY para habilitar o acesso web.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const url = new URL('/forgoats', getPublicBaseUrl(getApiStatus().port));
        url.hash = 'access=' + ticket;
        await interaction.reply({
            content: 'Link pessoal para o For Goats Sync, válido por 10 minutos.',
            flags: MessageFlags.Ephemeral,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Abrir For Goats Sync').setStyle(ButtonStyle.Link).setURL(url.href))]
        });
        return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith('forgoats_painel_refresh:')) {
        const view = interaction.customId.split(':')[1] || 'overview';
        await interaction.update(criarPainelForGoats(view));
        return true;
    }

    if (interaction.isButton() && interaction.customId === 'forgoats_painel_tokens_quick') {
        const now = Date.now();
        const tokensObj = loadTokens();
        const entries = Object.entries(tokensObj).reverse();

        if (!entries.length) {
            await interaction.reply({
                content: '🎟️ Nenhum token gerado ainda. Use `/gerartoken` ou `/testetoken`.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        const linhas = entries.map(([code, info]) => {
            const ativo = info?.expiresAt && now <= info.expiresAt;
            const status = ativo ? `🟢 Ativo (${formatRemaining(info.expiresAt - now)})` : '🔴 Expirado';
            const plano = info?.type === 'test' ? '3m' : '30d';
            const dono = info?.boundUsername ? `Conta: **${info.boundUsername}**` : 'Sem conta';
            const hwid = info?.hwid ? `HWID: \`${String(info.hwid).slice(0, 12)}...\`` : 'HWID: `Livre`';
            return `• \`${code}\` [${plano}] · ${status} · ${dono} · ${hwid}`;
        });

        // Garante limite de 4000 caracteres do embed
        let descricao = '';
        for (const linha of linhas) {
            if ((descricao + linha + '\n').length > 3800) {
                descricao += `\n*...e mais ${linhas.length - descricao.split('\n').filter(Boolean).length} token(s) no painel web.*`;
                break;
            }
            descricao += linha + '\n';
        }

        const embedLista = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle(`🎟️ Todos os Tokens Gerados (${entries.length})`)
            .setDescription(descricao)
            .setFooter({ text: 'Comandos: /gerartoken · /testetoken · /resettoken <token>' });

        await interaction.reply({
            embeds: [embedLista],
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'forgoats_painel_view') {
        const selectedView = interaction.values[0] || 'overview';
        await interaction.update(criarPainelForGoats(selectedView));
        return true;
    }

    return false;
}