import fetch from 'node-fetch';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';

export async function processarMensagemTicketOllama(message) {
    // 1. Ignorar se for bot ou fora de canais de texto
    if (message.author.bot || !message.guild) return;

    // 2. Se você (ID: 1231602226645041258) mandou mensagem no ticket, a IA pára imediatamente para não atrapalhar o seu atendimento!
    if (message.author.id === '1231602226645041258') {
        return; 
    }

    // Verifica se o canal atual é o canal de tickets alvo (1547234961528979476) ou começa com ticket-
    const ehCanalTicket = message.channel.name?.startsWith('ticket-') || message.channel.id === '1547234961528979476';
    if (!ehCanalTicket) return;

    try {
        await message.channel.sendTyping();

        // Saudação baseada no horário atual do Brasil (America/Sao_Paulo)
        const horaAtual = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false });
        let saudacao = 'Bom dia';
        if (horaAtual >= 12 && horaAtual < 18) {
            saudacao = 'Boa tarde';
        } else if (horaAtual >= 18 || horaAtual < 5) {
            saudacao = 'Boa noite';
        }

        const dataHoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const horarioCompleto = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        // Histórico recente do canal para contexto
        const historicoMsgs = await message.channel.messages.fetch({ limit: 6 });
        const mensagensFormatadas = [...historicoMsgs.values()].reverse().map(m => ({
            role: m.author.id === message.client.user.id ? 'assistant' : 'user',
            content: m.content
        }));

        // System Prompt com toda a base de conhecimento e regras estritas
        const promptSistema = {
            role: 'system',
            content: [
                `Você é o assistente virtual inteligente da comunidade **Community For Goats・🏆**.`,
                `Sempre comece cumprimentando o membro de forma natural usando exatamente a saudação correta para o momento: "${saudacao}!"`,
                `REGRAS DE CONHECIMENTO E RESPOSTAS:`,
                `- Pergunta sobre que horas são ou que dia é hoje? Responda informando que hoje é ${dataHoje} e agora são ${horarioCompleto}.`,
                `- Tabela de preços dos produtos da loja:`,
                `  • Cargo Premium: R$ 12,00`,
                `  • Server Booster: R$ 7,00`,
                `  • Cargo Premium Booster: R$ 14,00`,
                `- Quer saber como conseguir o **PrecisionFix**? Explique que é preciso ter o acesso premium. Indique o canal de informações: <#1549781288251031562>, informe que custa apenas **R$ 12,00**, mostre o link para comprar na loja: <#1552152094411329546>, e diga que se tiver dúvidas de como funciona, pode olhar os vídeos no canal do criador: https://www.youtube.com/@stzzgoat.`,
                `- Assuntos mais privados, dados sensíveis, alterações manuais ou **pedidos de desconto**: A IA NÃO deve resolver. Nesses casos, responda educadamente que não pode tratar disso, marque obrigatoriamente o seu criador com a menção exata <@1231602226645041258> e peça para o usuário aguardar você chegar para resolver.`,
                `- Seja coerente, inteligente, direto e prestativo.`
            ].join('\n')
        };

        const payload = [
            promptSistema,
            ...mensagensFormatadas
        ];

        const respostaIa = await requisitarOllamaApi(payload);

        if (respostaIa) {
            await message.reply(respostaIa);
        }
    } catch (err) {
        console.error('[ollama] Erro ao responder ticket automaticamente:', err);
    }
}

async function requisitarOllamaApi(messages) {
    try {
        const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                messages,
                stream: false,
                options: { num_ctx: 1024, num_predict: 150, temperature: 0.6 }
            })
        });

        if (!response.ok) return null;
        const data = await response.json();
        return data.message?.content?.trim() || null;
    } catch (error) {
        console.error('[ollama] Falha de conexão local:', error.message);
        return null;
    }
}