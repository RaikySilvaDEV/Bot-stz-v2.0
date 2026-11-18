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
    if (!channel) return false;
    
    try {
        const mensagens = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (mensagens) {
            for (const msg of mensagens.values()) {
                if (msg.author.id === client.user.id) {
                    await msg.delete().catch(() => {});
                }
            }
        }

        const painel = criarPainelTickets();
        await channel.send(painel);
        return true;
    } catch (err) {
        console.error('[tickets] Erro ao publicar painel de tickets:', err);
        return false;
    }
}

export async function tratarInteracaoTickets(interaction) {
    // 1. Tratamento do botão de fechar ticket
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        const member = interaction.member;
        const temPermissao = 
            member.roles.cache.has(CARGO_PERMITIDO_FECHAR) || 
            member.roles.cache.has(CARGO_STAFF_SUPORTE_ID) || 
            member.permissions.has(PermissionFlagsBits.Administrator);

        if (!temPermissao) {
            await interaction.editReply({
                content: `❌ Apenas membros com o cargo autorizado (<@&${CARGO_PERMITIDO_FECHAR}>) podem fechar este ticket!`
            });
            return true;
        }

        await interaction.editReply({
            content: '🔒 Fechando canal de atendimento...'
        });

        setTimeout(async () => {
            try {
                await archiveAndCloseTicket(interaction.guild, interaction.channel, interaction.user.id, 'Fechado manualmente por membro autorizado.');
            } catch (e) {
                await interaction.channel?.delete().catch(() => {});
            }
        }, 1500);

        return true;
    }

    // 2. Tratamento da abertura de ticket via menu de seleção
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'abrir_ticket_select') return false;

    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
    } catch (err) {
        return true;
    }

    const guild = interaction.guild;
    const user = interaction.user;
    const valor = interaction.values[0];

    const categoriasNomes = {
        'ticket_duvidas': '❓・duvidas',
        'ticket_suporte_compra': '🛒・suporte-compra',
        'ticket_parcerias': '🤝・parcerias'
    };

    const nomeCanal = `${categoriasNomes[valor] || 'ticket'}-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    try {
        const ticketChannel = await guild.channels.create({
            name: nomeCanal,
            type: ChannelType.GuildText,
            parent: SUPORTE_CATEGORY_ID,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: CARGO_STAFF_SUPORTE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
                { id: CARGO_PERMITIDO_FECHAR, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
            ]
        });

        const rowFechamento = {
            type: 1,
            components: [
                {
                    type: 2,
                    style: 4,
                    label: 'Fechar Ticket',
                    custom_id: 'fechar_ticket',
                    emoji: '🔒'
                }
            ]
        };

        const horaAtual = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }), 10);
        let saudacao = 'Bom dia';
        if (horaAtual >= 12 && horaAtual <= 17) {
            saudacao = 'Boa tarde';
        } else if (horaAtual >= 18 || horaAtual <= 4) {
            saudacao = 'Boa noite';
        }

        let textoInicial = `👋 Olá <@${user.id}>! ${saudacao}! No que posso ajudar?`;
        
        try {
            await ticketChannel.sendTyping();
            const respostaIa = await requisitarOllamaApi([
                {
                    role: 'system',
                    content: `Você é o assistente virtual da Community For Goats・🏆. Um novo ticket acabou de ser aberto por <@${user.id}> com o motivo "${valor}". Cumprimente o usuário chamando-o obrigatoriamente por <@${user.id}> dizendo exatamente "${saudacao}!" e logo em seguida adicione a frase: "No que posso ajudar?". Seja prestativo e lembre que temos mods, FiveM, Valorant e produtos da loja.`
                }
            ]);
            if (respostaIa) {
                textoInicial = respostaIa;
            }
        } catch (e) {
            console.error('[tickets] Erro ao gerar saudação inicial via Ollama:', e);
        }

        await ticketChannel.send({
            content: textoInicial,
            components: [rowFechamento]
        });

        setupInactivityTimeout(ticketChannel, guild);

        await interaction.editReply({
            content: `✅ O seu canal de atendimento foi criado com sucesso: <#${ticketChannel.id}>!`
        });

        await logAction(guild, user.id, 'Ticket Criado', `Canal: ${ticketChannel.name} (${valor})`);
    } catch (error) {
        console.error('[tickets] Erro ao criar canal de ticket:', error);
        await interaction.editReply({
            content: '❌ Ocorreu um erro interno ao criar o seu canal de atendimento. Tente novamente.'
        });
    }

    return true;
}

export function iniciarVarreduraTicketsOrfaos() {}