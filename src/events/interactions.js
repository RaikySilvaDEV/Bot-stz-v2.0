import { Events } from 'discord.js';
import { tratarComandoIa, tratarBotoesIa, tratarComandoIaTeste } from '../features/ticketAiManager.js';
import { tratarInteracaoTickets } from '../features/tickets.js';

export function registrarEventosInteracao(client) {
    client.on(Events.InteractionCreate, async interaction => {
        try {
            // 1. Trata o comando /ia e botões do painel de gestão da IA
            if (await tratarComandoIa(interaction)) return;
            if (await tratarBotoesIa(interaction)) return;

            // 2. Trata o novo comando /iateste para testar perguntas diretamente com o Ollama
            if (await tratarComandoIaTeste(interaction)) return;

            // 3. Trata os tickets (menus e botões de fechar)
            if (await tratarInteracaoTickets(interaction)) return;

            // Outras interações do bot podem ser adicionadas aqui se necessário...
        } catch (error) {
            console.error('[interactions] Erro ao processar interação:', error);
            if (interaction.isRepliable() && !interaction.deferred && !interaction.replied) {
                await interaction.reply({ content: '❌ Ocorreu um erro ao processar esta interação.', ephemeral: true }).catch(() => {});
            }
        }
    });
}