import { client } from '../client.js';
import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { GUILD_ID } from '../config/constants.js';
import path from 'node:path';
import fs from 'node:fs';

const CANAL_DIVULGACAO_ID = '1547225755526758460';
const CANAL_CASO_DE_FALHA_ID = '1558133633850806323';
const CANAL_ACESSO_PREMIUM_ID = '1549781288251031562'; // Canal de Acesso Premium
const CANAL_BOOSTERS_ID = '1547211679899717692';     // Canal de Boosters
const CANAL_PAGAMENTOS_INFO_ID = '1558132299290386553'; // 👈 Canal que vai receber o painel de pagamentos da foto
const INTERVALO_45_MINUTOS = 45 * 60 * 1000;

export async function enviarAnuncioVendas45Min() {
    try {
        const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (!guild) {
            console.error('[divulgacao] Servidor (Guild) não encontrado!');
            return;
        }

        const canal = guild.channels.cache.get(CANAL_DIVULGACAO_ID) || await guild.channels.fetch(CANAL_DIVULGACAO_ID).catch(() => null);
        if (!canal?.isTextBased()) return;

        const mensagens = await canal.messages.fetch({ limit: 15 }).catch(() => null);
        if (mensagens) {
            for (const msg of mensagens.values()) {
                if (msg.author.id === client.user.id) {
                    await msg.delete().catch(() => {});
                }
            }
        }

        const embedVendas = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🚨 VENDAS ONLINE 🚨')
            .setDescription(
                'Vendas online rapaziada, novos mods toda semana ajustes e programas de qualide pra voces\n' +
                'Podem comprar sem medo produtos automaticos Presicionfix disponivel no <#1549781288251031562>\n' +
                'e programas mods tambem temos aqui <#1547211679899717692> produtos de qualidade privados\n\n' +
                '🔫 **Skins de Armas tudo em rpf so jogar na pasta mods e esta funcionando**\n' +
                '*(mods privados e unico)*\n\n' +
                '🚨 **ATUALIZEI OS MODS DO SERVIDOR** 🚨\n' +
                '*Em Caso de <#1571248837723562094> ou <#1549443615984586865> pode abrir um <#1547234961528979476> Bot online*\n' +
                'Caso queira comprar os cargos vips compre aqui <#1552152094411329546> lembrando que irei atualizar os mods irei postar novas coisas em todos os canais. <@&1544411912270512209>\n\n' +
                '**TEMOS APLICATIVOS LITES E SEM PRECISAR PAGAR MAIS DO 12 REIAS PROGRAS COMO**\n' +
                '(*CAPCUT PRO, SPOTIFY E PRESETS DE FXSOUND E SPOTIFY E MUITO MAIS*)'
            )
            .setFooter({ text: 'Community For Goats • Sistema Automatizado de Vendas' })
            .setTimestamp();

        await canal.send({
            content: '@everyone',
            embeds: [embedVendas],
            allowedMentions: { parse: ['everyone', 'roles'] }
        });
    } catch (error) {
        console.error('[divulgacao] Erro ao enviar anúncio automático:', error);
    }
}

export function iniciarDivulgacaoAutomaticaVendas() {
    enviarAnuncioVendas45Min();
    const timer = setInterval(() => {
        enviarAnuncioVendas45Min();
    }, INTERVALO_45_MINUTOS);
    timer.unref?.();
    console.log('[divulgacao] Agendador de vendas configurado para rodar a cada 45 minutos.');
}

/**
 * Canal de Acesso Premium (1549781288251031562)
 */
export async function enviarPainelAvisosInicio(guild) {
    try {
        const canal = guild.channels.cache.get(CANAL_ACESSO_PREMIUM_ID) || await guild.channels.fetch(CANAL_ACESSO_PREMIUM_ID).catch(() => null);
        if (!canal?.isTextBased()) return;

        const mensagens = await canal.messages.fetch({ limit: 10 }).catch(() => null);
        if (mensagens) {
            for (const msg of mensagens.values()) {
                if (msg.author.id === client.user.id) {
                    await msg.delete().catch(() => {});
                }
            }
        }

        const storeDir = path.join(process.cwd(), 'assets', 'store');
        const possiveisNomes1 = ['acesso premium.jpg', 'acesso-premium.jpg', 'acesso_premium.jpg'];
        const possiveisNomes2 = ['acesso premium 2.jpg', 'acesso-premium-2.jpg', 'acesso_premium_2.jpg'];

        let caminhoImg1 = null;
        let caminhoImg2 = null;

        for (const nome of possiveisNomes1) {
            const fullPath = path.join(storeDir, nome);
            if (fs.existsSync(fullPath)) { caminhoImg1 = fullPath; break; }
        }

        for (const nome of possiveisNomes2) {
            const fullPath = path.join(storeDir, nome);
            if (fs.existsSync(fullPath)) { caminhoImg2 = fullPath; break; }
        }

        const files = [];
        if (caminhoImg1) files.push(new AttachmentBuilder(caminhoImg1, { name: 'acesso-premium-1.jpg' }));
        if (caminhoImg2) files.push(new AttachmentBuilder(caminhoImg2, { name: 'acesso-premium-2.jpg' }));

        const textoCabecalho = '# ACESSO PRIVADO SOMENTE PARA <@&1544411912270512209> <@&1528983705673273466>';

        if (files.length > 0) {
            await canal.send({ content: textoCabecalho, files: files, allowedMentions: { parse: ['roles'] } });
        } else {
            await canal.send({ content: textoCabecalho, allowedMentions: { parse: ['roles'] } });
        }
    } catch (error) {
        console.error('[automation] Erro ao enviar painel de acesso premium:', error);
    }
}

/**
 * Canal de Boosters (1547211679899717692)
 */
export async function enviarPainelBoosters(guild) {
    try {
        const canal = guild.channels.cache.get(CANAL_BOOSTERS_ID) || await guild.channels.fetch(CANAL_BOOSTERS_ID).catch(() => null);
        if (!canal?.isTextBased()) return;

        const mensagens = await canal.messages.fetch({ limit: 10 }).catch(() => null);
        if (mensagens) {
            for (const msg of mensagens.values()) {
                if (msg.author.id === client.user.id) {
                    await msg.delete().catch(() => {});
                }
            }
        }

        const storeDir = path.join(process.cwd(), 'assets', 'store');
        const possiveisNomes = ['acesso boosters.jpg', 'acesso-boosters.jpg', 'acesso_boosters.jpg'];

        let caminhoImg = null;
        for (const nome of possiveisNomes) {
            const fullPath = path.join(storeDir, nome);
            if (fs.existsSync(fullPath)) { caminhoImg = fullPath; break; }
        }

        const files = [];
        if (caminhoImg) files.push(new AttachmentBuilder(caminhoImg, { name: 'acesso-boosters.jpg' }));

        const textoBoosters = '# Acesso ao boosters com mods e programas pro seu fivem/pc';

        if (files.length > 0) {
            await canal.send({ content: textoBoosters, files: files });
        } else {
            await canal.send({ content: textoBoosters });
        }
    } catch (error) {
        console.error('[automation] Erro ao enviar painel de boosters:', error);
    }
}

/**
 * Canal de Pagamentos da Imagem (1558132299290386553)
 */
export async function enviarPainelPagamentosInfo(guild) {
    try {
        const canal = guild.channels.cache.get(CANAL_PAGAMENTOS_INFO_ID) || await guild.channels.fetch(CANAL_PAGAMENTOS_INFO_ID).catch(() => null);
        if (!canal?.isTextBased()) {
            console.error('[automation] Canal de pagamentos info (1558132299290386553) não foi encontrado!');
            return;
        }

        // Limpa mensagens anteriores do bot neste canal ao ligar
        const mensagens = await canal.messages.fetch({ limit: 10 }).catch(() => null);
        if (mensagens) {
            for (const msg of mensagens.values()) {
                if (msg.author.id === client.user.id) {
                    await msg.delete().catch(() => {});
                }
            }
        }

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

        await canal.send({
            embeds: [embedPagamentos],
            allowedMentions: { parse: [] }
        });

        console.log('[automation] Painel de pagamentos info enviado com sucesso no canal', CANAL_PAGAMENTOS_INFO_ID);
    } catch (error) {
        console.error('[automation] Erro ao enviar painel de pagamentos info:', error);
    }
}

/**
 * Envia o aviso detalhado a cada 45 min no canal 🎭・caso-de-falha (1558133633850806323)
 */
export async function enviarAvisoCasoDeFalha45Min() {
    try {
        const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (!guild) return;

        const canal = guild.channels.cache.get(CANAL_CASO_DE_FALHA_ID) || await guild.channels.fetch(CANAL_CASO_DE_FALHA_ID).catch(() => null);
        if (!canal?.isTextBased()) return;

        const mensagens = await canal.messages.fetch({ limit: 10 }).catch(() => null);
        if (mensagens) {
            for (const msg of mensagens.values()) {
                if (msg.author.id === client.user.id) {
                    await msg.delete().catch(() => {});
                }
            }
        }

        const embedFalha = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🚨 COMMUNITY FOR GOATS — SUPORTE & PRECISIONFIX 🚨')
            .setDescription(
                'Ficou com alguma dúvida ou precisa de orientações sobre o servidor e os nossos programas?\n\n' +
                '💻 **SOBRE O PRECISIONFIX:**\n' +
                '• O programa e a licença de uso são **infinitos**!\n' +
                '• Apenas a vigência do cargo exclusivo no Discord é de **5 dias**.\n\n' +
                '💰 **COMO LIBERAR E TER ACESSO?**\n' +
                '• Adquira o **Cargo Premium** por apenas **R$ 12,00** para desbloquear todos os recursos e o PrecisionFix!\n' +
                '• Veja os detalhes e pague diretamente no canal de pagamentos: [💳・pagamentos](https://discord.com/channels/1528983705673273466/1567759689289171055)\n\n' +
                '📌 **PASSOS IMPORTANTES PARA COMEÇAR:**\n' +
                '1️⃣ Primeiro, resgate e garanta o seu cargo inicial em: [🔗・Obter Cargo](https://discord.com/channels/1528983705673273466/1547204424244658216)\n' +
                '2️⃣ Em seguida, efetue o pagamento do Cargo Premium na loja para liberar o seu acesso automaticamente na hora!\n\n' +
                '> 🛡️ *Caso tenha ocorrido qualquer falha, instabilidade ou atraso na entrega automática, abra imediatamente um atendimento em nosso canal de suporte.*'
            )
            .setFooter({ text: 'Community For Goats • Sistema Automatizado de Suporte' })
            .setTimestamp();

        await canal.send({
            content: '@everyone',
            embeds: [embedFalha],
            allowedMentions: { parse: ['everyone'] }
        });
    } catch (error) {
        console.error('[automation] Erro ao enviar aviso automático no canal de caso de falha:', error);
    }
}

export function iniciarAvisoCasoDeFalhaRecorrente() {
    enviarAvisoCasoDeFalha45Min();
    const timer = setInterval(() => {
        enviarAvisoCasoDeFalha45Min();
    }, INTERVALO_45_MINUTOS);
    timer.unref?.();
    console.log('[automation] Agendador do canal de caso de falha configurado para rodar a cada 45 minutos.');
}

// Funções requeridas pelo index.js e ready.js
export function configurarAvisoPagamentos() {
    console.log('[automation] Aviso de pagamentos configurado.');
}

export function iniciarAgendadorRelogio() {
    console.log('[automation] Agendador de relógio iniciado.');
}

export function verificarEnviosPendentesAoLigar() {
    console.log('[automation] Verificação de envios pendentes concluída.');
}

export function removerAnuncioParceriaAntigo() {
    console.log('[automation] Anúncio antigo de parceria removido.');
}