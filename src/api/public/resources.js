export const resourceRoutes = {
  messages: '/api/painel/messages',
  partners: '/api/painel/partners',
  announcements: '/api/painel/announcements',
  tickets: '/api/painel/tickets',
  commands: '/api/painel/commands',
  audit: '/api/painel/audit'
};

// Um único formulário cuida dos cadastros simples de parcerias e anúncios.
function openEditor(fields, record, save, escapeHtml, notice) {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `<form class="dialog-card"><h2>${record ? 'Editar' : 'Adicionar'}</h2>${fields.map(field => `
    <label>${field.label}${field.multiline
      ? `<textarea name="${field.name}" required maxlength="${field.max}">${escapeHtml(record?.[field.name] ?? '')}</textarea>`
      : field.type === 'checkbox' ? `<input name="${field.name}" type="checkbox" ${record?.[field.name] ? 'checked' : ''}>`
      : `<input name="${field.name}" type="${field.type ?? 'text'}" ${field.optional ? '' : 'required'} maxlength="${field.max}" value="${escapeHtml(record?.[field.name] ?? '')}">`}</label>`).join('')}
    <p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="ghost">Cancelar</button><button class="primary" type="submit">Salvar</button></div></form>`;
  document.body.append(dialog);
  dialog.querySelector('button[type="button"]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const button = dialog.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      for (const field of fields.filter(item => item.type === 'checkbox')) values[field.name] = event.currentTarget.elements[field.name].checked;
      await save(values);
      dialog.close();
    } catch (error) {
      dialog.querySelector('[role="alert"]').textContent = error.message;
      notice(error.message, true);
    } finally { button.disabled = false; }
  };
  dialog.showModal();
}

export function renderBotResources(page, data, { request, refresh, notice, escapeHtml }) {
  const content = document.getElementById('content');
  const items = data.items ?? [];
  const route = resourceRoutes[page];
  const run = async (button, operation, successMessage) => {
    button.disabled = true;
    try {
      await operation();
      if (successMessage) notice(successMessage);
      try { await refresh(); }
      catch (error) { notice(`A ação foi concluída, mas a tela não atualizou: ${error.message}`, true); }
    }
    catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  };

  if (page === 'partners' || page === 'announcements' || page === 'messages') {
    const fields = page === 'partners' ? [
      { name: 'name', label: 'Nome', max: 80 },
      { name: 'url', label: 'Link HTTPS', type: 'url', max: 500 },
      { name: 'description', label: 'Descrição', multiline: true, max: 800 }
    ] : page === 'announcements' ? [
      { name: 'titulo', label: 'Título', max: 100 },
      { name: 'texto', label: 'Texto do anúncio', multiline: true, max: 1800 }
    ] : [
      { name: 'title', label: 'Título', max: 256, optional: true },
      { name: 'text', label: 'Mensagem', multiline: true, max: 1800 },
      { name: 'imageFile', label: 'Imagem em assets/store (opcional)', max: 200, optional: true },
      { name: 'enabled', label: 'Aviso ativo', type: 'checkbox' }
    ];
    content.innerHTML = `<div class="section-head"><p class="detail">O canal de destino pode ser alterado em Configuração. Avisos editados são aplicados na próxima publicação.</p>${page === 'messages' ? '' : '<button id="resource-add" class="primary">Adicionar</button>'}</div>
      <div class="grid two">${items.length ? items.map(item => `<article class="card"><h2>${escapeHtml(item.name ?? item.titulo)}</h2><p class="resource-description">${escapeHtml(item.description ?? item.texto ?? item.text)}</p>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Ver parceria</a>` : ''}<div class="dialog-actions"><button class="secondary" data-edit="${escapeHtml(item.id)}">Editar</button>${page === 'messages' && item.enabled ? `<button class="primary" data-publish="${escapeHtml(item.id)}">Publicar agora</button>` : ''}<button class="tiny danger" data-remove="${escapeHtml(item.id)}">${page === 'messages' ? 'Desativar e remover mensagem' : 'Remover'}</button></div></article>`).join('') : '<p class="empty">Nenhum cadastro. Use Adicionar para criar a primeira publicação.</p>'}</div>`;
    const edit = record => openEditor(fields, record, async values => {
      await request(record ? `${route}/${encodeURIComponent(record.id)}` : route, { method: record ? 'PUT' : 'POST', body: JSON.stringify(values) });
      notice(record ? 'Alterações salvas.' : 'Cadastro criado.');
      try { await refresh(); }
      catch (error) { notice(`Salvo, mas a tela não atualizou: ${error.message}`, true); }
    }, escapeHtml, notice);
    if (document.getElementById('resource-add')) document.getElementById('resource-add').onclick = () => edit(null);
    content.querySelectorAll('[data-publish]').forEach(button => {
      button.onclick = () => void run(button, () => request(`${route}/${button.dataset.publish}/publish`, { method: 'POST', body: '{}' }), 'Publicação enviada ao Discord.');
    });
    content.querySelectorAll('[data-edit]').forEach(button => { button.onclick = () => edit(items.find(item => item.id === button.dataset.edit)); });
    content.querySelectorAll('[data-remove]').forEach(button => {
      button.onclick = () => {
        if (confirm('Remover este cadastro e sua publicação no Discord?')) void run(button, () => request(`${route}/${encodeURIComponent(button.dataset.remove)}`, { method: 'DELETE' }), page === 'messages' ? 'Mensagem desativada e removida.' : 'Cadastro removido.');
      };
    });
    return;
  }

  if (page === 'tickets') {
    content.innerHTML = `<div class="section-head"><p class="detail">O fechamento salva a transcrição antes de remover o canal.</p><button id="publish-ticket-panel" class="primary">Atualizar painel de abertura</button></div>
      <div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Cliente</th><th>Ações</th></tr></thead><tbody>${items.length ? items.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.ownerId ?? 'Ticket antigo')}</td><td><button class="tiny danger" data-close="${escapeHtml(item.id)}">Fechar ticket</button></td></tr>`).join('') : '<tr><td colspan="3" class="empty">Nenhum ticket aberto.</td></tr>'}</tbody></table></div>`;
    document.getElementById('publish-ticket-panel').onclick = event => void run(event.currentTarget, () => request('/api/painel/tickets/panel', { method: 'POST', body: '{}' }), 'Painel de tickets atualizado.');
    content.querySelectorAll('[data-close]').forEach(button => {
      button.onclick = () => {
        if (confirm('Salvar a transcrição e fechar este ticket?')) void run(button, () => request(`${route}/${encodeURIComponent(button.dataset.close)}`, { method: 'DELETE' }), 'Transcrição salva e ticket fechado.');
      };
    });
    return;
  }

  if (page === 'commands') {
    const routes = items.flatMap(command => {
      const subs = command.options?.filter(option => option.type === 1) ?? [];
      return subs.length ? subs.map(sub => ({ name: `${command.name} ${sub.name}`, description: sub.description })) : [command];
    });
    content.innerHTML = `<div class="section-head"><p class="detail">${routes.length} comandos e subcomandos disponíveis. Sincronize após alterar o código dos comandos.</p><button id="sync-commands" class="primary">Sincronizar com o Discord</button></div><div class="table-wrap"><table><thead><tr><th>Comando</th><th>Descrição</th></tr></thead><tbody>${routes.map(item => `<tr><td><code>/${escapeHtml(item.name)}</code></td><td>${escapeHtml(item.description)}</td></tr>`).join('')}</tbody></table></div>`;
    document.getElementById('sync-commands').onclick = event => void run(event.currentTarget, () => request('/api/painel/commands/sync', { method: 'POST', body: '{}' }), 'Comandos sincronizados com o Discord.');
    return;
  }

  content.innerHTML = `<div class="section-head"><h2>Últimas ações administrativas</h2><button id="download-backup" class="secondary">Baixar backup do bot</button></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Ação</th><th>Detalhes</th></tr></thead><tbody>${items.length ? items.map(item => `<tr><td>${escapeHtml(new Date(item.at).toLocaleString('pt-BR'))}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.subject)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">Nenhuma ação registrada.</td></tr>'}</tbody></table></div>`;
  document.getElementById('download-backup').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const data = await request('/api/painel/backup');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `backup-bot-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      notice('Backup baixado.');
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  };
}
