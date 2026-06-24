let adminCurrentUser = null;
let adminUsers = [];
let adminSelectedUserId = null;

// ── SCREEN CONTROL ────────────────────────────────────────
function showAdminScreen(user) {
  adminCurrentUser = user;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('admin-screen').classList.add('active');

  const av = document.getElementById('admin-avatar');
  if (user.avatarData && user.avatarData.startsWith('data:image/')) {
    av.innerHTML = `<img src="${escapeHtml(user.avatarData)}" class="avatar-img" alt="">`;
    av.style.background = 'transparent';
  } else {
    av.textContent = user.username[0].toUpperCase();
    av.style.background = user.avatarColor || '#e74c3c';
  }
  document.getElementById('admin-username').textContent = user.username;

  adminLoadUsers();
}

function adminSwitchTab(tab) {
  document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`admin-tab-${tab}`).classList.add('active');
  document.getElementById(`admin-nav-${tab}`).classList.add('active');
}

function adminGoBack() {
  // Volta pro chat normal
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('app-screen').classList.add('active');
  if (typeof loadRooms === 'function') loadRooms();
  if (typeof connectWebSocket === 'function') connectWebSocket();
  if (typeof updateAdminDropdownVisibility === 'function') updateAdminDropdownVisibility();
}

// ── ADMIN MESSAGES VIEW ─────────────────────────────────────
let adminViewingUserId = null;
let adminViewingUserName = '';

function adminViewMessages(userId, username) {
  adminViewingUserId = userId;
  adminViewingUserName = username;

  // Esconde a tab de usuarios, mostra a de mensagens
  document.getElementById('admin-tab-users').classList.remove('active');
  document.getElementById('admin-tab-messages').classList.add('active');
  document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('admin-title').textContent = `Conversas: ${escapeHtml(username)}`;

  // Controla visibilidade dos back buttons
  document.getElementById('admin-back-from-msgs').classList.remove('hidden');
  document.getElementById('admin-back-from-room').classList.add('hidden');

  adminLoadUserRooms(userId);
}

function adminBackToUsers() {
  adminViewingUserId = null;
  document.getElementById('admin-tab-messages').classList.remove('active');
  document.getElementById('admin-tab-users').classList.add('active');
  document.getElementById('admin-msg-content').classList.add('hidden');
  document.getElementById('admin-rooms-list').classList.remove('hidden');
  document.getElementById('admin-title').textContent = 'Painel de Administração';
  document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('admin-nav-users').classList.add('active');
  document.getElementById('admin-back-from-msgs').classList.add('hidden');
  document.getElementById('admin-back-from-room').classList.add('hidden');
}

function adminBackToRooms() {
  document.getElementById('admin-msg-content').classList.add('hidden');
  document.getElementById('admin-rooms-list').classList.remove('hidden');
  document.getElementById('admin-title').textContent = `Conversas: ${escapeHtml(adminViewingUserName)}`;
  document.getElementById('admin-back-from-msgs').classList.remove('hidden');
  document.getElementById('admin-back-from-room').classList.add('hidden');
}

async function adminLoadUserRooms(userId) {
  const container = document.getElementById('admin-rooms-list');
  container.innerHTML = '<div class="admin-loading-rooms">Carregando conversas...</div>';
  document.getElementById('admin-msg-content').classList.add('hidden');

  try {
    const res = await fetch(`${API}/admin/users/${userId}/rooms`);
    if (!res.ok) {
      container.innerHTML = '<div class="admin-loading-rooms" style="color:#e53935">Erro ao carregar conversas</div>';
      return;
    }
    const rooms = await res.json();

    if (rooms.length === 0) {
      container.innerHTML = '<div class="admin-loading-rooms">Nenhuma conversa encontrada.</div>';
      return;
    }

    container.innerHTML = rooms.map(room => `
      <div class="admin-room-card" data-room-id="${room.id}" data-room-name="${escapeHtml(room.name)}" onclick="adminOpenRoom('${room.id}', '${escapeHtml(room.name).replace(/'/g, "\\'")}')">
        <div class="admin-room-avatar">${room.name[0].toUpperCase()}</div>
        <div class="admin-room-info">
          <div class="admin-room-name">${escapeHtml(room.name)}</div>
          <div class="admin-room-meta">
            ${room.isDM ? '<span class="admin-room-badge">DM</span>' : '<span class="admin-room-badge admin-room-badge--group">Grupo</span>'}
            <span>${room.messageCount} msgs</span>
          </div>
          ${room.lastMessage ? `
            <div class="admin-room-preview">
              <span class="admin-room-author">${escapeHtml(room.lastMessage.authorName)}:</span>
              ${escapeHtml(room.lastMessage.content.substring(0, 50))}
            </div>
            <div class="admin-room-time">${formatRelative(room.lastMessage.timestamp)}</div>
          ` : '<div class="admin-room-preview admin-room-preview--empty">Sem mensagens</div>'}
        </div>
        <div class="admin-room-arrow">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div class="admin-loading-rooms" style="color:#e53935">Erro de conexão</div>';
  }
}

async function adminOpenRoom(roomId, roomName) {
  if (!adminViewingUserId) return;

  document.getElementById('admin-rooms-list').classList.add('hidden');
  document.getElementById('admin-back-from-msgs').classList.add('hidden');
  document.getElementById('admin-back-from-room').classList.remove('hidden');
  document.getElementById('admin-back-room-label').textContent = roomName || 'Conversas';

  const contentEl = document.getElementById('admin-msg-content');
  contentEl.classList.remove('hidden');
  contentEl.innerHTML = '<div class="admin-loading-rooms">Carregando mensagens...</div>';

  document.getElementById('admin-title').textContent = `Mensagens: ${escapeHtml(roomName || 'Conversa')}`;

  try {
    const res = await fetch(`${API}/admin/users/${adminViewingUserId}/rooms/${roomId}/messages`);
    if (!res.ok) {
      contentEl.innerHTML = '<div class="admin-loading-rooms" style="color:#e53935">Erro ao carregar mensagens</div>';
      return;
    }
    const messages = await res.json();

    if (messages.length === 0) {
      contentEl.innerHTML = '<div class="admin-loading-rooms">Nenhuma mensagem nesta conversa.</div>';
      return;
    }

    let lastDate = null;
    let html = '<div class="admin-msgs-wrapper">';
    messages.forEach(msg => {
      const date = new Date(msg.timestamp).toLocaleDateString('pt-BR');
      if (date !== lastDate) {
        html += `<div class="admin-msg-day">${date}</div>`;
        lastDate = date;
      }
      const isOut = msg.authorId === adminViewingUserId;
      const time = new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      let content = '';
      if (msg.deleted) {
        content = '<em style="opacity:.5">Mensagem apagada</em>';
      } else if (msg.type === 'image') {
        content = `<div class="admin-msg-image-wrap"><img src="${escapeHtml(msg.content)}" class="admin-msg-image" onclick="window.open('${escapeHtml(msg.content)}','_blank')"></div>`;
      } else if (msg.type === 'file') {
        content = '<span style="opacity:.7">📄 Documento</span>';
      } else {
        content = escapeHtml(msg.content);
      }
      html += `
        <div class="admin-msg-row ${isOut ? 'admin-msg-out' : 'admin-msg-in'}">
          <div class="admin-msg-author-tag">${escapeHtml(msg.authorName)}</div>
          <div class="admin-msg-bubble">
            ${content}
            <div class="admin-msg-time">${time}</div>
          </div>
        </div>
      `;
    });
    html += '</div>';
    contentEl.innerHTML = html;
  } catch {
    contentEl.innerHTML = '<div class="admin-loading-rooms" style="color:#e53935">Erro de conexão</div>';
  }
}

async function adminLogout() {
  await fetch(`${API}/auth/logout`, { method: 'POST' });
  adminCurrentUser = null;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('login-screen').classList.add('active');
  if (typeof showLogin === 'function') showLogin();
}

// ── LOAD USERS ────────────────────────────────────────────
async function adminLoadUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="admin-loading">Carregando...</td></tr>';

  try {
    const res = await fetch(`${API}/admin/users`);
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="5" class="admin-loading" style="color:#e53935">Erro ao carregar</td></tr>';
      return;
    }
    adminUsers = await res.json();

    // Stats
    const total = adminUsers.length;
    const admins = adminUsers.filter(u => u.isAdmin).length;
    const regulars = total - admins;
    document.getElementById('admin-stats').innerHTML = `
      <div class="admin-stat-card"><span class="admin-stat-num">${total}</span> Total</div>
      <div class="admin-stat-card"><span class="admin-stat-num">${regulars}</span> Usuários</div>
      <div class="admin-stat-card"><span class="admin-stat-num">${admins}</span> Admins</div>
    `;

    renderUserTable(adminUsers);
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" class="admin-loading" style="color:#e53935">Erro de conexão</td></tr>';
  }
}

function renderUserTable(users) {
  const tbody = document.getElementById('admin-users-tbody');
  tbody.innerHTML = '';

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="admin-loading">Nenhum usuário encontrado.</td></tr>';
    return;
  }

  // Admin primeiro, depois ordena por data
  users.sort((a, b) => {
    if (a.isAdmin && !b.isAdmin) return -1;
    if (!a.isAdmin && b.isAdmin) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  users.forEach(u => {
    const tr = document.createElement('tr');
    const created = u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '-';
    const isYou = u.id === adminCurrentUser?.id;

    const avColor = u.avatarColor || '#666';
    const avatarHtml = u.avatarData && u.avatarData.startsWith('data:image/')
      ? `<img src="${escapeHtml(u.avatarData)}" class="admin-table-avatar-img" alt="">`
      : `<span style="background:${avColor}">${u.username[0].toUpperCase()}</span>`;

    tr.innerHTML = `
      <td>
        <div class="admin-user-cell">
          <div class="admin-table-avatar">${avatarHtml}</div>
          <div>
            <span class="admin-user-name">${escapeHtml(u.username)}${isYou ? ' <span class="admin-you-badge">(você)</span>' : ''}</span>
          </div>
        </div>
      </td>
      <td class="admin-cell-mono">${escapeHtml(u.id)}</td>
      <td>${created}</td>
      <td>${u.isAdmin ? '<span class="admin-badge admin-badge--admin">Admin</span>' : '<span class="admin-badge admin-badge--user">Usuário</span>'}</td>
      <td class="admin-actions-cell">
        ${!u.isAdmin ? `
          <button class="admin-btn admin-btn-sm admin-btn-msg" onclick="adminViewMessages('${u.id}', '${escapeHtml(u.username)}')" title="Ver conversas">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            Msgs
          </button>
          <button class="admin-btn admin-btn-sm admin-btn-admin" onclick="adminOpenModal('${u.id}')" title="Gerenciar usuário">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Gerenciar
          </button>
        ` : '<span class="admin-muted">—</span>'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── MODAL ─────────────────────────────────────────────────
function adminOpenModal(userId) {
  adminSelectedUserId = userId;
  const user = adminUsers.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('admin-modal-title').textContent = `Gerenciar: ${escapeHtml(user.username)}`;
  document.getElementById('admin-modal-name').textContent = user.username;
  document.getElementById('admin-modal-id').textContent = `ID: ${user.id}`;

  const av = document.getElementById('admin-modal-avatar');
  if (user.avatarData && user.avatarData.startsWith('data:image/')) {
    av.innerHTML = `<img src="${escapeHtml(user.avatarData)}" class="avatar-img" alt="">`;
    av.style.background = 'transparent';
  } else {
    av.textContent = user.username[0].toUpperCase();
    av.style.background = user.avatarColor || '#666';
  }

  document.getElementById('admin-edit-username').value = '';
  document.getElementById('admin-edit-password').value = '';
  document.getElementById('admin-edit-username-error').classList.add('hidden');
  document.getElementById('admin-edit-password-error').classList.add('hidden');
  document.getElementById('admin-delete-error').classList.add('hidden');

  document.getElementById('admin-user-modal').classList.remove('hidden');
}

function adminCloseModal() {
  document.getElementById('admin-user-modal').classList.add('hidden');
  adminSelectedUserId = null;
}

// ── EDIT USERNAME ─────────────────────────────────────────
async function adminEditUsername() {
  const input = document.getElementById('admin-edit-username');
  const errorEl = document.getElementById('admin-edit-username-error');
  errorEl.classList.add('hidden');

  const username = input.value.trim();
  if (!username || username.length < 3) {
    errorEl.textContent = 'O nome deve ter pelo menos 3 caracteres.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`${API}/admin/users/${adminSelectedUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });

    if (!res.ok) {
      const err = await res.json();
      errorEl.textContent = err.error || 'Erro ao alterar nome.';
      errorEl.classList.remove('hidden');
      return;
    }

    adminCloseModal();
    adminLoadUsers();
    showToast('Nome alterado com sucesso!');
  } catch {
    errorEl.textContent = 'Erro de conexão.';
    errorEl.classList.remove('hidden');
  }
}

// ── EDIT PASSWORD ─────────────────────────────────────────
async function adminEditPassword() {
  const input = document.getElementById('admin-edit-password');
  const errorEl = document.getElementById('admin-edit-password-error');
  errorEl.classList.add('hidden');

  const newPassword = input.value.trim();
  if (!newPassword || newPassword.length < 6) {
    errorEl.textContent = 'A senha deve ter pelo menos 6 caracteres.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`${API}/admin/users/${adminSelectedUserId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword })
    });

    if (!res.ok) {
      const err = await res.json();
      errorEl.textContent = err.error || 'Erro ao alterar senha.';
      errorEl.classList.remove('hidden');
      return;
    }

    adminCloseModal();
    showToast('Senha alterada com sucesso!');
  } catch {
    errorEl.textContent = 'Erro de conexão.';
    errorEl.classList.remove('hidden');
  }
}

// ── DELETE USER ───────────────────────────────────────────
async function adminDeleteUser() {
  const errorEl = document.getElementById('admin-delete-error');
  errorEl.classList.add('hidden');

  const ok1 = await showConfirm('Tem certeza que deseja excluir este usuário? Esta ação é irreversível.');
  if (!ok1) return;
  const ok2 = await showConfirm('Esta ação removerá todas as mensagens e conversas do usuário. Deseja continuar?');
  if (!ok2) return;

  try {
    const res = await fetch(`${API}/admin/users/${adminSelectedUserId}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      const err = await res.json();
      errorEl.textContent = err.error || 'Erro ao deletar.';
      errorEl.classList.remove('hidden');
      return;
    }

    adminCloseModal();
    adminLoadUsers();
    showToast('Usuário excluído!');
  } catch {
    errorEl.textContent = 'Erro de conexão.';
    errorEl.classList.remove('hidden');
  }
}

// ── TOAST (usa a função do app.js) ──────────────────────────
// showToast e escapeHtml já estão definidas em app.js
