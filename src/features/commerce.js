import { EmbedBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { logAction } from '../services/audit.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// IDs dos Canais e Cargos Oficiais
const CANAL_COMPRAS_RECENTES_ID = '1571565979840942242';
const CANAL_AVALIACOES_ID = '1549410077608378418';
const CARGO_CLIENTE_ID = '1570539906927694055'; // Dura 15 dias

// Mapeamento de Produtos, Cargos e Valores
export const PRODUTOS_LOJA = {
    'produto_booster_7': {
        nome: 'Server Booster',
        valor: 7.00,
        cargoId: '1547208735267754175', // Dura 5 dias
        duracaoDias: 5
    },
    'produto_premium_12': {
        nome: 'Cargo Premium',
        valor: 12.00,
        cargoId: '1550129797852692591', // Dura 5 dias
        duracaoDias: 5
    },
    'produto_premium_booster_14': {
        nome: 'Cargo Premium Booster',
        valor: 14.00,
        cargoId: '1547235630017159179', // Dura 5 dias
        duracaoDias: 5
    }
};

export function criarVitrineLoja() {
    const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🛒 • NOSSOS CARGOS DE ACESSO • COMMUNITY FOR GOATS')
        .setDescription(
            'Desbloqueie seus recursos e aproveite ao máximo nossa comunidade!\n\n' +
            '🚀 **Server Booster** — R$ 7,00 *(Duração: 5 dias)*\n' +
            '👑 **Cargo Premium** — R$ 12,00 *(Duração: 5 dias)*\n' +
            '💎 **Cargo Premium Booster** — R$ 14,00 *(Duração: 5 dias)*\n\n' +
            '> *Ao adquirir qualquer produto, você ganha o cargo **・Cliente** automaticamente por 15 dias!*\n' +
            '> *Se tiver dúvidas, abra um ticket de suporte.*'
        );

    const files = [];
    const bannerPath = path.join(process.cwd(), 'assets', 'store', 'access-roles-banner.png');
    
    if (fs.existsSync(bannerPath)) {
        files.push(new AttachmentBuilder(bannerPath, { name: 'access-roles-banner.png' }));
        embed.setImage('attachment://access-roles-banner.png');
    }

    return {
        embeds: [embed],
        files: files,
        components: [
            {
                type: 1,
                components: [
                    {
                        type: 3, // StringSelectMenu
                        custom_id: 'comprar_produto_select',
                        placeholder: '🛒 Selecione um produto para comprar...',
                        options: [
                            {
                                label: 'Server Booster',
                                description: 'R$ 7,00 — Acesso por 5 dias',
                                value: 'produto_booster_7',
                                emoji: '🚀'
                            },
                            {
                                label: 'Cargo Premium',
                                description: 'R$ 12,00 — Acesso por 5 dias',
                                value: 'produto_premium_12',
                                emoji: '👑'
                            },
                            {
                                label: 'Cargo Premium Booster',
                                description: 'R$ 14,00 — Acesso por 5 dias',
                                value: 'produto_premium_booster_14',
                                emoji: '💎'
                            }
                        ]
                    }
                ]
            }
        ]
    };
}

export async function publicarVitrineLoja(channel) {
    if (!channel) return false;
    const vitrine = criarVitrineLoja();
    await channel.send(vitrine);
    return true;
}

/**
 * Conclui a compra automaticamente: entrega cargos, regista nos logs e envia nos canais.
 */
export async function processarAprovacaoPedido(client, guild, userId, produtoKey, pedidoId) {
    const produto = PRODUTOS_LOJA[produtoKey] || PRODUTOS_LOJA['produto_booster_7'];
    const member = await guild.members.fetch(userId).catch(() => null);

    if (!member) {
        console.error(`[commerce] Membro ${userId} não encontrado no servidor ao aprovar pedido.`);
        return false;
    }

    try {
        // 1. Atribuir o cargo do produto e o cargo Cliente
        await member.roles.add(produto.cargoId).catch(err => console.error('[commerce] Erro ao dar cargo principal:', err));
        await member.roles.add(CARGO_CLIENTE_ID).catch(err => console.error('[commerce] Erro ao dar cargo Cliente:', err));

        const dataAtualFormatada = new Intl.DateTimeFormat('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        }).format(new Date());

        // 2. Registar nos logs administrativos
        await logAction(guild, userId, 'Compra Aprovada', `Produto: ${produto.nome} - R$ ${produto.valor.toFixed(2)} (Pedido: ${pedidoId})`);

        // 3. Enviar mensagem no canal de compras recentes
        const canalRecentes = guild.channels.cache.get(CANAL_COMPRAS_RECENTES_ID) || await guild.channels.fetch(CANAL_COMPRAS_RECENTES_ID).catch(() => null);
        if (canalRecentes?.isTextBased()) {
            await canalRecentes.send({
                content: `🎉 Muito obrigado <@${userId}> por comprar na nossa loja! Você adquiriu com sucesso o **${produto.nome}**. Muito obrigado por apoiar nossa comunidade, venha garantir seus benefícios você também! 🚀`
            }).catch(() => {});
        }

        // 4. Enviar mensagem de avaliação no canal de feedbacks com barra vermelha e sem estrelas na descrição
        const canalAvaliacoes = guild.channels.cache.get(CANAL_AVALIACOES_ID) || await guild.channels.fetch(CANAL_AVALIACOES_ID).catch(() => null);
        if (canalAvaliacoes?.isTextBased()) {
            const embedAvaliacao = new EmbedBuilder()
                .setColor(0xFF0000) // Barra vermelha
                .setTitle('Avaliação da compra · ⭐⭐⭐⭐⭐ (5/5)')
                .setDescription('Compra aprovada automaticamente com sucesso!')
                .addFields(
                    { name: 'Produto', value: produto.nome, inline: true },
                    { name: 'Cliente', value: `<@${userId}>`, inline: true }
                )
                .setFooter({ text: `Pedido ${pedidoId} • ${dataAtualFormatada}` });

            await canalAvaliacoes.send({ embeds: [embedAvaliacao] }).catch(() => {});
        }

        // 5. Agendar remoção automática dos cargos após o período
        setTimeout(async () => {
            const m = await guild.members.fetch(userId).catch(() => null);
            if (m) {
                await m.roles.remove(produto.cargoId).catch(() => {});
                console.log(`[commerce] Cargo ${produto.nome} removido de @${m.user.tag} após ${produto.duracaoDias} dias.`);
            }
        }, produto.duracaoDias * 24 * 60 * 60 * 1000).unref?.();

        setTimeout(async () => {
            const m = await guild.members.fetch(userId).catch(() => null);
            if (m) {
                await m.roles.remove(CARGO_CLIENTE_ID).catch(() => {});
                console.log(`[commerce] Cargo Cliente removido de @${m.user.tag} após 15 dias.`);
            }
        }, 15 * 24 * 60 * 60 * 1000).unref?.();

        return true;
    } catch (error) {
        console.error('[commerce] Erro ao processar aprovação e entrega de cargos:', error);
        return false;
    }
}

/**
 * Monitora o pagamento diretamente na API do Mercado Pago a cada 5 segundos (até 15 minutos)
 */
function iniciarMonitoramentoAutomaticoPix(interaction, paymentId, accessToken, selectedValue, pedidoId, produto) {
    let tentativas = 0;
    const maxTentativas = 180; // 180 x 5s = 15 minutos de monitoramento

    const interval = setInterval(async () => {
        tentativas++;
        if (tentativas > maxTentativas) {
            clearInterval(interval);
            console.log(`[commerce] Tempo limite de verificação atingido para o pedido ${pedidoId}.`);
            return;
        }

        try {
            const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken.trim()}`
                }
            });

            if (!res.ok) return;
            const data = await res.json();

            if (data.status === 'approved') {
                clearInterval(interval);
                console.log(`[commerce] ✅ Pagamento ${paymentId} (Pedido: ${pedidoId}) APROVADO automaticamente!`);

                // Executa entrega de cargos, logs e mensagens nos canais
                await processarAprovacaoPedido(interaction.client, interaction.guild, interaction.user.id, selectedValue, pedidoId);

                // Atualiza a mensagem efêmera do usuário confirmando o pagamento
                await interaction.editReply({
                    content: [
                        `✅ **Pagamento Aprovado com Sucesso!**`,
                        `📦 **Produto:** ${produto.nome}`,
                        `🔑 **ID do Pedido:** \`${pedidoId}\``,
                        ``,
                        `🎉 O seu cargo **${produto.nome}** (5 dias) e o cargo **・Cliente** (15 dias) já foram entregues automaticamente!`
                    ].join('\n'),
                    files: [] // Remove o QR Code após pago
                }).catch(() => {});
            } else if (['cancelled', 'rejected', 'expired'].includes(data.status)) {
                clearInterval(interval);
                console.log(`[commerce] ❌ Pagamento ${paymentId} (Pedido: ${pedidoId}) foi ${data.status}.`);
            }
        } catch (err) {
            console.error(`[commerce] Erro ao consultar status do pagamento ${paymentId}:`, err.message);
        }
    }, 5000);

    interval.unref?.();
}

export async function tratarInteracaoCompras(interaction) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return false;

    const isSelect = interaction.isStringSelectMenu() && interaction.customId === 'comprar_produto_select';
    if (!isSelect) return false;

    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
    } catch (err) {
        console.error('[commerce] Erro ao adiar interação (pode ter expirado):', err);
        return true;
    }

    try {
        const selectedValue = interaction.values?.[0] || 'produto_booster_7';
        const produto = PRODUTOS_LOJA[selectedValue] || PRODUTOS_LOJA['produto_booster_7'];

        const pedidoId = crypto.randomBytes(4).toString('hex').toUpperCase();
        const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

        if (!accessToken || accessToken.trim() === '') {
            await interaction.editReply({
                content: '❌ O token do Mercado Pago (`MERCADO_PAGO_ACCESS_TOKEN`) não está configurado no ficheiro `.env`.'
            });
            return true;
        }

        console.log(`[commerce] A gerar Pix no Mercado Pago para ${produto.nome} (R$ ${produto.valor.toFixed(2)})...`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        let response;
        try {
            response = await fetch('https://api.mercadopago.com/v1/payments', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken.trim()}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': pedidoId
                },
                body: JSON.stringify({
                    transaction_amount: produto.valor,
                    description: `Community For Goats - ${produto.nome}`,
                    payment_method_id: 'pix',
                    payer: {
                        email: `${interaction.user.id}@discord.com`,
                        first_name: interaction.user.username || 'Cliente'
                    },
                    external_reference: pedidoId
                }),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }

        const paymentData = await response.json();

        if (!response.ok || !paymentData.point_of_interaction) {
            const erroMsg = paymentData.message || paymentData.cause?.[0]?.description || 'Falha ao comunicar com a API do Mercado Pago.';
            await interaction.editReply({
                content: `❌ **Erro ao gerar pagamento no Mercado Pago:**\n\`\`\`${erroMsg}\`\`\``
            });
            return true;
        }

        const paymentId = paymentData.id;
        const qrCodeText = paymentData.point_of_interaction.transaction_data.qr_code;
        const qrCodeBase64 = paymentData.point_of_interaction.transaction_data.qr_code_base64;

        const files = [];
        if (qrCodeBase64) {
            const buffer = Buffer.from(qrCodeBase64, 'base64');
            files.push(new AttachmentBuilder(buffer, { name: 'qrcode-pix.png' }));
        }

        console.log(`[commerce] Pix gerado com sucesso para @${interaction.user.tag} — Pedido: ${pedidoId} (MP ID: ${paymentId})`);
        await logAction(interaction.guild, interaction.user.id, 'Compra Pix Iniciada', `${produto.nome} - R$ ${produto.valor.toFixed(2)} (Pedido: ${pedidoId})`);

        await interaction.editReply({
            content: [
                `🛒 **Carrinho / Checkout • Pedido Criado!**`,
                `📦 **Produto:** ${produto.nome}`,
                `💰 **Valor:** R$ ${produto.valor.toFixed(2).replace('.', ',')}`,
                `⏱️ **Duração do Cargo:** ${produto.duracaoDias} dias`,
                `⭐ **Bônus:** Cargo **・Cliente** por 15 dias`,
                `🔑 **ID do Pedido:** \`${pedidoId}\``,
                ``,
                `📱 **Escaneie o QR Code abaixo ou utilize o Pix Copia e Cola:**`,
                `\`\`\``,
                qrCodeText,
                `\`\`\``,
                `⏳ *Aguardando confirmação do pagamento... Assim que você pagar, o cargo será entregue automaticamente na hora!*`
            ].join('\n'),
            files: files
        });

        // Inicia a verificação automática a cada 5 segundos
        iniciarMonitoramentoAutomaticoPix(interaction, paymentId, accessToken, selectedValue, pedidoId, produto);

    } catch (error) {
        console.error('[commerce] Erro crítico ao processar compra:', error);
        const mensagemErro = error.name === 'AbortError'
            ? '⚠️ A conexão com o Mercado Pago demorou demais (`Connect Timeout`). Verifique sua rede/firewall e tente novamente.'
            : `❌ Ocorreu um erro interno ao processar o pagamento: \`${error.message}\``;

        await interaction.editReply({ content: mensagemErro }).catch(() => {});
    }

    return true;
}