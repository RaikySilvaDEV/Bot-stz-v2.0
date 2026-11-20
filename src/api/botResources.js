import { client } from '../client.js';
import { GUILD_ID } from '../config/constants.js';
import { getSettings } from '../repositories/settingsRepository.js';
import { getPartners } from '../repositories/partnershipRepository.js';
import { getAuditEntries } from '../repositories/auditRepository.js';
import { getSlashCommands } from '../commands/definitions.js';
import { registrarComandos } from '../commands/deploy.js';
import { savePartnership, deletePartnership } from '../features/partnerships.js';
import { listarAnunciosFiveM, criarAnuncioFiveM, atualizarAnuncioFiveM, removerAnuncioFiveM } from '../features/fivemAnnouncements.js';
import { publicarPainelTickets } from '../features/tickets.js';
import { archiveAndCloseTicket } from '../services/ticketClosure.js';
import { createBackupSnapshot } from '../features/administration.js';
import { getAnnouncementTemplates, updateAnnouncementTemplate, publishAutomationMessage, disableAutomationMessage } from '../features/automation.js';

function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
    return true;
}

function isTicket(channel) {
    return channel?.type === 0 && (channel.topic?.startsWith('ticket-owner:') ||
        channel.parentId === getSettings().channels.supportCategory && /ticket|carrinho|duvidas|suporte|parcerias/.test(channel.name));
}

// Chamado somente depois da autenticação e da verificação de origem do painel.
export async function handleBotResourcesRoute(req, res, url, readJson) {
    const path = url.pathname;
    const guild = client.guilds.cache.get(GUILD_ID);
    if (path === '/api/painel/messages' && req.method === 'GET') return send(res, 200, { items: getAnnouncementTemplates() });
    const template = path.match(/^\/api\/painel\/messages\/([a-z]+)(\/publish)?$/);
    if (template && ['PUT', 'DELETE', 'POST'].includes(req.method)) {
        if (req.method === 'PUT' && !template[2]) updateAnnouncementTemplate(template[1], await readJson(req));
        else if (req.method === 'DELETE' && !template[2]) {
            if (!await disableAutomationMessage(template[1])) return send(res, 404, { erro: 'Aviso não encontrado.' });
        } else if (req.method === 'POST' && template[2]) {
            if (!await publishAutomationMessage(template[1])) return send(res, 400, { erro: 'Ative o aviso antes de publicar.' });
        } else return send(res, 405, { erro: 'Método não permitido.' });
        return send(res, 200, { items: getAnnouncementTemplates() });
    }
    if (path === '/api/painel/partners' && req.method === 'GET') return send(res, 200, { items: getPartners() });
    const partner = path.match(/^\/api\/painel\/partners(?:\/([^/]+))?$/);
    if (partner && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
        if (!guild) throw Object.assign(new Error('Servidor Discord indisponível.'), { status: 503 });
        const id = partner[1] ? decodeURIComponent(partner[1]) : null;
        if (req.method === 'DELETE' && id) {
            if (!await deletePartnership(guild, id)) return send(res, 404, { erro: 'Parceria não encontrada.' });
        } else if (req.method === 'POST' && !id || req.method === 'PUT' && id) {
            await savePartnership(guild, await readJson(req), id);
        } else return send(res, 405, { erro: 'Método não permitido.' });
        return send(res, 200, { items: getPartners() });
    }
    if (path === '/api/painel/announcements' && req.method === 'GET') return send(res, 200, { items: listarAnunciosFiveM() });
    const announcement = path.match(/^\/api\/painel\/announcements(?:\/([^/]+))?$/);
    if (announcement && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
        const id = announcement[1] ? decodeURIComponent(announcement[1]) : null;
        if (req.method === 'POST' && !id) await criarAnuncioFiveM(await readJson(req));
        else if (req.method === 'PUT' && id) {
            if (!await atualizarAnuncioFiveM(id, await readJson(req))) return send(res, 404, { erro: 'Anúncio não encontrado.' });
        } else if (req.method === 'DELETE' && id) {
            if (!await removerAnuncioFiveM(id)) return send(res, 404, { erro: 'Anúncio não encontrado.' });
        } else return send(res, 405, { erro: 'Método não permitido.' });
        return send(res, 200, { items: listarAnunciosFiveM() });
    }
    if (path === '/api/painel/tickets' && req.method === 'GET') {
        if (!guild) return send(res, 503, { erro: 'Servidor Discord indisponível.' });
        return send(res, 200, { items: [...guild.channels.cache.values()].filter(isTicket).map(channel => ({
            id: channel.id, name: channel.name, ownerId: channel.topic?.match(/^ticket-owner:(\d+)/)?.[1] ?? null
        })) });
    }
    if (path === '/api/painel/tickets/panel' && req.method === 'POST') {
        const channel = await guild?.channels.fetch(getSettings().channels.ticketPanel);
        if (!channel?.isTextBased()) return send(res, 400, { erro: 'Configure o canal do painel de tickets.' });
        await publicarPainelTickets(channel);
        return send(res, 200, { ok: true });
    }
    const ticket = path.match(/^\/api\/painel\/tickets\/([^/]+)$/);
    if (ticket && req.method === 'DELETE') {
        const channel = await guild?.channels.fetch(decodeURIComponent(ticket[1])).catch(() => null);
        if (!isTicket(channel)) return send(res, 404, { erro: 'Ticket não encontrado.' });
        await archiveAndCloseTicket(guild, channel, client.user.id, 'Ticket fechado pelo painel administrativo');
        return send(res, 200, { ok: true });
    }
    if (path === '/api/painel/commands' && req.method === 'GET') return send(res, 200, { items: getSlashCommands(client.commands?.values() ?? []) });
    if (path === '/api/painel/commands/sync' && req.method === 'POST') {
        await registrarComandos();
        return send(res, 200, { ok: true });
    }
    if (path === '/api/painel/audit' && req.method === 'GET') return send(res, 200, { items: getAuditEntries(100) });
    if (path === '/api/painel/backup' && req.method === 'GET') return send(res, 200, createBackupSnapshot());
    return false;
}
