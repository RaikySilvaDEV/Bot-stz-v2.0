import 'dotenv/config';
import { Events, Collection } from 'discord.js';
import { client } from './client.js';
import { TOKEN, GUILD_ID } from './config/constants.js';
import { validateEnvironment } from './config/validateEnv.js';
import { iniciarVerificadorCargosTemporarios } from './services/tempRoles.js';
import { configurarAvisoPagamentos, iniciarDivulgacaoAutomaticaVendas } from './features/automation.js';
import { publicarPainelTickets } from './features/tickets.js';
import { processarMensagemTicketOllama } from './features/ia.js';
import { registrarEventosInteracao } from './events/interactions.js';
import fs from 'node:fs';
import path from 'node:path';
import './features/community.js';
import './events/ready.js';
import { iniciarMonitoramentoVoice } from './features/voiceMonitor.js';

iniciarMonitoramentoVoice(client);
validateEnvironment();

// 📂 Carregamento dinâmico dos comandos de barra (como o /set)
client.commands = new Collection();
const commandsPath = path.join(process.cwd(), 'src', 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js') && file !== 'deploy.js' && file !== 'definitions.js');
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        import(`file://${filePath}`).then(module => {
            const command = module.default;
            if (command?.data?.name) {
                client.commands.set(command.data.name, command);
            }
        }).catch(err => console.error(`[comandos] Erro ao carregar ${file}:`, err));
    }
}

// 🕹️ REGISTRO OBRIGATÓRIO: Ativa os comandos de barra (/set, /ia, etc.) e botões
registrarEventosInteracao(client);

// 🤖 Registo do evento de mensagens para a IA atender nos tickets
client.on(Events.MessageCreate, async message => {
    await processarMensagemTicketOllama(message);
});

client.once(Events.ClientReady, async () => {
    iniciarVerificadorCargosTemporarios(client);
    
    try {
        configurarAvisoPagamentos();
    } catch (err) {
        console.error('[pagamentos] Erro ao configurar aviso:', err);
    }

    // 1. Publicar o painel de tickets automaticamente no canal especificado
    const canalTicketsId = '1547234961528979476';
    try {
        const canal = await client.channels.fetch(canalTicketsId).catch(() => null);
        if (canal && canal.isTextBased()) {
            await publicarPainelTickets(canal);
            console.log('[tickets] Painel de tickets publicado com sucesso no canal!');
        } else {
            console.error('[tickets] Não foi possível encontrar o canal de tickets ou ele não é de texto.');
        }
    } catch (error) {
        console.error('[tickets] Erro ao publicar o painel no arranque:', error);
    }

    // 2. Iniciar a divulgação automática de vendas (a cada 45 minutos)
    try {
        const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (guild) {
            iniciarDivulgacaoAutomaticaVendas(guild);
        } else {
            console.error('[divulgacao] Servidor (Guild) não encontrado para iniciar a divulgação automática.');
        }
    } catch (error) {
        console.error('[divulgacao] Erro ao iniciar o agendador de vendas:', error);
    }
});

client.login(TOKEN).catch(error => {
    console.error('[startup] Não foi possível conectar ao Discord:', error.message);
    process.exitCode = 1;
});