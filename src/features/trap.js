import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { client } from '../client.js';
import { GUILD_ID } from '../config/constants.js';
import { logAction } from '../services/audit.js';

const CANAL_ARMADILHA_ID = '1546921143158571059';

/**
 * Limpa mensagens antigas do bot no canal e envia o aviso oficial da armadilha
 */
export async function configurarCanalArmadilha() {
    try {
        const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (!guild) return;

        const canal = await guild.channels.fetch(CANAL_ARMADILHA_ID).catch(() => null);
        if (!canal || !canal.isTextBased()) {
            console.error('[armadilha] Canal não encontrado ou não é de texto:', CANAL_ARMADILHA_ID);
            return;
        }

        // Remove mensagens antigas do bot para não duplicar ao reiniciar
        const mensagens = await canal.messages.fetch({ limit: 50 }).catch(() => null);
        if (mensagens) {
            for (const msg of mensagens.values()) {
                if (msg.author.id === client.user.id) {
                    await msg.delete().catch(() => {});
                }
            }
        }

        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('⚠️ • CANAL ARMADILHA ANTI-SPAM — NÃO ENVIE MENSAGENS AQUI!')
            .setDescription(
                'Este canal serve exclusivamente como **armadilha de segurança** para capturar bots maliciosos, contas hackeadas e divulgadores automáticos (selfbots).\n\n' +
                '🚫 **ATENÇÃO MEMBROS:**\n' +
                '• **NÃO** envie nenhuma mensagem, figurinha, emoji ou anexo neste canal.\n' +
                '• Qualquer conta que enviar mensagem aqui será **banida ou silenciada imediatamente** pelo sistema de proteção automática.\n\n' +
                '> *Se você é um usuário normal, apenas ignore este canal.*'
            );

        await canal.send({ embeds: [embed] });
        console.log('[armadilha] Mensagem de aviso enviada com sucesso no canal', CANAL_ARMADILHA_ID);
    } catch (error) {
        console.error('[armadilha] Erro ao configurar canal armadilha:', error);
    }
}

/**
 * Monitora mensagens enviadas no canal armadilha e aplica a punição automática
 */
export function iniciarSistemaArmadilha() {
    client.on('messageCreate', async message => {
        try {
            if (!message.guild || message.author.bot) return;
            if (message.channel.id !== CANAL_ARMADILHA_ID) return;

            const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
            
            // Ignora administradores para evitar auto-punição em testes
            if (member && member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return;
            }

            // Apaga a mensagem enviada na armadilha
            await message.delete().catch(() => {});

            if (member) {
                if (member.bannable) {
                    await member.ban({
                        deleteMessageSeconds: 86400, // Apaga mensagens das últimas 24h
                        reason: 'Caiu no canal armadilha anti-spam (1546921143158571059)'
                    });
                    await logAction(
                        message.guild,
                        client.user.id,
                        'Armadilha Acionada (Banimento)',
                        `O usuário ${message.author.tag} (${message.author.id}) foi banido automaticamente por enviar mensagem no canal armadilha.`
                    );
                } else if (member.moderatable) {
                    await member.timeout(24 * 60 * 60 * 1000, 'Caiu no canal armadilha anti-spam');
                    await logAction(
                        message.guild,
                        client.user.id,
                        'Armadilha Acionada (Castigo)',
                        `O usuário ${message.author.tag} (${message.author.id}) foi silenciado por 24h por enviar mensagem no canal armadilha.`
                    );
                }
            }
        } catch (error) {
            console.error('[armadilha] Erro ao processar mensagem no canal armadilha:', error);
        }
    });

    console.log('[armadilha] Monitoramento ativo no canal', CANAL_ARMADILHA_ID);
}