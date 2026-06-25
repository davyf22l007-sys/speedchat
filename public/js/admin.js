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

  adminCheckMobile();
  adminLoadUsers();
}

function adminSwitchTab(tab) {
  document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`admin-tab-${tab}`).classList.add('active');
  document.getElementById(`admin-nav-${tab}`).classList.add('active');
  // Fecha sidebar no mobile
  adminCloseSidebar();
  // Se for a tab de grupos, carrega os grupos
  if (tab === 'groups') {
    adminLoadGroups();
  }
}

function adminGoBack() {
  // Volta pro chat normal
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('app-screen').classList.add('active');
  if (typeof loadRooms === 'function') loadRooms();
  if (typeof connectWebSocket === 'function') connectWebSocket();
  if (typeof updateAdminDropdownVisibility === 'function') updateAdminDropdownVisibility();
}

// ── MOBILE: toggle sidebar ────────────────────────────────
function adminToggleSidebar() {
  const sidebar = document.querySelector('.admin-sidebar');
  const overlay = document.getElementById('admin-sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('hidden');
}

function adminCloseSidebar() {
  const sidebar = document.querySelector('.admin-sidebar');
  const overlay = document.getElementById('admin-sidebar-overlay');
  sidebar.classList.remove('open');
  overlay.classList.add('hidden');
}

// Detecta se é mobile pra mostrar o hamburger
function adminCheckMobile() {
  const menuBtn = document.getElementById('admin-menu-btn');
  if (window.innerWidth <= 768) {
    menuBtn.classList.remove('hidden');
  } else {
    menuBtn.classList.add('hidden');
    adminCloseSidebar();
  }
}

window.addEventListener('resize', adminCheckMobile);

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

  // Fecha sidebar no mobile
  adminCloseSidebar();

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
      <div class="admin-room-card" data-room-id="${room.id}" data-room-name="${escapeHtml(room.name)}">
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

    // Seta o data-user-id e o onclick pra expandir ações no mobile
    tr.dataset.userId = u.id;

    const actionsHtml = !u.isSuperAdmin ? `
      <button class="admin-btn admin-btn-sm admin-btn-msg" onclick="event.stopPropagation(); adminViewMessages('${u.id}', '${escapeHtml(u.username)}')" title="Ver conversas">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        Msgs
      </button>
      <button class="admin-btn admin-btn-sm admin-btn-admin" onclick="event.stopPropagation(); adminOpenModal('${u.id}')" title="Gerenciar usuário">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Gerenciar
      </button>
    ` : '';

    tr.innerHTML = `
      <td>
        <div class="admin-user-cell">
          <div class="admin-table-avatar">${avatarHtml}</div>
          <div>
            <span class="admin-user-name">${escapeHtml(u.username)}${isYou ? ' <span class="admin-you-badge">(você)</span>' : ''}</span>
          </div>
        </div>
        ${actionsHtml ? `<div class="admin-row-actions-mobile">${actionsHtml}</div>` : ''}
      </td>
      <td class="admin-cell-mono">${escapeHtml(u.id)}</td>
      <td>${created}</td>
      <td>${u.isSuperAdmin ? '<span class="admin-badge admin-badge--superadmin"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="margin-right:3px;vertical-align:-1px"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>Super Admin</span>' : u.isAdmin ? '<span class="admin-badge admin-badge--admin">Admin</span>' : '<span class="admin-badge admin-badge--user">Usuário</span>'}</td>
      <td class="admin-actions-cell">${actionsHtml || '<span class="admin-muted">—</span>'}</td>
    `;
    tbody.appendChild(tr);
  });

  // Adiciona evento de clique na tabela pra expandir ações no mobile (só uma vez)
  if (!tbody._delegateAdded) {
    tbody._delegateAdded = true;
    tbody.addEventListener('click', function(e) {
      // Só funciona no mobile
      if (window.innerWidth > 768) return;
      // Se clicou num botao, nao faz nada
      if (e.target.closest('button')) return;
      // Encontra a linha clicada
      const row = e.target.closest('tr');
      if (!row) return;
      // Se for super admin, nao expande (nao tem acoes)
      const user = adminUsers.find(u => u.id === row.dataset.userId);
      if (user && user.isSuperAdmin) return;
      // Toggle expanded
      row.classList.toggle('expanded');
    });
  }
}

// ── MODAL ─────────────────────────────────────────────────
function adminOpenModal(userId) {
  adminSelectedUserId = userId;
  const user = adminUsers.find(u => u.id === userId);

  adminCloseSidebar();
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
  document.getElementById('admin-toggle-error').classList.add('hidden');

  // Mostra/esconde seção de toggle admin baseado em quem tá logado
  const adminSection = document.getElementById('admin-modal-admin-section');
  if (adminCurrentUser && adminCurrentUser.isSuperAdmin && !user.isSuperAdmin) {
    adminSection.classList.remove('hidden');
    const toggleBtn = document.getElementById('admin-toggle-admin-btn');
    if (user.isAdmin) {
      toggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> Remover Admin';
      toggleBtn.className = 'admin-btn admin-btn-sm admin-btn-danger';
    } else {
      toggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Tornar Admin';
      toggleBtn.className = 'admin-btn admin-btn-sm admin-btn-admin';
    }
    // Guarda o target
    document.getElementById('admin-toggle-admin-btn').dataset.targetId = userId;
    document.getElementById('admin-toggle-admin-btn').dataset.isCurrentlyAdmin = user.isAdmin ? '1' : '0';
  } else {
    adminSection.classList.add('hidden');
  }

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

// ── TOGGLE ADMIN (promover/rebaixar) ───────────────────────
async function adminToggleAdmin() {
  const btn = document.getElementById('admin-toggle-admin-btn');
  const errorEl = document.getElementById('admin-toggle-error');
  errorEl.classList.add('hidden');

  const userId = btn.dataset.targetId;
  const isCurrentlyAdmin = btn.dataset.isCurrentlyAdmin === '1';
  const newIsAdmin = !isCurrentlyAdmin;

  const user = adminUsers.find(u => u.id === userId);
  if (!user) return;

  const action = newIsAdmin ? 'promover' : 'rebaixar';
  const ok = await showConfirm(`Tem certeza que deseja ${action} ${escapeHtml(user.username)}?`);
  if (!ok) return;

  try {
    const res = await fetch(`${API}/admin/users/${userId}/toggle-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAdmin: newIsAdmin })
    });

    if (!res.ok) {
      const err = await res.json();
      errorEl.textContent = err.error || 'Erro ao alterar administrador.';
      errorEl.classList.remove('hidden');
      return;
    }

    adminCloseModal();
    adminLoadUsers();
    showToast(newIsAdmin ? 'Usuário promovido a administrador!' : 'Administrador rebaixado.');
  } catch {
    errorEl.textContent = 'Erro de conexão.';
    errorEl.classList.remove('hidden');
  }
}

// ── ADMIN GROUPS (Grupos Globais) ─────────────────────────
async function adminLoadGroups() {
  const tbody = document.getElementById('admin-groups-tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="admin-loading">Carregando...</td></tr>';

  try {
    const res = await fetch(`${API}/admin/rooms?_t=${Date.now()}`);
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="4" class="admin-loading" style="color:#e53935">Erro ao carregar</td></tr>';
      return;
    }
    const rooms = await res.json();

    if (rooms.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="admin-loading">Nenhum grupo encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = rooms.map(r => {
      const isGlobal = r.isGlobal;
      return `
        <tr>
          <td>
            <div class="admin-user-cell">
              <div class="admin-table-avatar" style="width:36px;height:36px;border-radius:50%;background:${r.isGlobal ? '#25d366' : '#666'};display:flex;align-items:center;justify-content:center;color:white;font-weight:600;font-size:14px;flex-shrink:0">
                ${escapeHtml(r.name[0].toUpperCase())}
              </div>
              <span class="admin-user-name">${escapeHtml(r.name)}</span>
            </div>
          </td>
          <td>${r.memberCount}</td>
          <td>
            <label class="toggle-switch" style="margin:0">
              <input type="checkbox" ${isGlobal ? 'checked' : ''} onchange="adminToggleGlobal('${r.id}', this.checked)" />
              <span class="toggle-slider" style="width:40px;height:22px"></span>
            </label>
          </td>
          <td class="admin-actions-cell">
            <button class="admin-btn admin-btn-sm" onclick="adminAddAllUsers('${r.id}', '${escapeHtml(r.name)}')" title="Adicionar todos os usuários a este grupo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                <circle cx="8.5" cy="7" r="4"/>
                <line x1="20" y1="8" x2="20" y2="14"/>
                <line x1="23" y1="11" x2="17" y2="11"/>
              </svg>
              Add todos
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('adminLoadGroups erro:', err);
    tbody.innerHTML = '<tr><td colspan="4" class="admin-loading" style="color:#e53935">Erro de conexão</td></tr>';
  }
}

async function adminToggleGlobal(roomId, isGlobal) {
  try {
    const res = await fetch(`${API}/admin/rooms/${roomId}/global`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isGlobal })
    });
    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || 'Erro ao alterar');
      adminLoadGroups();
      return;
    }
    const data = await res.json();
    const msg = isGlobal
      ? `Grupo marcado como global! ${data.added} usuário(s) adicionado(s)`
      : 'Grupo removido dos globais';
    showToast(msg);
    adminLoadGroups();
  } catch {
    showToast('Erro de conexão.');
    adminLoadGroups();
  }
}

async function adminAddAllUsers(roomId, roomName) {
  const ok = await showConfirm(`Adicionar todos os usuários existentes ao grupo "${escapeHtml(roomName)}"?`);
  if (!ok) return;

  try {
    const res = await fetch(`${API}/admin/rooms/${roomId}/add-all-users`, {
      method: 'POST'
    });
    if (!res.ok) {
      showToast('Erro ao adicionar usuários');
      return;
    }
    const data = await res.json();
    showToast(`${data.added} usuário(s) adicionado(s)!`);
    adminLoadGroups();
  } catch {
    showToast('Erro de conexão.');
  }
}

// ── EVENT DELEGATION GLOBAL (só adiciona uma vez) ──────────
let adminRoomDelegateAdded = false;
document.addEventListener('DOMContentLoaded', function() {
  const container = document.getElementById('admin-rooms-list');
  if (!container || adminRoomDelegateAdded) return;
  adminRoomDelegateAdded = true;
  container.addEventListener('click', function(e) {
    const card = e.target.closest('.admin-room-card');
    if (!card) return;
    const roomId = card.dataset.roomId;
    const roomName = card.dataset.roomName;
    if (roomId) adminOpenRoom(roomId, roomName);
  });
});
