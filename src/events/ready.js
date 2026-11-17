import { client } from '../client.js';
import { iniciarVarreduraTicketsOrfaos } from '../features/tickets.js';
import { configurarCanalVerificacao, removerPainelParceriaAntigo } from '../features/community.js';
import { iniciarAgendadorRelogio, verificarEnviosPendentesAoLigar, removerAnuncioParceriaAntigo, iniciarAvisoCasoDeFalhaRecorrente, iniciarDivulgacaoAutomaticaVendas } from '../features/automation.js';
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
        await executarEtapa('canal compras online', async () => {
            const canalComprasId = '1552152094411329546';
            const canal = await limparMensagensAntigasDoBot(guild, canalComprasId);
            if (canal) {
                await canal.send(criarVitrineLoja());
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