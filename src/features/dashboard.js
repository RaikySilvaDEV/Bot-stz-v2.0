import fs from 'node:fs';
import { isIP } from 'node:net';
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
    MessageFlags, PermissionsBitField, StringSelectMenuBuilder
} from 'discord.js';
import { client } from '../client.js';
import { BOT_ADMIN_ROLE_IDS, BOT_DEVELOPER_IDS, GUILD_ID, PATHS } from '../config/constants.js';
import { getSettings, updateSettings } from '../repositories/settingsRepository.js';
import { getDashboardReference, saveDashboardReference } from '../repositories/dashboardRepository.js';
import { getPaymentConfig } from '../repositories/paymentMethodsRepository.js';
import { getApiStatus } from '../api/server.js';
import { getStockState, getWallpaperState } from '../repositories/stateRepository.js';
import { logAction } from '../services/audit.js';
import { issueDashboardLoginTicket } from '../api/dashboardAuth.js';
import { isServerManager } from '../services/authorization.js';
import { COMMERCE_AUTOMATION_LABELS, getCommerceConfig, getCommerceProducts, setCommerceAutomation } from '../repositories/commerceRepository.js';
import { mercadoPagoConfigReady } from '../services/mercadoPago.js';

const PAGES = [
    ['geral', 'Visão geral'], ['automacoes', 'Automações'],
    ['canais', 'Canais e recursos'], ['pagamentos', 'Pagamentos']
];
const AUTOMATION_LABELS = {
    announcements: 'Avisos agendados', wallpapers: 'Wallpapers diários',
    stock: 'Armazéns', aiResponses: 'Atendimento por IA'
};
const ALL_AUTOMATION_LABELS = {
    ...AUTOMATION_LABELS,
    ...Object.fromEntries(Object.entries(COMMERCE_AUTOMATION_LABELS).map(([key, label]) => [`store_${key}`, `Loja · ${label}`]))
};
const CHANNEL_LABELS = {
    partnerships: 'Parcerias', fivemAnnouncements: 'Anúncios FiveM', supportCategory: 'Categoria de tickets',
    ticketPanel: 'Painel de tickets', verification: 'Verificação', welcome: 'Boas-vindas', wallpapers: 'Wallpapers',
    suggestions: 'Sugestões', feedback: 'Avaliações de clientes', purchaseStatus: 'Status de compras', supportNotices: 'Avisos de suporte',
    roleNews: 'Novidades de cargos', precisionInfo: 'Informações PrecisionFix', stockCtz: 'Armazém CTZ',
    stockBoosters: 'Armazém Boosters', audit: 'Auditoria'
};

function uptimeText() {
    const seconds = Math.floor(process.uptime());
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}min`;
}

function stateLabel(active, ready = true) {
    if (!active) return '⚪ Inativo';
    return ready ? '🟢 Ativo · pronto' : '🟠 Ativo · requer atenção';
}

function getAutomationHealth(status) {
    const announcementsReady = ['purchaseStatus', 'supportNotices', 'suggestions', 'roleNews', 'precisionInfo'].every(status.channelReady);
    const wallpaperReady = status.channelReady('wallpapers') && status.currentWallpaperExists;
    const stockReady = status.channelReady('stockCtz') && status.channelReady('stockBoosters') && status.stockCtzCount > 0 && status.stockBoostersCount > 0;
    const health = {
        announcements: { ready: announcementsReady, detail: announcementsReady ? 'Canais de destino encontrados.' : 'Um ou mais canais de destino não foram encontrados.' },
        wallpapers: { ready: wallpaperReady, detail: wallpaperReady ? `Canal pronto e arquivo do dia ${status.wallpaperState.diaAtual} encontrado.` : `Canal ou arquivo do dia ${status.wallpaperState.diaAtual} ausente.` },
        stock: { ready: stockReady, detail: stockReady ? `Arquivos dos itens CTZ #${status.stockState.ctz.indexAtual} e Boosters #${status.stockState.boosters.indexAtual} encontrados.` : 'Canal ou arquivos do próximo item ausentes.' },
        aiResponses: { ready: status.channelReady('supportCategory'), detail: status.channelReady('supportCategory') ? 'Categoria configurada. Use /iateste para verificar o Ollama.' : 'Categoria de suporte ausente.' }
    };
    const commerce = status.commerceConfig;
    const products = getCommerceProducts({ includeInactive: false });
    const allRolesReady = products.length > 0 && products.every(product => Boolean(commerce.roles[product.value]));
    const hasDelivery = products.some(product => Boolean(commerce.deliveryMessages[product.value] || commerce.deliveryLinks[product.value]));
    for (const [key] of Object.entries(COMMERCE_AUTOMATION_LABELS)) {
        const storeKey = `store_${key}`;
        const ready = key === 'mercadoPago' ? mercadoPagoConfigReady()
            : key === 'automaticDelivery' || key === 'roleExpiration' ? allRolesReady
            : key === 'coupons' ? commerce.coupons.length > 0
            : key === 'digitalDelivery' ? hasDelivery
            : key === 'salesReports' ? status.channelReady('audit') : true;
        health[storeKey] = { ready, detail: ready ? 'Configuração pronta.' : key === 'mercadoPago' ? 'Configure as credenciais e o webhook HTTPS.' : key === 'automaticDelivery' || key === 'roleExpiration' ? 'Vincule os cargos dos produtos com /loja cargo.' : key === 'coupons' ? 'Cadastre pelo menos um cupom.' : key === 'digitalDelivery' ? 'Configure instruções ou link de entrega.' : 'Canal de auditoria ausente.' };
    }
    return health;
}

function countAssets(folder, index) {
    try {
        return fs.readdirSync(folder).filter(file => new RegExp(`^${index}\\.`, 'i').test(file) && fs.statSync(`${folder}/${file}`).isFile()).length;
    } catch { return 0; }
}

function collectStatus(guild, channels) {
    const settings = getSettings();
    const channelStatus = Object.entries(settings.channels).map(([key, id]) => {
        const channel = id ? channels.get(id) : null;
        const validType = key === 'supportCategory'
            ? channel?.type === ChannelType.GuildCategory
            : key === 'audit' ? Boolean(channel?.isTextBased()) : Boolean(channel?.isTextBased());
        return { key, id, channel, ready: Boolean(channel && validType) };
    });
    const category = channels.get(settings.channels.supportCategory);
    const botMember = guild.members.me;
    const ticketPermissionReady = Boolean(category && botMember && category.permissionsFor(botMember)?.has(PermissionsBitField.Flags.ManageChannels));
    const wallpaperState = getWallpaperState();
    const stockState = getStockState();
    const currentWallpaperExists = fs.existsSync(`${PATHS.wallpapers}/${wallpaperState.diaAtual}.png`);
    const stockCtzCount = countAssets(PATHS.ctz, stockState.ctz.indexAtual);
    const stockBoostersCount = countAssets(PATHS.boosters, stockState.boosters.indexAtual);
    const paymentConfig = getPaymentConfig();
    const commerceConfig = getCommerceConfig();
    const api = getApiStatus();
    const isReady = client.isReady();
    const channelReady = key => channelStatus.find(item => item.key === key)?.ready ?? false;
    return {
        settings, channels, channelStatus, ticketPermissionReady, wallpaperState, currentWallpaperExists,
        stockState, stockCtzCount, stockBoostersCount, paymentConfig, commerceConfig, api, isReady, channelReady
    };
}

export async function getDashboardDetails() {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) throw new Error(`Servidor configurado não encontrado: ${GUILD_ID}`);
    const status = collectStatus(guild, guild.channels.cache);
    const automationHealth = getAutomationHealth(status);
    const channels = status.channelStatus.map(item => {
        const permissions = item.channel ? item.channel.permissionsFor(client.user) : null;
        const canView = Boolean(permissions?.has(PermissionsBitField.Flags.ViewChannel));
        const canSend = item.key === 'supportCategory'
            ? Boolean(permissions?.has(PermissionsBitField.Flags.ManageChannels))
            : Boolean(permissions?.has(PermissionsBitField.Flags.SendMessages));
        return {
            key: item.key, label: CHANNEL_LABELS[item.key] ?? item.key, id: item.id,
            name: item.channel?.name ?? null, type: item.channel?.type ?? null,
            found: item.ready, canView, canSend, operational: item.ready && canView && canSend
        };
    });
    const automations = Object.entries(ALL_AUTOMATION_LABELS).map(([key, label]) => {
        const storeKey = key.startsWith('store_') ? key.slice('store_'.length) : null;
        const active = storeKey ? Boolean(status.commerceConfig.automations[storeKey]) : Boolean(status.settings.automations[key]);
        return { key, label, active, ready: automationHealth[key].ready,
            operational: Boolean(active && automationHealth[key].ready), detail: automationHealth[key].detail };
    });
    return {
        generatedAt: new Date().toISOString(),
        server: { id: guild.id, name: guild.name, members: guild.memberCount },
        bot: { ready: status.isReady, tag: client.user?.tag ?? 'desconhecido', pingMs: client.ws.ping,
            uptimeSeconds: Math.floor(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024) },
        services: {
            discord: { active: status.isReady, operational: status.isReady, detail: status.isReady ? 'Conectado ao Discord.' : 'Cliente Discord desconectado.' },
            api: { active: status.api.running, operational: status.api.running, port: status.api.port, detail: status.api.running ? `Escutando na porta ${status.api.port}.` : 'Servidor da API não está escutando.' },
            ollama: { active: Boolean(status.settings.automations.aiResponses), configured: automationHealth.aiResponses.ready, operational: Boolean(status.settings.automations.aiResponses && automationHealth.aiResponses.ready), detail: automationHealth.aiResponses.detail },
            ticketCreation: { active: true, operational: status.ticketPermissionReady, detail: status.ticketPermissionReady ? 'Categoria e permissão para criar canais disponíveis.' : 'Categoria ausente ou permissão ManageChannels indisponível.' }
        },
        automations, channels,
        assets: {
            wallpaper: { nextDay: status.wallpaperState.diaAtual, exists: status.currentWallpaperExists },
            stock: { ctzItem: status.stockState.ctz.indexAtual, ctzFiles: status.stockCtzCount,
                boostersItem: status.stockState.boosters.indexAtual, boostersFiles: status.stockBoostersCount }
        },
        payments: {
            active: status.paymentConfig.methods.filter(method => method.active).length,
            inactive: status.paymentConfig.methods.filter(method => !method.active).length,
            publicChannelId: status.paymentConfig.publicChannelId,
            methods: status.paymentConfig.methods.map(method => ({ id: method.id, name: method.name, type: method.type,
                active: Boolean(method.active), pixKeyConfigured: Boolean(method.pixKey), urlConfigured: Boolean(method.url) }))
        }
    };
}

function buildEmbed(page, status, guild) {
    const { settings } = status;
    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle(`📊 Painel do bot · ${guild.name}`)
        .setFooter({ text: 'Última atualização' })
        .setTimestamp();

    if (page === 'geral') {
        embed.setDescription('Acompanhe a conexão, os tickets e os pagamentos do servidor.');
        embed.addFields(
            { name: 'Discord', value: status.isReady ? '🟢 Conectado' : '🔴 Desconectado', inline: true },
            { name: 'Latência', value: client.ws.ping >= 0 ? `${client.ws.ping} ms` : 'Aguardando gateway', inline: true },
            { name: 'Tempo ligado', value: uptimeText(), inline: true },
            { name: 'API e painel web', value: status.api.running ? `🟢 Operante · porta ${status.api.port}` : '⚪ Inativa', inline: true },
            { name: 'Atendimento por IA', value: settings.automations.aiResponses ? '🟢 Habilitado · Ollama' : '⚪ Pausado', inline: true },
            { name: 'Memória do processo', value: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`, inline: true },
            { name: 'Painel de tickets', value: stateLabel(true, status.ticketPermissionReady), inline: true },
            { name: 'Métodos de pagamento', value: `${status.paymentConfig.methods.filter(item => item.active).length} ativos · ${status.paymentConfig.methods.filter(item => !item.active).length} inativos`, inline: true }
        );
    } else if (page === 'automacoes') {
        embed.setDescription('O estado “pronto” considera configuração, canal de destino e dependências locais disponíveis.');
        const automationHealth = getAutomationHealth(status);
        for (const [key, label] of Object.entries(ALL_AUTOMATION_LABELS)) {
            const health = automationHealth[key];
            const active = key.startsWith('store_') ? status.commerceConfig.automations[key.slice('store_'.length)] : settings.automations[key];
            embed.addFields({ name: label, value: `${stateLabel(active, health.ready)}${active ? `\n${health.detail}` : ''}`, inline: false });
        }
        embed.addFields({ name: 'Como alterar', value: 'Use a lista abaixo para ligar ou pausar cada automação.' });
    } else if (page === 'canais') {
        embed.setDescription('Verificação dos canais configurados: presença no servidor e tipo compatível.');
        const fields = status.channelStatus.map(item => ({
            name: CHANNEL_LABELS[item.key] ?? item.key,
            value: item.id ? (item.ready ? `🟢 <#${item.id}>` : `🔴 Canal não encontrado ou tipo incorreto · ${item.id}`) : '⚪ Não configurado',
            inline: true
        }));
        embed.addFields(fields.slice(0, 24));
        embed.addFields({ name: 'Tickets', value: stateLabel(true, status.ticketPermissionReady), inline: true });
    } else if (page === 'pagamentos') {
        const methods = status.paymentConfig.methods;
        embed.setDescription('Este painel não mostra chaves Pix nem credenciais.');
        embed.addFields({ name: 'Canal público de status', value: status.paymentConfig.publicChannelId ? `<#${status.paymentConfig.publicChannelId}>` : '⚪ Ainda não criado', inline: false });
        if (methods.length) {
            embed.addFields(methods.slice(0, 20).map(method => ({
                name: method.name,
                value: `${method.active ? '🟢 Ativo' : '⚪ Inativo'} · ${method.type === 'pix_manual' ? 'Pix manual' : 'Link de pagamento'}`,
                inline: true
            })));
        } else embed.addFields({ name: 'Métodos cadastrados', value: 'Nenhum. Use `/pagamentos` para cadastrar.' });
    }
    return embed;
}

function buildComponents(page, status, webTicket) {
    const webButton = new ButtonBuilder().setLabel('Ver na web').setEmoji('🌐');
    if (webTicket) webButton.setStyle(ButtonStyle.Link).setURL(dashboardWebUrl(webTicket));
    else webButton.setStyle(ButtonStyle.Secondary).setCustomId('dashboard:open-web');
    const rows = [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dashboard:refresh:${page}`).setLabel('Atualizar painel').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
        new ButtonBuilder().setCustomId('dashboard:open-payments').setLabel('Gerenciar pagamentos').setStyle(ButtonStyle.Secondary).setEmoji('💳'),
        webButton
    )];
    rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('dashboard:page')
            .setPlaceholder('Escolha uma seção')
            .addOptions(PAGES.map(([value, label]) => ({ label, value, default: value === page })))
    ));
    if (page === 'automacoes') {
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('dashboard:toggle-automation')
                .setPlaceholder('Ligar ou pausar uma automação')
                .addOptions(Object.entries(ALL_AUTOMATION_LABELS).map(([key, label]) => {
                    const active = key.startsWith('store_') ? status.commerceConfig.automations[key.slice('store_'.length)] : status.settings.automations[key];
                    return {
                    label: `${active ? 'Pausar' : 'Ativar'} · ${label}`,
                    value: `${key}:${active ? 'off' : 'on'}`
                }; }))
        ));
    }
    return rows;
}

function dashboardWebUrl(ticket = null) {
    const localWebUrl = new URL(`http://127.0.0.1:${getApiStatus().port}/painel`);
    let parsed = localWebUrl;
    try {
        const candidate = new URL(process.env.DASHBOARD_PUBLIC_URL?.trim() || localWebUrl);
        const hostname = candidate.hostname.replace(/^\[|\]$/g, '');
        const ipv4 = hostname.split('.').map(Number);
        const privateIpv4 = isIP(hostname) === 4 && (ipv4[0] === 10 || ipv4[0] === 192 && ipv4[1] === 168 || ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31);
        const privateIpv6 = isIP(hostname) === 6 && (/^(fc|fd)/i.test(hostname) || /^fe[89ab]/i.test(hostname));
        const loopback = ['localhost', '127.0.0.1', '::1'].includes(hostname);
        if (candidate.protocol === 'https:' || (candidate.protocol === 'http:' && (loopback || privateIpv4 || privateIpv6))) {
            parsed = candidate;
        }
    } catch { /* Use the local URL. */ }
    if (parsed.pathname === '/') parsed.pathname = '/painel';
    if (ticket) parsed.hash = `access=${ticket}`;
    return parsed.href;
}

function dashboardPayload(page, guild, webTicket = null) {
    const safePage = PAGES.some(([value]) => value === page) ? page : 'geral';
    const status = collectStatus(guild, guild.channels.cache);
    return { embeds: [buildEmbed(safePage, status, guild)], components: buildComponents(safePage, status, webTicket), allowedMentions: { parse: [] } };
}

function privateOverwrites(guild) {
    const allowedUsers = [...new Set([guild.ownerId, ...BOT_DEVELOPER_IDS])];
    const roleOverwrites = BOT_ADMIN_ROLE_IDS.map(id => ({
        id, type: 0, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.SendMessages]
    }));
    return [
        { id: guild.id, type: 0, deny: [PermissionsBitField.Flags.ViewChannel] },
        ...roleOverwrites,
        ...allowedUsers.map(id => ({ id, type: 1, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.SendMessages] })),
        { id: client.user.id, type: 1, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.ManageChannels] }
    ];
}

async function ensureDashboard(guild) {
    const reference = getDashboardReference();
    let channel = reference.channelId ? await guild.channels.fetch(reference.channelId).catch(() => null) : null;
    if (!channel?.isTextBased()) {
        channel = await guild.channels.create({ name: '📊・painel-do-bot', type: ChannelType.GuildText,
            topic: 'Painel administrativo privado do bot.', permissionOverwrites: privateOverwrites(guild) });
    } else {
        await channel.permissionOverwrites.set(privateOverwrites(guild));
    }
    saveDashboardReference(channel.id, reference.messageId);
    const existing = reference.channelId === channel.id && reference.messageId
        ? await channel.messages.fetch(reference.messageId).catch(() => null) : null;
    const payload = dashboardPayload('geral', guild);
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    saveDashboardReference(channel.id, message.id);
    return channel;
}

export async function configurarPainelDashboard() {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) throw new Error(`Servidor configurado não encontrado: ${GUILD_ID}`);
    return ensureDashboard(guild);
}

async function updateDashboardMessage(interaction, page = 'geral') {
    const isPrivate = interaction.message?.flags.has(MessageFlags.Ephemeral);
    const ticket = isPrivate ? issueDashboardLoginTicket(interaction.user.id, interaction.guild.id) : null;
    await interaction.update(dashboardPayload(page, interaction.guild, ticket));
}

export async function tratarInteracaoDashboard(interaction) {
    const command = interaction.isChatInputCommand() && interaction.commandName === 'painel';
    const component = (interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('dashboard:');
    if (!command && !component) return false;
    if (interaction.guild?.id !== GUILD_ID || !isServerManager(interaction)) {
        const response = { content: 'Apenas o dono do servidor e a equipe configurada podem acessar o painel.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) await interaction.followUp(response);
        else await interaction.reply(response);
        return true;
    }

    if (command) {
        const ticket = issueDashboardLoginTicket(interaction.user.id, interaction.guild.id);
        await interaction.reply({ ...dashboardPayload('geral', interaction.guild, ticket), flags: MessageFlags.Ephemeral });
        try { await logAction(interaction.guild, interaction.user.id, 'Painel do bot aberto', 'Comando /painel'); }
        catch (error) { console.error('[painel] Não foi possível registrar a abertura:', error); }
        return true;
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'dashboard:open-web') {
            const ticket = issueDashboardLoginTicket(interaction.user.id, interaction.guild.id);
            const components = ticket ? [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Abrir painel web').setStyle(ButtonStyle.Link).setURL(dashboardWebUrl(ticket))
            )] : [];
            const content = ticket ? 'Link pessoal. Use em até 10 minutos.' : 'Configure DASHBOARD_PASSWORD ou API_KEY para habilitar o acesso web.';
            await interaction.reply({ content, components, flags: MessageFlags.Ephemeral });
            return true;
        }
        await updateDashboardMessage(interaction, interaction.customId.split(':')[2] ?? 'geral');
        return true;
    }

    if (interaction.customId === 'dashboard:page') {
        await updateDashboardMessage(interaction, interaction.values[0]);
        return true;
    }
    if (interaction.customId === 'dashboard:toggle-automation') {
        const [key, value] = interaction.values[0].split(':');
        if (!(key in ALL_AUTOMATION_LABELS) || !['on', 'off'].includes(value)) {
            await interaction.reply({ content: 'Essa opção de automação não é válida.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const active = value === 'on';
        if (key.startsWith('store_')) {
            const commerceKey = key.slice('store_'.length);
            const commerce = getCommerceConfig();
            if (active && commerceKey === 'mercadoPago' && !mercadoPagoConfigReady()) {
                await interaction.reply({ content: 'Mercado Pago exige credenciais e webhook HTTPS antes de ser ativado.', flags: MessageFlags.Ephemeral });
                return true;
            }
            if (active && commerceKey === 'automaticDelivery' && getCommerceProducts({ includeInactive: false }).some(product => !commerce.roles[product.value])) {
                await interaction.reply({ content: 'Configure os cargos dos produtos com `/loja cargo` antes de ativar a entrega.', flags: MessageFlags.Ephemeral });
                return true;
            }
            setCommerceAutomation(commerceKey, active);
        } else updateSettings({ automations: { [key]: active } });
        await updateDashboardMessage(interaction, 'automacoes');
        try { await logAction(interaction.guild, interaction.user.id, 'Automação alterada pelo painel', `${ALL_AUTOMATION_LABELS[key]}: ${active ? 'ativa' : 'inativa'}`); }
        catch (error) { console.error('[painel] Não foi possível registrar a alteração da automação:', error); }
        return true;
    }
    return true;
}
