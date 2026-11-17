import { EmbedBuilder } from 'discord.js';

const AGUARDANDO_SUPORTE_VC_ID = '1547226171933065266';
const SUPORTE_ROLE_ID = '1535261471641042964';
const LOGS_CHANNEL_ID = '1568960774024728709';

export function iniciarMonitoramentoVoice(clientInstance) {
    const setupListener = (client) => {
        client.on('voiceStateUpdate', async (oldState, newState) => {
            try {
                const member = newState.member || await newState.guild.members.fetch(newState.id).catch(() => null);
                if (!member || member.user.bot) return;

                // Log de depuração para ver no terminal todas as movimentações de voz
                console.log(`[voiceMonitor] Movimento de voz detetado: ${member.user.tag} | Canal Antigo: ${oldState.channelId} | Canal Novo: ${newState.channelId}`);

                // Verifica se o usuário entrou no canal de voz "aguardando suporte"
                const entrouNoCanal = newState.channelId === AGUARDANDO_SUPORTE_VC_ID && oldState.channelId !== AGUARDANDO_SUPORTE_VC_ID;

                if (entrouNoCanal) {
                    const guild = newState.guild;
                    const canalLogs = guild.channels.cache.get(LOGS_CHANNEL_ID) || await guild.channels.fetch(LOGS_CHANNEL_ID).catch(() => null);

                    if (!canalLogs?.isTextBased()) {
                        console.error(`[voiceMonitor] ERRO: Canal de logs ${LOGS_CHANNEL_ID} não encontrado ou não é baseado em texto!`);
                        return;
                    }

                    const embed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('🎙️ • NOVO PEDIDO DE SUPORTE NA CALL')
                        .setDescription(
                            `O utilizador <@${member.id}> entrou no canal de espera de suporte.\n\n` +
                            `🔊 **Canal:** <#${AGUARDANDO_SUPORTE_VC_ID}>\n` +
                            `👤 **Utilizador:** \`${member.user.tag}\` (${member.id})`
                        )
                        .setTimestamp();

                    await canalLogs.send({
                        content: `🔔 <@&${SUPORTE_ROLE_ID}> Atenção equipe! Novo membro aguardando atendimento na call!`,
                        embeds: [embed],
                        allowedMentions: {
                            roles: [SUPORTE_ROLE_ID]
                        }
                    });

                    console.log(`[voiceMonitor] Alerta de suporte enviado com sucesso para o canal ${LOGS_CHANNEL_ID} referente a @${member.user.tag}.`);
                }
            } catch (error) {
                console.error('[voiceMonitor] Erro crítico ao processar voiceStateUpdate:', error);
            }
        });

        console.log('[voiceMonitor] Sistema de monitoramento de suporte em call de voz inicializado e ativo.');
    };

    if (clientInstance.isReady()) {
        setupListener(clientInstance);
    } else {
        clientInstance.once('ready', () => setupListener(clientInstance));
    }
}