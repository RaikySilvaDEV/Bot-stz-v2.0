import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import fetch from 'node-fetch';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';
// Usa o valor do .env (OLLAMA_TIMEOUT_MS) ou define 30 segundos por segurança
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 30000;

const MEU_ID_DISCORD = '1231602226645041258';
const CANAL_ALVO_TICKETS = '1547234961528979476';

let iaAtivadaNosTickets = true;

export async function tratarComandoIa(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'ia') return false;

    const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🤖 • GESTÃO DA IA DOS TICKETS')
        .setDescription(
            `Gerencie o atendimento automático da inteligência artificial no canal de tickets (<#${CANAL_ALVO_TICKETS}>).\n\n` +
            `• **Ativar**: A IA responderá com base no conhecimento da Community For Goats.\n` +
            `• **Desativar**: A IA ficará completamente morda neste canal.`
        )
        .setFooter({ text: 'Community For Goats • Sistema de IA Local' });

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
        iaAtivadaNosTickets = interaction.customId === 'ia_ativar';

        await interaction.update({
            content: `✅ Inteligência Artificial dos tickets foi **${iaAtivadaNosTickets ? 'ATIVADA' : 'DESATIVADA'}** com sucesso!`,
            embeds: [],
            components: []
        });
        return true;
    }
    return false;
}

export async function requisitarOllamaApi(messages) {
    try {
        console.log(`[ollama] Enviando requisição para o modelo local (Timeout configurado: ${OLLAMA_TIMEOUT}ms)...`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

        const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                messages,
                stream: false,
                options: { 
                    num_ctx: parseInt(process.env.OLLAMA_NUM_CTX, 10) || 1024, 
                    num_predict: parseInt(process.env.OLLAMA_NUM_PREDICT, 10) || 120, 
                    temperature: 0.6 
                }
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`[ollama] Erro na API do Ollama: Status ${response.status}`);
            return null;
        }

        const data = await response.json();
        const respostaTexto = data.message?.content?.trim();
        console.log('[ollama] Resposta recebida com sucesso!');
        return respostaTexto || null;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error(`[ollama] ERRO: O Ollama demorou muito e excedeu o tempo limite de ${OLLAMA_TIMEOUT / 1000}s.`);
        } else {
            console.error('[ollama] Falha de conexão com o Ollama local:', error.message);
        }
        return null;
    }
}

export async function gerarRespostaOllama(messages) {
    return await requisitarOllamaApi(messages);
}

export async function tratarComandoIaTeste(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'iateste') return false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const pergunta = interaction.options.getString('pergunta');

    try {
        const dataHoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const horarioCompleto = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        const promptSistema = {
            role: 'system',
            content: [
                `Você é o assistente virtual inteligente e prestativo da comunidade **Community For Goats・🏆**.`,
                `REGRAS DE CONHECIMENTO E RESPOSTAS:`,
                `- Pergunta sobre que horas são ou que dia é hoje? Responda informando que hoje é ${dataHoje} e agora são ${horarioCompleto}.`,
                `- Tabela de preços oficial da loja:`,
                `  • Cargo Premium: R$ 12,00`,
                `  • Server Booster: R$ 7,00`,
                `  • Cargo Premium Booster: R$ 14,00`,
                `- Como conseguir o **PrecisionFix**: Explique que é preciso ter o acesso premium. Indique o canal de informações <#1549781288251031562>, informe que custa apenas **R$ 12,00**, mostre o canal de pagamentos <#1552152094411329546> para comprar, e diga que para ver como funciona, ele pode conferir os vídeos no YouTube do criador: https://www.youtube.com/@stzzgoat.`,
                `- Assuntos privados, dados sensíveis ou **pedidos de desconto**: A IA NÃO deve resolver. Nesses casos, responda educadamente que não pode tratar disso, marque obrigatoriamente o criador com a menção exata <@${MEU_ID_DISCORD}> e peça para o usuário aguardar o seu atendimento.`,
                `- Seja coerente, inteligente, direto e prestativo.`
            ].join('\n')
        };

        const payload = [promptSistema, { role: 'user', content: pergunta }];
        const respostaIa = await requisitarOllamaApi(payload);

        if (respostaIa) {
            await interaction.editReply({
                content: `🤖 **Teste do Ollama (${OLLAMA_MODEL}):**\n\n**Pergunta:** "${pergunta}"\n\n**Resposta da IA:**\n${respostaIa}`
            });
        } else {
            await interaction.editReply({
                content: `❌ O Ollama não retornou nenhuma resposta ou excedeu o limite de ${OLLAMA_TIMEOUT / 1000} segundos.`
            });
        }
    } catch (err) {
        console.error('[iateste] Erro ao executar teste da IA:', err);
        await interaction.editReply({
            content: '❌ Ocorreu um erro ao executar o teste da IA.'
        });
    }

    return true;
}

export async function processarMensagemTicketOllama(message) {
    if (message.author.bot || !message.guild || !iaAtivadaNosTickets) return;
    if (message.author.id === MEU_ID_DISCORD) return;

    const ehTicket = message.channel.name?.startsWith('ticket-') || 
                     message.channel.name?.includes('duvidas') || 
                     message.channel.name?.includes('suporte') || 
                     message.channel.name?.includes('parcerias');
                     
    if (!ehTicket) return;

    try {
        await message.channel.sendTyping();

        const horaAtual = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }), 10);
        let saudacao = 'Bom dia';
        if (horaAtual >= 12 && horaAtual <= 17) {
            saudacao = 'Boa tarde';
        } else if (horaAtual >= 18 || horaAtual <= 4) {
            saudacao = 'Boa noite';
        }

        const dataHoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const horarioCompleto = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        const historicoMsgs = await message.channel.messages.fetch({ limit: 6 });
        const mensagensFormatadas = [...historicoMsgs.values()].reverse().map(m => ({
            role: m.author.id === message.client.user.id ? 'assistant' : 'user',
            content: m.content
        }));

        const promptSistema = {
            role: 'system',
            content: [
                `Você é o assistente virtual inteligente e prestativo da comunidade **Community For Goats・🏆**.`,
                `O usuário que está falando com você é <@${message.author.id}>.`,
                `REGRAS DE CONHECIMENTO E RESPOSTAS:`,
                `- Pergunta sobre que horas são ou que dia é hoje? Responda informando que hoje é ${dataHoje} e agora são ${horarioCompleto}.`,
                `- Tabela de preços oficial da loja:`,
                `  • Cargo Premium: R$ 12,00`,
                `  • Server Booster: R$ 7,00`,
                `  • Cargo Premium Booster: R$ 14,00`,
                `- Como conseguir o **PrecisionFix**: Explique que é preciso ter o acesso premium. Indique o canal de informações <#1549781288251031562>, informe que custa apenas **R$ 12,00**, mostre o canal de pagamentos <#1552152094411329546> para comprar, e diga que para ver como funciona, ele pode conferir os vídeos no YouTube do criador: https://www.youtube.com/@stzzgoat.`,
                `- Assuntos privados, dados sensíveis ou **pedidos de desconto**: A IA NÃO deve resolver. Nesses casos, responda educadamente que não pode tratar disso, marque obrigatoriamente o criador com a menção exata <@${MEU_ID_DISCORD}> e peça para o usuário aguardar o seu atendimento.`,
                `- Seja coerente, inteligente, direto e prestativo.`
            ].join('\n')
        };

        const payload = [promptSistema, ...mensagensFormatadas];
        const respostaIa = await requisitarOllamaApi(payload);

        if (respostaIa) {
            await message.reply(respostaIa);
        }
    } catch (err) {
        console.error('[ollama] Erro ao responder ticket automaticamente:', err);
    }
}