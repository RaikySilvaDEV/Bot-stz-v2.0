import fetch from 'node-fetch';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 30000;

const MEU_ID_DISCORD = '1231602226645041258'; // @stzzgoat

const ticketHistories = new Map();
let iaAtivadaNosTickets = true;

export async function tratarComandoIa(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'ia') return false;

    const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🤖 • GESTÃO DA IA DOS TICKETS')
        .setDescription(
            `Gerencie o atendimento automático do Charles nos tickets.\n\n` +
            `• **Ativar**: A IA responderá com base nas diretrizes oficiais.\n` +
            `• **Desativar**: A IA ficará completamente morda.`
        )
        .setFooter({ text: 'Community for FiveM • Sistema de IA Local' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ia_ativar').setLabel('🟢 Ativar IA').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ia_desativar').setLabel('🔴 Desativar IA').setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    return true;
}

export async function tratarBotoesIa(interaction) {
    if (!interaction.isButton()) return false;

    if (interaction.customId === 'ia_ativar' || interaction.customId === 'ia_desativar') {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate().catch(() => {});
        }

        iaAtivadaNosTickets = interaction.customId === 'ia_ativar';

        await interaction.editReply({
            content: `✅ Inteligência Artificial dos tickets foi **${iaAtivadaNosTickets ? 'ATIVADA' : 'DESATIVADA'}** com sucesso!`,
            embeds: [],
            components: []
        }).catch(() => {});
        
        return true;
    }
    return false;
}

export async function requisitarOllamaApi(messages) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

        const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                messages,
                stream: false,
                options: { num_ctx: 512, num_predict: 120, temperature: 0.4 }
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) return null;

        const data = await response.json();
        return data.message?.content?.trim() || null;
    } catch (error) {
        console.error('[ia] Erro de comunicação com o Ollama:', error.message);
        return null;
    }
}

export async function processarMensagemTicketOllama(message) {
    if (message.author.bot || !message.guild || !iaAtivadaNosTickets) return;
    if (message.author.id === MEU_ID_DISCORD) return;

    const channelName = message.channel.name?.toLowerCase() || '';
    const ehTicket = channelName.startsWith('ticket-') || 
                     channelName.includes('duvidas') || 
                     channelName.includes('suporte') || 
                     channelName.includes('parcerias') ||
                     message.channel.id === '1547234961528979476';

    if (!ehTicket) return;

    const channelId = message.channel.id;
    if (!ticketHistories.has(channelId)) {
        ticketHistories.set(channelId, []);
    }
    const history = ticketHistories.get(channelId);

    try {
        await message.channel.sendTyping();

        const horaAtual = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }), 10);
        let saudacao = 'Bom dia';
        if (horaAtual >= 12 && horaAtual <= 17) {
            saudacao = 'Boa tarde';
        } else if (horaAtual >= 18 || horaAtual <= 4) {
            saudacao = 'Boa noite';
        }

        const systemPrompt = `Você é o Charles, assistente oficial da "Community for Goats・" (FiveM/Valorant). Cumprimente com "${saudacao}!" e seja direto, educado e entenda gírias BR.
Regras do PrecisionFix (otimizador de FPS/FiveM):
- NÃO é gratuito. Custa R$ 12,00 (Cargo Premium com acesso de 5 dias).
- Direcione o cliente para o canal da loja para comprar.
Transbordo humano:
- Se houver problema grave de pagamento, estorno, banimento, bug crítico ou insistência, coloque CHAVE_HUMANO no final da resposta e avise que <@${MEU_ID_DISCORD}> vai assumir.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: `${message.author.username}: ${message.content}` }
        ];

        let replyText = await requisitarOllamaApi(messages);
        if (!replyText) {
            replyText = 'Desculpe, tive um pequeno atraso para processar sua mensagem. Poderia repetir, por favor?';
        }

        if (replyText.includes('CHAVE_HUMANO')) {
            replyText = replyText.replace('CHAVE_HUMANO', '').trim();
            replyText += `\n\n🔔 *Acionei o suporte humano. O administrador responsável (<@${MEU_ID_DISCORD}>) foi sinalizado e logo assumirá o atendimento por aqui!*`;
            
            await message.channel.send({ 
                content: `<@${MEU_ID_DISCORD}>, um usuário precisa de atendimento humano neste ticket!` 
            }).catch(() => {});
        }

        history.push({ role: 'user', content: message.content });
        history.push({ role: 'assistant', content: replyText });
        if (history.length > 6) history.splice(0, 2);

        await message.reply(replyText);

    } catch (err) {
        console.error('[ia] Erro ao processar mensagem do ticket com a IA:', err);
    }
}