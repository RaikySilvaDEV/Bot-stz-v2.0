import { EmbedBuilder } from 'discord.js';

const CANAL_VENDAS_ID = '1547670845751697618';
const CANAL_CARGOS_ID = '1547803887510093954';

/**
 * Envia o registo detalhado de uma venda concluída.
 */
export async function registrarVenda(guild, data) {
    try {
        const channel = await guild.channels.fetch(CANAL_VENDAS_ID).catch(() => null);
        if (!channel?.isTextBased()) return;

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('📦 Registro de Venda')
            .addFields(
                { name: '👤 Cliente', value: `${data.clientName}\n\`${data.clientTag}\``, inline: false },
                { name: '🛍️ Produto', value: data.productName, inline: true },
                { name: '🏷️ Cargos liberados', value: data.rolesGiven, inline: true },
                { name: '💰 Valor bruto', value: data.grossAmount ?? 'R$ 0,10', inline: true },
                { name: '📊 Taxa Mercado Pago', value: data.mpFee ?? 'Indisponível', inline: true },
                { name: '📥 Líquido recebido', value: data.netAmount ?? 'Indisponível', inline: true },
                { name: '🕒 Compra em', value: data.purchasedAt, inline: true },
                { name: '⏳ Cargo expira em', value: data.expiresAt ?? 'Permanente', inline: true },
                { name: '✅ Status', value: data.status ?? 'Pago e entregue', inline: false },
                { name: '🆔 Pedido', value: `\`${data.orderId}\``, inline: false }
            )
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('[shopLogs] Falha ao enviar registo de venda:', error);
    }
}

/**
 * Envia o registo detalhado da remoção de um cargo expirado.
 */
export async function registrarRemocaoCargo(guild, data) {
    try {
        const channel = await guild.channels.fetch(CANAL_CARGOS_ID).catch(() => null);
        if (!channel?.isTextBased()) return;

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('🛡️ Registro de Remoção de Cargo')
            .addFields(
                { name: '👤 Cliente', value: `${data.clientName}\n\`${data.clientTag}\``, inline: false },
                { name: '🏷️ Cargo', value: data.roleName, inline: true },
                { name: '⚙️ Status da Remoção', value: data.removalStatus ?? 'Sucesso', inline: true },
                { name: '🆔 Pedido', value: `\`${data.orderId}\``, inline: false },
                { name: '🕒 Compra em', value: data.purchasedAt, inline: true },
                { name: '⏳ Cargo expira em', value: data.expiresAt, inline: true }
            )
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('[shopLogs] Falha ao enviar registo de remoção de cargo:', error);
    }
}