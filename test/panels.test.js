import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Collection, REST } from 'discord.js';
import { mockMemoryStore } from './helpers/memoryStore.js';

test('the bot and Sync panels share their corresponding persistent services', async t => {
    const memory = mockMemoryStore(t);
    process.env.API_KEY = 'panel-fixture-secret';
    process.env.API_PORT = '35631';
    process.env.API_HOST = '127.0.0.1';
    process.env.DASHBOARD_PASSWORD = 'panel-fixture-secret';
    process.env.FORGOATS_WEB_PASSWORD = 'sync-fixture-secret';
    const { client } = await import('../src/client.js');
    const { GUILD_ID } = await import('../src/config/constants.js');
    const { iniciarApiAnunciosFiveM } = await import('../src/api/server.js');
    const { carregarComandos } = await import('../src/commands/registry.js');
    const { getSlashCommands } = await import('../src/commands/definitions.js');
    memory.seed('bot-config.json', { channels: { audit: null, partnerships: 'partners', fivemAnnouncements: 'announcements', supportCategory: 'category', ticketPanel: 'panel' } });
    memory.seed('tokens.json', {});
    client.user = { id: 'bot', tag: 'fixture' };
    client.application = { id: 'application' };
    client.commands = await carregarComandos();
    t.mock.method(REST.prototype, 'put', async () => []);
    const cache = new Collection();
    let nextMessage = 0;
    function channel(id, name, type = 0, topic = null) {
        const messages = new Collection();
        const value = {
            id, name, type, topic, parentId: topic ? 'category' : null,
            isTextBased: () => type === 0,
            permissionsFor: () => ({ has: () => true }),
            messages: { fetch: async argument => typeof argument === 'object' ? messages : messages.get(argument) ?? null },
            send: async payload => {
                const message = { id: String(++nextMessage), author: client.user, components: [],
                    edit: async () => message, delete: async () => { messages.delete(message.id); } };
                messages.set(message.id, message);
                return message;
            },
            delete: async () => { cache.delete(id); }
        };
        cache.set(id, value);
        return value;
    }
    channel('partners', 'parcerias');
    channel('announcements', 'anuncios');
    channel('panel', 'abrir-ticket');
    channel('category', 'atendimento', 4);
    channel('ticket', 'carrinho-cliente', 0, 'ticket-owner:123456789012345678');
    const guild = { id: GUILD_ID, name: 'Community For Goats', memberCount: 1, client,
        channels: { cache, fetch: async id => cache.get(id) ?? null },
        members: { me: { roles: { highest: { comparePositionTo: () => 1 } } } },
        roles: { cache: new Collection(), fetch: async () => null }
    };
    for (const item of cache.values()) item.guild = guild;
    t.mock.method(client.channels, 'fetch', async id => cache.get(id) ?? null);
    client.guilds.cache.set(GUILD_ID, guild);
    const server = iniciarApiAnunciosFiveM();
    await once(server, 'listening');
    t.after(async () => { await new Promise(resolve => server.close(resolve)); client.guilds.cache.clear(); });
    const origin = 'http://127.0.0.1:35631';
    async function request(route, method = 'GET', body, token = 'panel-fixture-secret') {
        const response = await fetch(origin + route, {
            method, headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, data: await response.json() };
    }

    await t.test('both web panels serve the shared logo, Lucide icons and five-second feedback toasts', async () => {
        const [botPage, syncPage, logo, botScript, botStyles] = await Promise.all([
            fetch(origin + '/painel'),
            fetch(origin + '/forgoats'),
            fetch(origin + '/painel/community-for-goats-logo.jpg'),
            fetch(origin + '/painel/app.js'),
            fetch(origin + '/painel/style.css')
        ]);
        assert.equal(botPage.status, 200);
        assert.equal(syncPage.status, 200);
        assert.equal(logo.status, 200);
        assert.match(logo.headers.get('content-type'), /image\/jpeg/);
        assert.ok((await logo.arrayBuffer()).byteLength > 1000);
        const botHtml = await botPage.text();
        assert.match(botHtml, /src="\/painel\/community-for-goats-logo\.jpg"/);
        const syncHtml = await syncPage.text();
        assert.match(syncHtml, /src="\/painel\/community-for-goats-logo\.jpg"/);
        assert.match(syncHtml, /<symbol id="fg-icon-layout"/);
        assert.match(syncHtml, /<symbol id="fg-icon-log-out"/);
        assert.match(syncHtml, /class="mobile-bottom-nav" aria-label="Navegação principal"/);
        assert.match(syncHtml, /data-tab="timetokens"[^>]+mudarTab\('timetokens'\)/);
        assert.match(botHtml, /id="mobile-navigation" class="mobile-nav"/);
        assert.match(botHtml, /id="mobile-more-toggle"[^>]+aria-controls="mobile-more"/);
        assert.match(botHtml, /class="mobile-brand-logo" src="\/painel\/community-for-goats-logo\.jpg"/);
        assert.match(syncHtml, /id="toast"[^>]+aria-atomic="true"[^>]+hidden/);
        assert.match(syncHtml, /toast-countdown/);
        assert.match(syncHtml, /--toast-duration:\s*5s/);
        assert.match(syncHtml, /\}, 4820\);/);
        const botScriptText = await botScript.text();
        const botStylesText = await botStyles.text();
        assert.equal(botScript.status, 200);
        assert.equal(botStyles.status, 200);
        assert.match(botScriptText, /querySelector\('\.toast-message'\)/);
        assert.match(botScriptText, /setAttribute\('aria-live', error \? 'assertive' : 'polite'\)/);
        assert.match(botScriptText, /}, 4820\);/);
        assert.match(botStylesText, /toast-countdown/);
        assert.match(botStylesText, /toast-notice\[hidden\]\{display:none\}/);
        assert.match(botStylesText, /--toast-duration:5s/);
        assert.match(botStylesText, /\.mobile-nav\{position:fixed/);
        const syncStyles = syncHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
        assert.match(syncStyles, /\.mobile-bottom-nav \{ position: fixed/);
    });

    await t.test('bot resources can be created, updated and removed through their real routes', async () => {
        assert.equal((await request('/api/painel/partners', 'GET', undefined, 'wrong')).status, 401);
        const created = await request('/api/painel/partners', 'POST', { name: 'Parceiro', url: 'https://example.com', description: 'Descrição' });
        assert.equal(created.status, 200);
        const id = created.data.items[0].id;
        assert.equal((await request('/api/painel/partners/' + id, 'PUT', { name: 'Atualizado', url: 'https://example.com', description: 'Nova descrição' })).status, 200);
        assert.equal(memory.read('parcerias.json')[0].name, 'Atualizado');
        assert.equal((await request('/api/painel/partners/' + id, 'DELETE')).status, 200);
        assert.deepEqual(memory.read('parcerias.json'), []);
        const announcement = await request('/api/painel/announcements', 'POST', { titulo: 'Anúncio', texto: 'Conteúdo' });
        assert.equal(announcement.status, 200);
        const announcementId = announcement.data.items[0].id;
        assert.equal((await request('/api/painel/announcements/' + announcementId, 'PUT', { titulo: 'Atualizado', texto: 'Alteração' })).status, 200);
        assert.equal((await request('/api/painel/announcements/' + announcementId, 'DELETE')).status, 200);
        assert.equal((await request('/api/painel/tickets')).data.items.length, 1);
        assert.equal((await request('/api/painel/tickets/partners', 'DELETE')).status, 404);
        assert.equal((await request('/api/painel/tickets/ticket', 'DELETE')).status, 200);
        assert.equal((await request('/api/painel/tickets')).data.items.length, 0);
        assert.equal((await request('/api/painel/backup')).status, 200);
        assert.equal((await request('/api/painel/audit')).status, 200);
        assert.ok((await request('/api/painel/commands')).data.items.some(item => item.name === 'reiniciar'));
        assert.equal((await request('/api/painel/commands/sync', 'POST', {})).status, 200);
        assert.equal(getSlashCommands(client.commands.values()).filter(item => item.name === 'set').length, 1);
    });

    await t.test('a Sync token can register, login, verify and rebind its original account', async () => {
        assert.equal((await request('/api/forgoats/login', 'POST', { username: 'forgoats', password: 'goats' })).status, 401);
        const admin = await request('/api/forgoats/login', 'POST', { username: 'forgoats', password: 'sync-fixture-secret' });
        assert.equal(admin.status, 200);
        const session = admin.data.sessionToken;
        const created = await request('/api/forgoats/tokens/create', 'POST', { type: 'test' }, session);
        assert.equal(created.status, 201);
        const token = created.data.token;
        const registration = { username: 'cliente', password: 'fixture-password', token, hwid: 'computer-one' };
        assert.equal((await request('/api/auth/register', 'POST', registration)).status, 200);
        assert.match(memory.read('app_users.json')[0].passwordHash, /^scrypt:/);
        assert.equal((await request('/api/auth/register', 'POST', { ...registration, username: 'other' })).status, 409);
        assert.equal((await request('/api/auth/login', 'POST', registration)).status, 200);
        assert.equal((await request('/api/auth/verify', 'POST', { username: 'cliente' })).status, 400);
        assert.equal((await request('/api/auth/verify', 'POST', { username: 'cliente', hwid: 'computer-one' })).status, 200);
        assert.equal((await request('/api/forgoats/tokens/reset-hwid', 'POST', { token }, session)).status, 200);
        assert.equal((await request('/api/auth/login', 'POST', { ...registration, hwid: 'computer-two' })).status, 200);
        assert.equal((await request('/api/auth/verify', 'POST', { username: 'cliente', hwid: 'computer-one' })).status, 403);
        assert.equal((await request('/api/forgoats/tokens/' + token, 'DELETE', undefined, session)).status, 200);
        assert.equal((await request('/api/auth/verify', 'POST', { username: 'cliente', hwid: 'computer-two' })).data.reason, 'token_expired');
        assert.equal((await request('/api/forgoats/logout', 'POST', {}, session)).status, 200);
        assert.equal((await request('/api/forgoats/overview', 'GET', undefined, session)).status, 401);
    });

    await t.test('legacy passwords are upgraded without invalidating accounts', async () => {
        memory.seed('tokens.json', { LEGACY: { expiresAt: Date.now() + 60000, hwid: 'legacy-computer', boundUsername: 'legacy' } });
        memory.seed('app_users.json', [{ username: 'legacy', passwordHash: createHash('sha256').update('password').digest('hex'), token: 'LEGACY', hwid: 'legacy-computer' }]);
        assert.equal((await request('/api/auth/login', 'POST', { username: 'legacy', password: 'password', hwid: 'legacy-computer' })).status, 200);
        assert.match(memory.read('app_users.json')[0].passwordHash, /^scrypt:/);
    });

    await t.test('ForGoats Discord web button creates an opening link', async () => {
        const { tratarInteracaoPainelForGoats, FORGOATS_PANEL_CHANNEL_ID } = await import('../src/features/forgoatsPanel.js');
        let response;
        const interaction = {
            channelId: FORGOATS_PANEL_CHANNEL_ID,
            guild: { id: GUILD_ID },
            user: { id: 'discord-user' },
            isButton: () => true,
            isStringSelectMenu: () => false,
            customId: 'forgoats_painel_web',
            reply: async payload => { response = payload; }
        };
        assert.equal(await tratarInteracaoPainelForGoats(interaction), true);
        const link = response.components[0].components[0].data.url;
        assert.match(link, /\/forgoats#access=[^&]+$/);
    });
});
