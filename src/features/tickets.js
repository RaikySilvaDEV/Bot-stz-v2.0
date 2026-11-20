import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getSettings } from '../repositories/settingsRepository.js';
import { publicarSeletorProdutos } from './commerce.js';
import { ChannelType, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { client } from '../client.js';
import { CARGO_STAFF_SUPORTE_ID } from '../config/constants.js';
import { addNotifiedTicketId, getNotifiedTicketIds, removeNotifiedTicketId } from '../repositories/stateRepository.js';
import { logAction } from '../services/audit.js';
import { archiveAndCloseTicket } from '../services/ticketClosure.js';
import { requisitarOllamaApi } from './ia.js';
import path from 'node:path';
import fs from 'node:fs';

const SUPORTE_CATEGORY_ID = '1570561179892584548';
const CARGO_PERMITIDO_FECHAR = '1535261471641042964';
const inactivityTimers = new Map();

client.on('channelDelete', channel => {
    try {
        removeNotifiedTicketId(channel.id);
        if (inactivityTimers.has(channel.id)) {
            clearInterval(inactivityTimers.get(channel.id));
            inactivityTimers.delete(channel.id);
        }
    } catch (error) {
        console.error('[tickets] Não foi possível limpar o estado do ticket removido:', error);
    }
});

function setupInactivityTimeout(channel, guild) {
    if (inactivityTimers.has(channel.id)) return;
    const checkInterval = 5 * 60 * 1000;
    const timeoutDuration = 60 * 60 * 1000;

    const interval = setInterval(async () => {
        try {
            const fetchedChannel = await guild.channels.fetch(channel.id).catch(() => null);
            if (!fetchedChannel) {
                clearInterval(interval);
                inactivityTimers.delete(channel.id);
                return;
            }

            const lastMessageId = fetchedChannel.lastMessageId;
            if (!lastMessageId) return;

            const lastMessage = await fetchedChannel.messages.fetch(lastMessageId).catch(() => null);
            if (!lastMessage) return;

            const timeSinceLastMessage = Date.now() - lastMessage.createdTimestamp;
            if (timeSinceLastMessage >= timeoutDuration) {
                clearInterval(interval);
                inactivityTimers.delete(channel.id);
                await archiveAndCloseTicket(guild, fetchedChannel, client.user.id, 'Fechado automaticamente por inatividade (1 hora).');
            }
        } catch (err) {
            console.error('[tickets] Erro ao verificar inatividade do ticket:', err);
        }
    }, checkInterval);

    interval.unref?.();
    inactivityTimers.set(channel.id, interval);
}

export function criarPainelTickets() {
    const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🎫 • COMMUNITY FOR GOATS — CENTRAL DE ATENDIMENTO')
        .setDescription(
            'Selecione abaixo o motivo do seu contato para abrir um canal de atendimento privado com a nossa equipe:\n\n' +
            '📌 **Opções de Suporte**\n' +
            '❓ **Dúvidas Gerais:** Tire dúvidas gerais sobre o servidor, regras e orientações.\n' +
            '🛒 **Suporte a Compra:** Dúvidas ou problemas com pagamentos e entrega de cargos.\n' +
            '🤝 **Parcerias:** Propostas de parcerias e divulgação com o servidor.\n\n' +
            '> *Escolha uma das opções no menu abaixo para abrir o seu ticket instantaneamente.*'
        );

    const files = [];
    const bannerPath = path.join(process.cwd(), 'assets', 'store', 'tickets-banner.png');
    
    if (fs.existsSync(bannerPath)) {
        files.push(new AttachmentBuilder(bannerPath, { name: 'tickets-banner.png' }));
        embed.setImage('attachment://tickets-banner.png');
    }

    return {
        embeds: [embed],
        files: files,
        components: [
            {
                type: 1,
                components: [
                    {
                        type: 3,
                        custom_id: 'abrir_ticket_select',
                        placeholder: '🎫 Selecione o motivo do atendimento...',
                        options: [
                            { label: 'Dúvidas Gerais', description: 'Tire dúvidas gerais sobre o servidor e regras', value: 'ticket_duvidas', emoji: '❓' },
                            { label: 'Suporte a Compra', description: 'Problemas com pagamentos e entrega de cargos', value: 'ticket_suporte_compra', emoji: '🛒' },
                            { label: 'Parcerias', description: 'Propostas de parcerias com o servidor', value: 'ticket_parcerias', emoji: '🤝' }
                        ]
                    }
                ]
            }
        ]
    };
}


export async function publicarPainelTickets(channel) {
    const recent = await channel.messages.fetch({ limit: 50 });
    const existing = [...recent.values()].find(message => message.author.id === client.user.id && message.components.some(row => row.components.some(item => item.customId === 'abrir_ticket_select')));
    if (existing) await existing.edit(criarPainelTickets());
    else await channel.send(criarPainelTickets());
    return true;
}
const opening = new Set();
export async function abrirTicketCompra(interaction) {
    const { guild, user } = interaction;
    const key = `${guild.id}:${user.id}`;
    if (opening.has(key)) { await interaction.editReply({ content: 'Seu carrinho está sendo criado. Aguarde.' }); return; }
    opening.add(key);
    try {
        let channel = [...guild.channels.cache.values()].find(item => item.topic === `ticket-owner:${user.id}` && item.name.startsWith('carrinho-'));
        const reused = Boolean(channel);
        if (!channel) channel = await guild.channels.create({
            name: `carrinho-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '') || user.id}`,
            type: ChannelType.GuildText, parent: getSettings().channels.supportCategory,
            topic: `ticket-owner:${user.id}`,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: CARGO_STAFF_SUPORTE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
            ]
        });
        if (!reused) await publicarSeletorProdutos(channel);
        setupInactivityTimeout(channel, guild);
        await interaction.editReply({ content: reused ? `Seu carrinho está aberto em <#${channel.id}>.` : `Seu carrinho foi criado em <#${channel.id}>.`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Abrir carrinho').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guild.id}/${channel.id}`))] });
        return channel;
    } finally { opening.delete(key); }
}
export async function tratarInteracaoTickets(interaction) {
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const member = interaction.member;
        if (!member?.permissions?.has(PermissionFlagsBits.Administrator) && !member?.roles?.cache?.has(CARGO_STAFF_SUPORTE_ID)) {
            await interaction.editReply({ content: 'Apenas a equipe pode fechar o ticket.' }); return true;
        }
        if (!interaction.channel?.topic?.startsWith('ticket-owner:')) {
            await interaction.editReply({ content: 'Este canal não é um ticket.' }); return true;
        }
        await interaction.editReply({ content: 'Salvando a transcrição e fechando o ticket.' });
        // A falha ao arquivar preserva o canal para uma nova tentativa.
        await archiveAndCloseTicket(interaction.guild, interaction.channel, interaction.user.id, 'Fechamento manual');
        return true;
    }
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'abrir_ticket_select') return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (interaction.values[0] === 'ticket_suporte_compra') { await abrirTicketCompra(interaction); return true; }
    const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '') || interaction.user.id}`,
        type: ChannelType.GuildText, parent: getSettings().channels.supportCategory,
        topic: `ticket-owner:${interaction.user.id}`,
        permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: CARGO_STAFF_SUPORTE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ]
    });
    await channel.send({ content: `Olá <@${interaction.user.id}>! No que podemos ajudar?`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('fechar_ticket').setLabel('Fechar ticket').setStyle(ButtonStyle.Danger))] });
    setupInactivityTimeout(channel, interaction.guild);
    await interaction.editReply({ content: `Atendimento criado em <#${channel.id}>.` });
    return true;
}
export function iniciarVarreduraTicketsOrfaos() {
    for (const guild of client.guilds.cache.values()) for (const channel of guild.channels.cache.values()) {
        if (channel.topic?.startsWith('ticket-owner:')) setupInactivityTimeout(channel, guild);
    }
}
