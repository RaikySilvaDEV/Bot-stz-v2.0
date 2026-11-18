import { client } from '../client.js';
import { EmbedBuilder } from 'discord.js';
import { iniciarVarreduraTicketsOrfaos } from '../features/tickets.js';
import { configurarCanalVerificacao, removerPainelParceriaAntigo } from '../features/community.js';
import { iniciarAgendadorRelogio, verificarEnviosPendentesAoLigar, removerAnuncioParceriaAntigo, iniciarAvisoCasoDeFalhaRecorrente, iniciarDivulgacaoAutomaticaVendas, enviarPainelAvisosInicio, enviarPainelBoosters } from '../features/automation.js';
import { registrarComandos } from '../commands/deploy.js';
import { removerAnuncioFiveMAntigo } from '../features/fivemAnnouncements.js';
import { iniciarApiAnunciosFiveM } from '../api/server.js';
import { removeExpiredRemoteTranscripts, removeExpiredTranscripts } from '../services/transcripts.js';
import { configurarPainelDashboard } from '../features/dashboard.js';
import { startFeedbackRecovery } from '../features/commerceFeedback.js';
import { startMercadoPagoWebhookProcessor } from '../api/mercadoPagoWebhook.js';
import { criarVitrineLoja } from '../features/commerce.js';
import { GUILD_ID } from '../config/constants.js';
import { configurarCanalArmadilha, iniciarSistemaArmadilha } from '../features/trap.js';
import { iniciarMonitoramentoVoice } from '../features/voiceMonitor.js';
import { publicarPainelTokens } from '../features/tokenPanel.js';

iniciarMonitoramentoVoice(client);

async function executarEtapa(nome, tarefa) {
    try {
        await tarefa();
    } catch (error) {
        console.error(`[inicialização:${nome}] Esta etapa falhou; as demais continuarão:`, error);
    }
}

async function limparMensagensAntigasDoBot(guild, canalId) {
    try {
        const canal = await guild.channels.fetch(canalId).catch(() => null);
        if (!canal?.isTextBased()) return canal;
        
        const mensagens = await canal.messages.fetch({ limit: 50 }).catch(() => null);
        if (mensagens) {
            const minhasMensagens = mensagens.filter(m => m.author.id === client.user.id);
            for (const msg of minhasMensagens.values()) {
                await msg.delete().catch(() => {});
            }
        }
        return canal;
    } catch (err) {
        console.error(`[limpeza] Erro ao limpar canal ${canalId}:`, err);
        return null;
    }
}

client.once('clientReady', async () => {
    iniciarApiAnunciosFiveM();
    startFeedbackRecovery();
    startMercadoPagoWebhookProcessor();
    console.log(`🤖 Bot conectado com sucesso como: ${client.user.tag}`);

    const guild = client.guilds.cache.get(GUILD_ID);

    if (guild) {
        // 1. Limpa e publica a vitrine de compras online
        await executarEtapa('canal compras online', async () => {
            const canalComprasId = '1552152094411329546';
            const canal = await limparMensagensAntigasDoBot(guild, canalComprasId);
            if (canal) {
                await canal.send(criarVitrineLoja());
            }
        });

        // 2. Limpa e publica o painel de pagamentos com a tarja vermelha
        await executarEtapa('canal pagamentos', async () => {
            const canalPagamentosId = '1567759689289171055';
            const canal = await limparMensagensAntigasDoBot(guild, canalPagamentosId);
            if (canal) {
                const embedPagamentos = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('💠 • FORMAS DE PAGAMENTO • COMMUNITY FOR GOATS')
                    .setDescription(
                        'Para garantir agilidade e segurança nas suas compras, informamos que o nosso ' +
                        'método oficial de pagamento é exclusivamente via **PIX**.\n\n' +
                        '⚡ **Liberação Automática:**\n' +
                        '• Pagamentos aprovados via Mercado Pago liberam o seu cargo na hora!\n' +
                        '• Basta escolher o produto desejado em <#1552152094411329546> e escanear o QR ' +
                        'Code ou usar o Pix Copia e Cola.\n\n' +
                        '> 🔒 *Caso tenha qualquer dúvida ou precise de ajuda com um comprovante, ' +
                        'abra um atendimento em <#1547234961528979476>.*'
                    )
                    .setFooter({ text: 'Community For Goats • Pagamento Seguro e Automatizado' });

                await canal.send({ embeds: [embedPagamentos] });
            }
        });

        // 3. Limpa e envia o painel de avisos gerais de acesso premium no arranque
        await executarEtapa('painel de avisos gerais', async () => {
            await enviarPainelAvisosInicio(guild);
        });

        // 4. Limpa e envia o painel de boosters no canal correto
        await executarEtapa('painel boosters', async () => {
            await enviarPainelBoosters(guild);
        });

        // 5. Limpa e publica o painel de gestão de tokens no canal correto
        await executarEtapa('painel de tokens', async () => {
            const canalTokensId = '1567697086944649336';
            const canal = await limparMensagensAntigasDoBot(guild, canalTokensId);
            if (canal) {
                await publicarPainelTokens(canal);
                console.log('[tokens] Painel de tokens publicado com sucesso no canal!');
            }
        });
    }

    try {
        const expired = await removeExpiredTranscripts();
        const remoteExpired = await removeExpiredRemoteTranscripts(client);
        if (expired || remoteExpired) console.log(`[tickets] Removidas ${expired} transcrição(ões) local(is) e ${remoteExpired} cópia(s) no Discord com mais de 90 dias.`);
        setInterval(async () => {
            try {
                const count = await removeExpiredTranscripts();
                const remoteCount = await removeExpiredRemoteTranscripts(client);
                if (count || remoteCount) console.log(`[tickets] Removidas ${count} transcrição(ões) local(is) e ${remoteCount} cópia(s) no Discord com mais de 90 dias.`);
            } catch (error) {
                console.error('[tickets] Falha na limpeza periódica das transcrições:', error);
            }
        }, 24 * 60 * 60 * 1000);
    } catch (error) {
        console.error('[tickets] Não foi possível aplicar a retenção das transcrições:', error);
    }

    try {
        await registrarComandos();
    } catch (error) {
        console.error('Não foi possível registrar os comandos de barra:', error);
    }

    await executarEtapa('varredura de tickets', iniciarVarreduraTicketsOrfaos);
    await executarEtapa('painel de verificação', configurarCanalVerificacao);
    await executarEtapa('painel antigo de parcerias', removerPainelParceriaAntigo);
    await executarEtapa('anúncio antigo FiveM', removerAnuncioFiveMAntigo);
    await executarEtapa('anúncio antigo de parcerias', removerAnuncioParceriaAntigo);
    await executarEtapa('agendador', iniciarAgendadorRelogio);
    await executarEtapa('envios pendentes', verificarEnviosPendentesAoLigar);
    await executarEtapa('painel privado do bot', configurarPainelDashboard);
    await executarEtapa('canal armadilha', configurarCanalArmadilha);
    await executarEtapa('sistema armadilha', iniciarSistemaArmadilha);
    await executarEtapa('aviso caso de falha', iniciarAvisoCasoDeFalhaRecorrente);
    await executarEtapa('divulgação automática vendas', iniciarDivulgacaoAutomaticaVendas);
});

client.on('error', error => console.error('[discord] Erro no cliente Discord:', error));
client.on('shardError', error => console.error('[discord] Falha na conexão do shard:', error));