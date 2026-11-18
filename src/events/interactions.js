import { Events } from 'discord.js';
import { tratarComandoIa, tratarBotoesIa } from '../features/ia.js';
import { tratarInteracaoTickets } from '../features/tickets.js';
import { tratarInteracaoCompras } from '../features/commerce.js';
import crypto from 'crypto';

export function registrarEventosInteracao(client) {
    client.on(Events.InteractionCreate, async interaction => {
        try {
            // 1. Trata o comando /ia e botões do painel de gestão da IA
            if (await tratarComandoIa(interaction)) return;
            if (await tratarBotoesIa(interaction)) return;

            // 2. Trata os tickets (menus e botões de fechar)
            if (await tratarInteracaoTickets(interaction)) return;

            // 3. Trata as compras e o menu de seleção da vitrine da loja
            if (await tratarInteracaoCompras(interaction)) return;

            // 4. Trata o Menu Suspenso interativo do Painel de Tokens
            if (interaction.isStringSelectMenu() && interaction.customId === 'menu_gerir_tokens') {
                const valor = interaction.values[0];

                if (valor === 'acao_gerar_token') {
                    // Gera token aleatório de 30 dias (tamanho único entre 8 a 12 caracteres)
                    const randomBytesLength = Math.floor(Math.random() * 3) + 4; // 4 a 6 bytes -> 8 a 12 caracteres hex
                    const uniqueToken = 'GOATS-' + crypto.randomBytes(randomBytesLength).toString('hex').toUpperCase().slice(0, 10);
                    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 dias

                    global.tokensDB = global.tokensDB || new Map();
                    global.tokensDB.set(uniqueToken, {
                        type: 'normal',
                        expiresAt: expiresAt,
                        discordId: interaction.user.id,
                        hwid: null
                    });

                    return interaction.reply({ 
                        content: `✅ Token de 30 dias gerado com sucesso via painel para <@${interaction.user.id}>:\n\`\`\`${uniqueToken}\`\`\``, 
                        ephemeral: true 
                    });
                }
                
                if (valor === 'acao_teste_token') {
                    // Gera token de teste de 3 minutos
                    const uniqueToken = 'TEST-' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 8);
                    const expiresAt = Date.now() + (3 * 60 * 1000); // 3 minutos

                    global.tokensDB = global.tokensDB || new Map();
                    global.tokensDB.set(uniqueToken, {
                        type: 'test',
                        expiresAt: expiresAt,
                        discordId: interaction.user.id,
                        hwid: null
                    });

                    return interaction.reply({ 
                        content: `⏱️ Token de teste (3 min) gerado via painel para <@${interaction.user.id}>:\n\`\`\`${uniqueToken}\`\`\``, 
                        ephemeral: true 
                    });
                }

                if (valor === 'acao_reset_token') {
                    return interaction.reply({ 
                        content: `🔄 Para resetar um token, utilize diretamente o comando de barra \`/resettoken <token>\` informando o código exato que deseja liberar.`, 
                        ephemeral: true 
                    });
                }
            }

            // 5. Executa comandos de barra registados no client.commands
            if (interaction.isChatInputCommand() && client.commands?.has(interaction.commandName)) {
                const command = client.commands.get(interaction.commandName);
                await command.execute(interaction);
                return;
            }
        } catch (error) {
            console.error('[interactions] Erro ao processar interação:', error);
            if (interaction.isRepliable() && !interaction.deferred && !interaction.replied) {
                await interaction.reply({ 
                    content: '❌ Ocorreu um erro ao processar esta interação.', 
                    ephemeral: true 
                }).catch(() => {});
            }
        }
    });
}