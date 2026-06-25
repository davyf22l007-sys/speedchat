const API = '';
let currentUser = null;
let currentRoomId = null;
let ws = null;

let pendingMessages = [];

let isReconnecting = false;
let rooms = [];

let messagesCache = {};

let isPrefetching = false;
let replyToMsg = null;
let editingMsgId = null;
let contextMsgId = null;
let searchResults = [];
let searchIndex = -1;
// ── JOIN GROUP WITH PASSWORD ────────────────────────────────
let passwordJoinRoomId = null;

function openPasswordModal(roomId, roomName) {
  passwordJoinRoomId = roomId;
  document.getElementById('password-modal-room-name').textContent = `🔒 ${escapeHtml(roomName)}`;
  document.getElementById('password-modal-input').value = '';
  document.getElementById('password-modal-error').classList.add('hidden');
  document.getElementById('password-modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('password-modal-input').focus(), 80);
}

function closePasswordModal() {
  document.getElementById('password-modal-overlay').classList.add('hidden');
  passwordJoinRoomId = null;
}

document.getElementById('password-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('password-modal-overlay')) closePasswordModal();
});
document.getElementById('password-modal-close').addEventListener('click', closePasswordModal);

document.getElementById('password-modal-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('password-modal-btn').click();
});

document.getElementById('password-modal-btn').addEventListener('click', async () => {
  const roomId = passwordJoinRoomId;
  if (!roomId) return;

  const password = document.getElementById('password-modal-input').value.trim();
  const errorEl = document.getElementById('password-modal-error');
  errorEl.classList.add('hidden');

  if (!password) {
    errorEl.textContent = 'Digite a senha do grupo.';
    errorEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('password-modal-btn');
  btn.textContent = 'Entrando…';
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/api/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (!res.ok) {
      const err = await res.json();
      errorEl.textContent = err.error || 'Senha incorreta.';
      errorEl.classList.remove('hidden');
      btn.textContent = 'Entrar no Grupo';
      btn.disabled = false;
      return;
    }

    // Entrou! Recarrega as salas e abre o grupo
    closePasswordModal();
    await loadRooms();
    const room = rooms.find(r => r.id === roomId);
    if (room) openRoom(room);
    showToast('Você entrou no grupo!');
  } catch {
    errorEl.textContent = 'Erro de conexão.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.textContent = 'Entrar no Grupo';
    btn.disabled = false;
  }
});

const unreadCounts = {};

const $ = id => document.getElementById(id);

const AUTHOR_COLORS = [
  '#0d7c5f', '#d4832a', '#9c27b0', '#1976d2',
  '#c62828', '#00838f', '#558b2f', '#e65100'
];

function authorColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AUTHOR_COLORS[Math.abs(h) % AUTHOR_COLORS.length];
}

const AVATAR_COLORS = ['#25d366','#e17055','#6c5ce7','#0984e3','#fd79a8','#00b894','#fdcb6e','#d63031'];

function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ── NOTIFICAÇÃO SONORA ─────────────────────────────────────
let audioCtx = null;
function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523, audioCtx.currentTime);
    osc.frequency.setValueAtTime(659, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch {}
}

// ── NOTIFICAÇÃO NO TÍTULO DA ABA ─────────────────────────
let pageFocused = true;

function updateTitle() {
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
  if (totalUnread > 0 && !pageFocused) {
    document.title = `(${totalUnread}) SpeedChat`;
  } else {
    document.title = 'SpeedChat';
  }
}

window.addEventListener('focus', () => {
  pageFocused = true;
  updateTitle();
});
window.addEventListener('blur', () => {
  pageFocused = false;
  updateTitle();
});

// ── NOTIFICAÇÃO DESKTOP (Notification API) ───────────────
let notifPermissionAsked = false;

function askNotifPermission() {
  if (notifPermissionAsked) return;
  notifPermissionAsked = true;
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
  Notification.requestPermission();
}

function sendDesktopNotif(title, body, roomId) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (pageFocused) return;
  try {
    const notif = new Notification(title, {
      body: body,
      icon: '/favicon.svg',
      tag: roomId || 'speedchat',
      silent: true
    });
    notif.onclick = () => {
      window.focus();
      if (roomId) {
        const room = rooms.find(r => r.id === roomId);
        if (room) openRoom(room);
      }
      notif.close();
    };
  } catch {}
}

// ── TIMESTAMP RELATIVO ─────────────────────────────────────
function formatRelative(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'min';
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return d.toLocaleDateString('pt-BR');
}

// ── EMOJI DATA ─────────────────────────────────────────────
const EMOJIS = ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥴','😵','🤯','🤠','🥳','🥺','😢','😭','😤','😡','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾','👋','🤚','🖐','✋','🖐','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦵','🦶','👂','🦻','👃','🧠','🦷','🦴','👀','👁','👅','👄','💋','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚧️','🚻','🚹','🚺','🚼','♿','🚾','🛂','🛃','🛄','🛅','⚠️','🚸','⛔','🚫','🚳','🚭','🚯','🚱','🚷','📵','🔞','☢️','☣️','💯','♨️','🎵','🎶','➕','➖','➗','✖️','💲','💱','™️','©️','®️','〰️','➰','➿','🔚','🔙','🔛','🔝','🔜','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','⚪️','🟤','💭','💬','🗯','💌','💧','💦','☔','☀️','🌤','⛅️','🌥','🌦','🌈','☁️','🌧','⛈','🌩','🌨','❄️','☃️','⛄️','🌬','💨','💫','🌪','🌫','🌊','☄️','🔥','💥','⭐️','🌟','✨','⚡️','☄️','💫','🌠','🌄','🌅','🌇','🌃','🌌','🌉','🌁','🎉','🎊','🎈','🎁','🎀','🎄','🎃','🎆','🎇','✨','🎗','🎟','🎫','🎖','🏆','🏅','🥇','🥈','🥉','⚽️','🏀','🏈','⚾️','🎾','🏐','🏉','🎱','🏓','🏸','🥊','🥋','🎯','⛳️','🏌️','⛸','🎿','⛷','🏂','🏋️','🤼','🤸','🤺','⛹️','🤾','🏊','🏄','🚣','🏇','🚴','🚵','🎤','🎧','🎵','🎶','🎼','🎹','🥁','🎷','🎺','🎸','🎻','🎲','♟','🎯','🎮','🎰','🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🚚','🚛','🚜','🏍','🛵','🚲','🛴','🚨','🚔','🚍','🚘','🚖','🛩','✈️','🚀','🛸','🚁','🛶','⛵️','🚤','🛳','⛴','🛳','🚢','🏠','🏡','🏘','🏚','🏗','🏢','🏭','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏯','🏰','💒','🗼','🗽','⛪️','🕌','🕍','🛕','🕋','⛩','🛤','🛣','🗾','🎑','🏞','🌅','🌄','🌋','🗻','🏔','🏕','⛺️','🌲','🌳','🌴','🌵','🌾','🌿','☘️','🍀','🍁','🍂','🍃','🍇','🍈','🍉','🍊','🍋','🍌','🍍','🥭','🍎','🍏','🍐','🍑','🍒','🍓','🫐','🥝','🍅','🫒','🥥','🥑','🍆','🥔','🥕','🌽','🌶','🫑','🥒','🥬','🥦','🧄','🧅','🍄','🥜','🌰','🍞','🥐','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','☕️','🍵','🧃','🥤','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊','🥄','🍴','🥄','🔪','🏺','🌍','🌎','🌏','🗺','🧭','🏔','⛰','🌋','🗻','🏕','🏖','🏜','🏝','🏞','🏟','🏛','🏗','🧱','🏘','🏚','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🕍','⛩','🕋','⛲','⛺','🌁','🌃','🏙','🌄','🌅','🌆','🌇','🌉','♨️','🎠','🎡','🎢','💈','🎪','🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','🚊','🚝','🚞','🚋','🚌','🚍','🚎','🚐','🚑','🚒','🚓','🚔','🚕','🚖','🚗','🚘','🚙','🚚','🚛','🚜','🏎','🏍','🛵','🛺','🚲','🛴','🛹','🚏','🛣','🛤','⛽','🚨','🚥','🚦','🛑','🚧','⚓','⛵','🛶','🚤','🛳','⛴','🛥','🚢','✈️','🛩','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰','🚀','🛸','🏠','⌚️','📱','💻','⌨️','🖥','🖨','🖱','🖲','🕹','🗜','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽','🎞','📞','☎️','📟','📠','📺','📻','🎙','🎚','🎛','🧭','⏱','⏲','⏰','🕰','⌛️','⏳','📡','🔋','🔌','💡','🔦','🕯','🪔','🧯','🗑','🛢','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🧰','🔧','🔨','⚒','🛠','⛏','🔩','⚙','🧱','⛓','🧲','🔫','💣','🧨','🪓','🔪','🗡','⚔','🛡','🚬','⚰','⚱','🏺','🔮','📿','🧿','🪬','💈','⚗','🔭','🔬','🕳','🩻','🩹','🩺','💊','💉','🩸','🧬','🦠','🧫','🧪','🌡','🧹','🪠','🧺','🧻','🚽','🚰','🚿','🛁','🛀','🧼','🪥','🪒','🧽','🪣','🧴','🛎','🔑','🗝','🚪','🪑','🛋','🛏','🛌','🧸','🖼','🪞','🪟','🛍','🛒','🎁','🎈','🎏','🎀','🎊','🎉','🎎','🏮','🎐','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','🏷','📪','📫','📬','📭','📮','📯','📜','📃','📄','📑','🧾','📊','📈','📉','🗒','🗓','📆','📅','🗑','📇','🗃','🗳','🗄','📋','📁','📂','🗂','🗞','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🧷','🔗','📎','🖇','📐','📏','🧮','📌','📍','✂️','🖊','🖋','✒️','🖌','🖍','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓'];

// ── INIT ──────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch(`${API}/auth/me`);
    if (res.ok) {
      currentUser = await res.json();
      showApp();
      // Admin pode acessar o painel pelo menu dropdown
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

// ── SCREENS ───────────────────────────────────────────────
function showLogin() {
  $('login-screen').classList.add('active');
  $('app-screen').classList.remove('active');
}

function showApp() {
  $('login-screen').classList.remove('active');
  $('app-screen').classList.add('active');
  updateAdminDropdownVisibility();
  loadRooms();
  connectWebSocket();
  // Pre-carrega msgs em background
  setTimeout(prefetchAllRooms, 500);
}

async function prefetchAllRooms() {
  if (isPrefetching) return;
  isPrefetching = true;
  try {
    const res = await fetch('/api/rooms');
    if (!res.ok) { isPrefetching = false; return; }
    const allRooms = await res.json();
    const fetches = allRooms.map(async room => {
      try {
        const r = await fetch(`/api/rooms/${room.id}/messages`);
        if (r.ok) {
          const data = await r.json();
          messagesCache[room.id] = Array.isArray(data) ? data : (data.messages || []);
        }
      } catch {}
    });
    await Promise.all(fetches);
  } catch {}
  isPrefetching = false;
}

function switchTab(tab) {
  const isLogin = tab === 'login';
  $('tab-login').classList.toggle('active', isLogin);
  $('tab-register').classList.toggle('active', !isLogin);
  $('form-login').classList.toggle('hidden', !isLogin);
  $('form-register').classList.toggle('hidden', isLogin);
  $('login-error').classList.add('hidden');
  $('register-error').classList.add('hidden');
}

// ── LOGIN ─────────────────────────────────────────────────
$('login-btn').addEventListener('click', async () => {
  const username = $('username').value.trim();
  const password = $('password').value;
  const errorEl  = $('login-error');
  errorEl.classList.add('hidden');
  if (!username || !password) {
    errorEl.textContent = 'Preencha todos os campos.';
    errorEl.classList.remove('hidden');
    return;
  }
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (res.ok) {
    currentUser = await res.json();
    showApp();
    // Admin pode acessar o painel pelo menu dropdown
  } else {
    const err = await res.json();
    errorEl.textContent = err.error || 'Erro ao entrar.';
    errorEl.classList.remove('hidden');
  }
});

$('password').addEventListener('keydown', e => { if (e.key === 'Enter') $('login-btn').click(); });

// ── CADASTRO ──────────────────────────────────────────────
$('register-btn').addEventListener('click', async () => {
  const username  = $('reg-username').value.trim();
  const password  = $('reg-password').value;
  const password2 = $('reg-password2').value;
  const errorEl   = $('register-error');
  errorEl.classList.add('hidden');
  if (!username || !password || !password2) {
    errorEl.textContent = 'Preencha todos os campos.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (password !== password2) {
    errorEl.textContent = 'As senhas não coincidem.';
    errorEl.classList.remove('hidden');
    return;
  }
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (res.ok) {
    currentUser = await res.json();
    showApp();
    // Admin pode acessar o painel pelo menu dropdown
  } else {
    const err = await res.json();
    errorEl.textContent = err.error || 'Erro ao criar conta.';
    errorEl.classList.remove('hidden');
  }
});

$('reg-password2').addEventListener('keydown', e => { if (e.key === 'Enter') $('register-btn').click(); });

// ── MOBILE NAV ────────────────────────────────────────────
function openChat() {
  document.querySelector('.sidebar').classList.add('hidden-mobile');
  document.querySelector('.chat-main').classList.add('visible-mobile');
}
function closeChat() {
  document.querySelector('.sidebar').classList.remove('hidden-mobile');
  document.querySelector('.chat-main').classList.remove('visible-mobile');
  cancelReply();
  cancelEdit();
}
$('back-btn').addEventListener('click', closeChat);

// ── LOGOUT ────────────────────────────────────────────────
$('logout-btn').addEventListener('click', async () => {
  await fetch(`${API}/auth/logout`, { method: 'POST' });
  if (ws) ws.close();
  currentUser = null;
  currentRoomId = null;
  showLogin();
});

// ── ROOMS ─────────────────────────────────────────────────
async function loadRooms() {
  const res = await fetch(`${API}/api/rooms`);
  if (!res.ok) return;
  rooms = await res.json();
  renderRoomList(rooms);
}

function renderRoomList(list) {
  const el = $('chat-list');
  el.innerHTML = '';
  list.forEach(room => {
    const item = document.createElement('div');
    item.className = 'chat-item' + (room.id === currentRoomId ? ' active' : '');
    item.dataset.roomId = room.id;
    const last = room.lastMessage;
    const time = last ? formatRelative(last.timestamp) : '';
    let preview = last ? (last.authorName + ': ' + (last.deleted ? 'Mensagem apagada' : last.content)) : 'Sem mensagens ainda';
    if (last?.type === 'image') preview = last.authorName + ': 📷 Imagem';
    else if (last?.type === 'file') preview = last.authorName + ': 📄 Documento';
    const color = room.avatarColor || avatarColor(room.name);
    const unread = unreadCounts[room.id] || 0;
    const badgeHtml = unread > 0 ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>` : '';
    const avatarHtml = room.avatarData && room.avatarData.startsWith('data:image/')
      ? `<div class="avatar" style="background:transparent"><img src="${escapeHtml(room.avatarData)}" class="avatar-img" alt=""></div>`
      : `<div class="avatar" style="background:${color}">${room.name[0].toUpperCase()}</div>`;
    const isProtected = room.hasPassword;
    const lockHtml = isProtected ? '<span style="font-size:13px;margin-left:4px">🔒</span>' : '';
    
    item.innerHTML = `
      ${avatarHtml}
      <div class="chat-item-info">
        <div class="chat-item-top">
          <span class="chat-item-name">${escapeHtml(room.name)}${lockHtml}</span>
          <span class="chat-item-time">${time}</span>
        </div>
        <div class="chat-item-bottom">
          <div class="chat-item-preview">${isProtected ? '🔒 Grupo protegido por senha' : escapeHtml(preview.substring(0, 60))}</div>
          ${badgeHtml}
        </div>
      </div>`;
    item.addEventListener('click', () => openRoom(room));
    el.appendChild(item);
  });
}

async function openRoom(room) {
  // SEMPRE verifica a senha atualizada no backend (não confia no cache)
  try {
    const pwRes = await fetch(`${API}/api/rooms/${room.id}/password-check?_t=${Date.now()}`);
    if (pwRes.ok) {
      const pwData = await pwRes.json();
      room.hasPassword = pwData.hasPassword;
    }
  } catch {}

  // Se o grupo tem senha, pede a senha pra todo mundo (inclusive membros)
  if (room.hasPassword) {
    openPasswordModal(room.id, room.name);
    return;
  }

  currentRoomId = room.id;
  cancelReply();
  cancelEdit();
  unreadCounts[room.id] = 0;
  updateTitle();
  const badge = document.querySelector(`.chat-item[data-room-id="${room.id}"] .unread-badge`);
  if (badge) badge.remove();
  document.querySelectorAll('.chat-item').forEach(el => {
    el.classList.toggle('active', el.dataset.roomId === room.id);
  });
  $('empty-state').classList.add('hidden');
  $('chat-view').classList.remove('hidden');
  $('chat-search-bar').classList.add('hidden');
  openChat();
  const color = room.avatarColor || avatarColor(room.name);
  const av = $('chat-avatar');
  renderAvatar(av, room.name, color, room.avatarData);
  $('chat-name').textContent = room.name;

  // Tenta usar cache primeiro
  const cached = messagesCache[room.id];
  if (cached && cached.length > 0) {
    renderMessages(cached);
  } else {
    $('messages-container').innerHTML = '<div class="admin-loading" style="padding:40px;text-align:center;color:var(--text-muted)">Carregando...</div>';
  }

  try {
    const res = await fetch(`${API}/api/rooms/${room.id}/messages`);
    if (res.ok) {
      const data = await res.json();
      const msgs = Array.isArray(data) ? data : (data.messages || []);
      messagesCache[room.id] = msgs;
      if (currentRoomId === room.id) renderMessages(msgs);
    }
  } catch {}
}

// ── MESSAGES ──────────────────────────────────────────────
function renderMessages(messages) {
  const container = $('messages-container');
  container.innerHTML = '';
  let lastDate = null;
  messages.forEach(msg => {
    const date = new Date(msg.timestamp).toLocaleDateString('pt-BR');
    if (date !== lastDate) {
      const div = document.createElement('div');
      div.className = 'day-divider';
      div.textContent = date;
      container.appendChild(div);
      lastDate = date;
    }
    container.appendChild(buildBubble(msg));
  });
  scrollToBottom();
}

function buildBubble(msg) {
  const isOut = msg.authorId === currentUser.id;
  const isImage = msg.type === 'image';
  const isFile = msg.type === 'file';
  const isDeleted = msg.deleted;
  const isEdited = msg.edited;
  // Em DM não mostra nome do autor (já é obvio pela posicao do balao)
  const currentRoomIsDM = rooms.find(r => r.id === (currentRoomId || msg.roomId))?.isDM;
  const showAuthor = !isOut && !isDeleted && !currentRoomIsDM;
  const row = document.createElement('div');
  row.className = `message-row ${isOut ? 'out' : 'in'}`;
  row.dataset.msgId = msg.id;
  const time = formatTime(msg.timestamp);
  const color = authorColor(msg.authorName);

  let statusHtml = '';
  if (msg.status === 'sending') {
    // Reloginho de enviando (igual zap)
    statusHtml = `<span class="tick tick-sending"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#667781" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="clock-spin"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>`;
  } else if (msg.read) {
    statusHtml = `<span class="tick tick-read"><svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 6.5L5 10.5L15 0.5" stroke="#53bdeb" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10.5L15 0.5" stroke="#53bdeb" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  } else {
    statusHtml = `<span class="tick"><svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 6.5L5 10.5L15 0.5" stroke="#667781" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10.5L15 0.5" stroke="#667781" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  }

  // Reply quote
  let replyHtml = '';
  if (msg.replyTo) {
    replyHtml = `<div class="bubble-reply" onclick="scrollToMessage('${msg.replyTo.id}')">
      <div class="bubble-reply-line" style="background:${authorColor(msg.replyTo.authorName)}"></div>
      <div class="bubble-reply-content">
        <span class="bubble-reply-author" style="color:${authorColor(msg.replyTo.authorName)}">${escapeHtml(msg.replyTo.authorName)}</span>
        <span class="bubble-reply-text">${escapeHtml(msg.replyTo.content.substring(0, 60))}</span>
      </div>
    </div>`;
  }

  let bubbleContent;
  if (isDeleted) {
    bubbleContent = '<em style="opacity:.5;font-style:italic">Mensagem apagada</em>';
  } else if (isImage) {
    bubbleContent = `<img class="bubble-image" src="${escapeHtml(msg.content)}" alt="imagem" loading="lazy" onclick="openImageModal('${escapeHtml(msg.content)}')">`;
  } else if (isFile) {
    const parsed = (() => { try { return JSON.parse(msg.content); } catch { return null; } })();
    const name = parsed?.name || 'documento';
    const data = parsed?.data || msg.content;
    bubbleContent = `<div class="bubble-file" onclick="downloadFile('${escapeHtml(data)}','${escapeHtml(name)}')">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="#4a5568" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="14 2 14 8 20 8" stroke="#4a5568" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="bubble-file-name">${escapeHtml(name)}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;opacity:.6"><path d="M12 5v14M5 12l7 7 7-7" stroke="#4a5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>`;
  } else {
    bubbleContent = escapeHtml(msg.content);
  }

  // Avatar do autor nas mensagens recebidas (só em grupo, não em DM)
  let authorAvatarHtml = '';
  if (showAuthor) {
    const avColor = authorColor(msg.authorName);
    const hasAvatar = msg.authorAvatarData && msg.authorAvatarData.startsWith('data:image/');
    if (hasAvatar) {
      authorAvatarHtml = `<img class="msg-author-avatar" src="${escapeHtml(msg.authorAvatarData)}" alt="">`;
    } else {
      authorAvatarHtml = `<div class="msg-author-avatar msg-author-avatar-letter" style="background:${avColor}">${escapeHtml(msg.authorName[0]).toUpperCase()}</div>`;
    }
  }

  row.innerHTML = `${showAuthor ? `<div class="message-author-info">${authorAvatarHtml}<span class="message-author" style="color:${color}">${escapeHtml(msg.authorName)}</span></div>` : ''}
    <div class="bubble" ${!isDeleted ? `oncontextmenu="openContextMenu(event,'${msg.id}','${isOut}')" ontouchstart="onBubbleTouchStart(event,'${msg.id}','${isOut}')" ontouchend="onBubbleTouchEnd()"` : ''}>
      ${replyHtml}
      ${bubbleContent}
      <div class="bubble-meta">
        <span class="bubble-time">${time}${isEdited ? ' <span style="font-size:10px;opacity:.6">editado</span>' : ''}</span>
        ${isOut && !isDeleted ? statusHtml : ''}
      </div>
    </div>`;

  return row;
}

function appendMessage(msg) {
  const container = $('messages-container');
  const lastDate = container.lastChild?.classList?.contains('day-divider') ? container.lastChild.textContent : null;
  const date = new Date(msg.timestamp).toLocaleDateString('pt-BR');
  if (date !== lastDate) {
    const div = document.createElement('div');
    div.className = 'day-divider';
    div.textContent = date;
    container.appendChild(div);
  }
  container.appendChild(buildBubble(msg));
  checkScrollBottom();
}

function scrollToMessage(msgId) {
  const el = document.querySelector(`.message-row[data-msg-id="${msgId}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── CONTEXT MENU ──────────────────────────────────────────
function openContextMenu(e, msgId, isOut) {
  e.preventDefault();
  closeContextMenu();
  const menu = $('msg-context-menu');
  contextMsgId = msgId;
  $('msg-reply-btn').style.display = 'flex';
  $('msg-copy-btn').style.display = 'flex';
  $('msg-edit-btn').style.display = isOut === 'true' && !$(msgId)?._deleted ? 'flex' : 'none';
  $('msg-delete-btn').style.display = isOut === 'true' ? 'flex' : 'none';
  const x = Math.min(e.clientX, window.innerWidth - 210);
  const y = Math.min(e.clientY, window.innerHeight - 180);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.remove('hidden');
}

function closeContextMenu() {
  $('msg-context-menu').classList.add('hidden');
  contextMsgId = null;
}

$('msg-reply-btn').addEventListener('click', () => {
  if (!contextMsgId) return;
  startReply(contextMsgId);
  closeContextMenu();
});

$('msg-copy-btn').addEventListener('click', () => {
  if (!contextMsgId) return;
  const row = document.querySelector(`.message-row[data-msg-id="${contextMsgId}"]`);
  const text = row?.querySelector('.bubble')?.textContent?.trim();
  if (text) {
    navigator.clipboard.writeText(text).catch(() => {});
    showToast('Copiado!');
  }
  closeContextMenu();
});

$('msg-edit-btn').addEventListener('click', () => {
  if (!contextMsgId) return;
  startEdit(contextMsgId);
  closeContextMenu();
});

$('msg-delete-btn').addEventListener('click', async () => {
  if (!contextMsgId || !currentRoomId) return;
  const ok = await showConfirm('Excluir esta mensagem?');
  if (!ok) return;
  ws.send(JSON.stringify({ type: 'delete_message', messageId: contextMsgId, roomId: currentRoomId }));
  closeContextMenu();
});

// fechar contexto ao clicar fora
document.addEventListener('click', e => {
  if (!e.target.closest('.msg-context-menu') && !e.target.closest('.message-row .bubble')) {
    closeContextMenu();
  }
});

// ── REPLY ─────────────────────────────────────────────────
function startReply(msgId) {
  const row = document.querySelector(`.message-row[data-msg-id="${msgId}"]`);
  if (!row) return;
  const author = row.querySelector('.message-author')?.textContent || (row.classList.contains('out') ? currentUser.username : '');
  const text = row.querySelector('.bubble')?.textContent?.trim() || '';
  replyToMsg = { id: msgId, authorName: author, content: text.substring(0, 80) };
  $('reply-preview-author').textContent = author;
  $('reply-preview-text').textContent = text.substring(0, 80);
  $('reply-preview').classList.remove('hidden');
  $('message-input').focus();
}

function cancelReply() {
  replyToMsg = null;
  $('reply-preview').classList.add('hidden');
}

$('reply-preview-close').addEventListener('click', cancelReply);

// ── EDIT ──────────────────────────────────────────────────
function startEdit(msgId) {
  const row = document.querySelector(`.message-row[data-msg-id="${msgId}"]`);
  if (!row) return;
  const text = row.querySelector('.bubble')?.textContent?.trim() || '';
  editingMsgId = msgId;
  $('message-input').value = text;
  $('message-input').focus();
  $('input-wrapper').classList.add('editing');
  // Mudar placeholder
  $('message-input').placeholder = 'Editar mensagem...';
}

function cancelEdit() {
  editingMsgId = null;
  $('message-input').value = '';
  $('input-wrapper').classList.remove('editing');
  $('message-input').placeholder = 'Mensagem';
}

// ── SEND ──────────────────────────────────────────────────
$('send-btn').addEventListener('click', sendMessage);
$('message-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

function sendMessage() {
  const input = $('message-input');
  const content = input.value.trim();
  if (!content || !currentRoomId) return;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    input.style.transition = 'box-shadow .15s';
    input.style.boxShadow = '0 0 0 2px rgba(229,57,53,.45)';
    input.placeholder = 'Sem conexão…';
    setTimeout(() => {
      input.style.boxShadow = '';
      input.placeholder = editingMsgId ? 'Editar mensagem...' : 'Mensagem';
    }, 1800);
    return;
  }

  if (editingMsgId) {
    ws.send(JSON.stringify({ type: 'edit_message', messageId: editingMsgId, roomId: currentRoomId, content }));
    cancelEdit();
    return;
  }

  const pendingId = 'pending_' + Date.now();

  // Guarda no array de pending (pra reenviar se cair)
  const pendingEntry = { id: pendingId, roomId: currentRoomId, content, replyTo: replyToMsg ? replyToMsg.id : null };
  pendingMessages.push(pendingEntry);

  const payload = { type: 'send_message', roomId: currentRoomId, content, _pendingId: pendingId };
  if (replyToMsg) {
    payload.replyTo = replyToMsg.id;
  }
  ws.send(JSON.stringify(payload));

  // Mensagem com status 'sending' (vai mostrar reloginho igual zap)
  const pendingMsg = {
    id: pendingId,
    roomId: currentRoomId,
    authorId: currentUser.id,
    authorName: currentUser.username,
    content,
    type: 'text',
    timestamp: new Date().toISOString(),
    deleted: false,
    edited: false,
    status: 'sending'
  };
  if (replyToMsg) {
    pendingMsg.replyTo = replyToMsg;
  }
  appendMessage(pendingMsg);
  updateRoomPreview(pendingMsg);
  cancelReply();
  input.value = '';
  input.focus();
}

// ── TYPING INDICATOR ─────────────────────────────────────
let typingTimeout = null;

let typingDebounce = null;
let typingLastSent = 0;

$('message-input').addEventListener('input', () => {
  if (!currentRoomId || !ws || ws.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  if (typingDebounce) clearTimeout(typingDebounce);
  // Só envia se passou 2s desde o último envio
  if (now - typingLastSent > 2000) {
    ws.send(JSON.stringify({ type: 'typing', roomId: currentRoomId }));
    typingLastSent = now;
  }
  typingDebounce = setTimeout(() => {
    typingLastSent = 0;
  }, 3000);
});

// ── WEBSOCKET ─────────────────────────────────────────────
let wsRetryDelay = 1000;

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  try {
    ws = new WebSocket(`${proto}://${location.host}/ws`);
  } catch (err) {
    setTimeout(connectWebSocket, wsRetryDelay);
    wsRetryDelay = Math.min(wsRetryDelay * 2, 15000);
    return;
  }

  ws.addEventListener('open', () => {
    wsRetryDelay = 1000;
    isReconnecting = false;
    // Enviar mensagens pendentes
    const toSend = pendingMessages.splice(0);
    toSend.forEach(p => {
      const payload = { type: 'send_message', roomId: p.roomId, content: p.content };
      if (p.replyTo) payload.replyTo = p.replyTo;
      try { ws.send(JSON.stringify(payload)); } catch(e) {}
    });
  });

  ws.addEventListener('message', e => {
    try {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case 'new_message':
          handleNewMessage(msg.message);
          break;
        case 'message_deleted':
          handleMessageDeleted(msg.messageId, msg.roomId);
          break;
        case 'message_edited':
          handleMessageEdited(msg.messageId, msg.roomId, msg.content);
          break;
        case 'typing_start':
          handleTypingStart(msg.roomId, msg.username);
          break;
        case 'typing_stop':
          handleTypingStop(msg.roomId, msg.username);
          break;
        case 'read_receipt':
          handleReadReceipt(msg.messageId, msg.roomId);
          break;
        case 'presence':
          updatePresence(msg.online);
          break;
        case 'avatar_updated':
          handleAvatarUpdated(msg.userId, msg.avatarData);
          break;
        case 'group_deleted':
          handleGroupDeleted(msg.roomId);
          break;
        case 'password_changed':
          loadRooms();
          break;
      }
    } catch (err) {
      console.warn('WS erro:', err);
    }
  });

  ws.addEventListener('close', () => {
    ws = null;
    isReconnecting = true;
    setTimeout(connectWebSocket, wsRetryDelay);
    wsRetryDelay = Math.min(wsRetryDelay * 2, 15000);
  });
}

let typingUsers = {}; // roomId -> {username: timeout}

function handleTypingStart(roomId, username) {
  if (username === currentUser.username) return;
  if (!typingUsers[roomId]) typingUsers[roomId] = {};
  if (typingUsers[roomId][username]) clearTimeout(typingUsers[roomId][username]);
  typingUsers[roomId][username] = setTimeout(() => {
    handleTypingStop(roomId, username);
  }, 4000);
  updateTypingUI(roomId);
}

function handleTypingStop(roomId, username) {
  if (!typingUsers[roomId]) return;
  if (typingUsers[roomId][username]) {
    clearTimeout(typingUsers[roomId][username]);
    delete typingUsers[roomId][username];
  }
  updateTypingUI(roomId);
}

function updateTypingUI(roomId) {
  const indicator = $('typing-indicator');
  if (roomId !== currentRoomId || !typingUsers[roomId] || Object.keys(typingUsers[roomId]).length === 0) {
    indicator.classList.add('hidden');
    return;
  }
  const names = Object.keys(typingUsers[roomId]);
  let text = '';
  if (names.length === 1) text = `${names[0]} está digitando...`;
  else if (names.length === 2) text = `${names[0]} e ${names[1]} estão digitando...`;
  else text = `${names[0]} e mais ${names.length - 1} estão digitando...`;
  $('typing-text').textContent = text;
  indicator.classList.remove('hidden');
}

async function handleNewMessage(message) {
  // Se for mensagem do próprio usuário: usa _pendingId pra fazer match direto
  if (message.authorId === currentUser.id && message._pendingId) {
    // Remove do array de pendingMessages
    const pendingIdx = pendingMessages.findIndex(p => p.id === message._pendingId);
    if (pendingIdx !== -1) pendingMessages.splice(pendingIdx, 1);

    // Atualiza a row na DOM: troca o ID pending pelo real e o reloginho pelo tick
    const pendingRow = document.querySelector(`.message-row[data-msg-id="${message._pendingId}"]`);
    if (pendingRow) {
      pendingRow.dataset.msgId = message.id;
      const tickEl = pendingRow.querySelector('.tick');
      if (tickEl) {
        tickEl.className = 'tick';
        tickEl.innerHTML = `<svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 6.5L5 10.5L15 0.5" stroke="#667781" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10.5L15 0.5" stroke="#667781" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      }
      return; // Não adiciona de novo
    }
  }

  // Se a sala atual já tem essa mensagem (pelo ID real), ignora
  const existingRow = document.querySelector(`.message-row[data-msg-id="${message.id}"]`);
  if (existingRow) return;

  // Se a sala não existe na sidebar, recarrega a lista primeiro
  const roomItem = document.querySelector(`.chat-item[data-room-id="${message.roomId}"]`);
  if (!roomItem) {
    await loadRooms();
  }

  if (message.roomId === currentRoomId) {
    appendMessage(message);
    if (message.authorId !== currentUser.id) {
      ws.send(JSON.stringify({ type: 'read_receipt', messageId: message.id, roomId: message.roomId }));
      playNotificationSound();
    }
  } else {
    unreadCounts[message.roomId] = (unreadCounts[message.roomId] || 0) + 1;
    askNotifPermission();
    const room = rooms.find(r => r.id === message.roomId);
    const roomName = room ? room.name : 'Nova mensagem';
    const preview = message.content?.substring(0, 60) || (message.type === 'image' ? '📷 Imagem' : message.type === 'file' ? '📄 Documento' : '');
    sendDesktopNotif(message.authorName || roomName, preview, message.roomId);
  }
  updateRoomPreview(message);
  updateTitle();
}

function handleMessageDeleted(messageId, roomId) {
  const row = document.querySelector(`.message-row[data-msg-id="${messageId}"]`);
  if (row) {
    const newRow = buildBubble({ id: messageId, roomId, authorId: row.classList.contains('out') ? currentUser.id : 'outro', authorName: '', content: '', type: 'text', timestamp: new Date().toISOString(), deleted: true });
    row.replaceWith(newRow);
  }
  if (roomId === currentRoomId) {
    updateMessagePreview(roomId);
  }
}

function handleMessageEdited(messageId, roomId, content) {
  const row = document.querySelector(`.message-row[data-msg-id="${messageId}"]`);
  if (!row) return;
  const isOut = row.classList.contains('out');
  const authorId = isOut ? currentUser.id : 'outro';
  const authorName = row.querySelector('.message-author')?.textContent || '';
  // Usar timestamp ISO salvo no dataset ou data atual
  const newRow = buildBubble({ id: messageId, roomId, authorId, authorName, content, type: 'text', timestamp: new Date().toISOString(), edited: true, deleted: false });
  row.replaceWith(newRow);
  if (roomId === currentRoomId) {
    updateMessagePreview(roomId);
  }
}

function handleReadReceipt(messageId, roomId) {
  if (roomId !== currentRoomId) return;
  const row = document.querySelector(`.message-row[data-msg-id="${messageId}"]`);
  if (!row || !row.classList.contains('out')) return;
  const tick = row.querySelector('.tick');
  if (tick) {
    tick.classList.add('tick-read');
    const paths = tick.querySelectorAll('path');
    paths.forEach(p => p.setAttribute('stroke', '#53bdeb'));
  }
}

function updateMessagePreview(roomId) {
  // Re-load room list to update previews
  loadRooms();
}

function updateRoomPreview(message) {
  const item = document.querySelector(`.chat-item[data-room-id="${message.roomId}"]`);
  if (!item) return;
  const preview = item.querySelector('.chat-item-preview');
  const time = item.querySelector('.chat-item-time');
  let txt = message.authorName + ': ';
  if (message.deleted) txt += 'Mensagem apagada';
  else if (message.type === 'image') txt += '📷 Imagem';
  else if (message.type === 'file') txt += '📄 Documento';
  else txt += message.content;
  if (preview) preview.textContent = txt.substring(0, 60);
  if (time) time.textContent = formatRelative(message.timestamp);

  const bottom = item.querySelector('.chat-item-bottom');
  if (!bottom) return;
  let badge = item.querySelector('.unread-badge');
  const count = unreadCounts[message.roomId] || 0;
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'unread-badge';
      bottom.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : count;
  } else if (badge) {
    badge.remove();
  }
}

function handleGroupDeleted(roomId) {
  // Remove a sala da lista
  rooms = rooms.filter(r => r.id !== roomId);
  renderRoomList(rooms);
  // Se a sala atual foi deletada, volta pro empty state
  if (currentRoomId === roomId) {
    currentRoomId = null;
    $('chat-view').classList.add('hidden');
    $('empty-state').classList.remove('hidden');
  }
  showToast('Este grupo foi deletado por um administrador.');
}

function handleAvatarUpdated(userId, avatarData) {
  // Recarrega mensagens pra pegar authorAvatarData atualizado
  const refreshMessages = currentRoomId
    ? fetch(`${API}/api/rooms/${currentRoomId}/messages`).then(r => r.json()).then(msgs => {
        renderMessages(msgs);
      }).catch(() => {})
    : Promise.resolve();
  
  const refreshRooms = loadRooms();

  // Atualiza o header do chat atual se for uma DM com esse usuário
  Promise.all([refreshRooms, refreshMessages]).then(() => {
    if (currentRoomId) {
      const room = rooms.find(r => r.id === currentRoomId);
      if (room && room.isDM && room.members && room.members.includes(userId)) {
        const av = $('chat-avatar');
        const color = room.avatarColor || avatarColor(room.name);
        renderAvatar(av, room.name, color, avatarData);
      }
    }
  });
}

function updatePresence(online) {
  if (!currentRoomId) return;
  const statusEl = $('chat-status');
  if (!statusEl) return;
  const room = rooms.find(r => r.id === currentRoomId);
  if (!room) return;

  if (room.isDM) {
    // Em DM mostra so se a outra pessoa especifica esta online
    const otherId = room.members?.find(id => id !== currentUser.id);
    const otherOnline = online.find(u => u.userId === otherId);
    statusEl.textContent = otherOnline ? 'online' : 'offline';
  } else {
    // Em grupo mostra quantos estao online
    const onlineHere = online.filter(u => u.userId !== currentUser.id && room.members?.includes(u.userId));
    if (onlineHere.length > 0) {
      statusEl.textContent = onlineHere.length === 1 ? `${onlineHere[0].username} online` : `${onlineHere.length} online`;
    } else {
      statusEl.textContent = 'offline';
    }
  }
}

// ── SEARCH CONVERSAS ──────────────────────────────────────
$('search-input').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  renderRoomList(rooms.filter(r => r.name.toLowerCase().includes(q)));
});

// ── SEARCH MENSAGENS ──────────────────────────────────────
$('chat-search-btn').addEventListener('click', () => {
  $('chat-search-bar').classList.toggle('hidden');
  if (!$('chat-search-bar').classList.contains('hidden')) {
    $('chat-search-input').value = '';
    $('chat-search-input').focus();
    searchResults = [];
    searchIndex = -1;
    $('chat-search-count').textContent = '';
  }
});

$('chat-search-close').addEventListener('click', () => {
  $('chat-search-bar').classList.add('hidden');
  clearSearchHighlights();
});

$('chat-search-input').addEventListener('input', async e => {
  const q = e.target.value.trim();
  if (!q || !currentRoomId) {
    searchResults = [];
    searchIndex = -1;
    $('chat-search-count').textContent = '';
    clearSearchHighlights();
    return;
  }
  try {
    const res = await fetch(`${API}/api/rooms/${currentRoomId}/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    searchResults = await res.json();
    searchIndex = searchResults.length - 1; // começa do mais recente
    highlightSearchResults(q);
  } catch {}
});

$('chat-search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (searchResults.length === 0) return;
    if (e.shiftKey) {
      searchIndex = (searchIndex - 1 + searchResults.length) % searchResults.length;
    } else {
      searchIndex = (searchIndex + 1) % searchResults.length;
    }
    highlightSearchResults($('chat-search-input').value.trim());
    const msgId = searchResults[searchIndex]?.id;
    if (msgId) scrollToMessage(msgId);
  }
});

function clearSearchHighlights() {
  document.querySelectorAll('.message-row').forEach(r => r.classList.remove('search-highlight'));
}

function highlightSearchResults(query) {
  clearSearchHighlights();
  searchResults.forEach((r, i) => {
    const row = document.querySelector(`.message-row[data-msg-id="${r.id}"]`);
    if (row) {
      row.classList.add('search-highlight');
      if (i === searchIndex) row.classList.add('search-current');
      else row.classList.remove('search-current');
    }
  });
  const total = searchResults.length;
  const current = searchIndex + 1;
  $('chat-search-count').textContent = total > 0 ? `${current}/${total}` : '';
}

// ── SCROLL TO BOTTOM ──────────────────────────────────────
function scrollToBottom() {
  const area = $('messages-area');
  area.scrollTop = area.scrollHeight;
}

function checkScrollBottom() {
  const area = $('messages-area');
  const isAtBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 100;
  if (isAtBottom) {
    scrollToBottom();
    $('scroll-down-btn').classList.add('hidden');
  } else {
    const badge = $('scroll-down-badge');
    const count = parseInt(badge.textContent) || 0;
    badge.textContent = count + 1;
    $('scroll-down-btn').classList.remove('hidden');
  }
}

$('messages-area').addEventListener('scroll', () => {
  const area = $('messages-area');
  const isAtBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 100;
  if (isAtBottom) {
    $('scroll-down-btn').classList.add('hidden');
    $('scroll-down-badge').textContent = '';
  }
});

$('scroll-down-btn').addEventListener('click', () => {
  $('scroll-down-badge').textContent = '';
  $('scroll-down-btn').classList.add('hidden');
  scrollToBottom();
});

// ── EMOJI PICKER ──────────────────────────────────────────
let emojiPickerOpen = false;
let emojiPickerEl = null;

$('message-input').addEventListener('input', e => {
  // Mostrar emoji picker quando digitar ":"
  // (implementação simplificada - mostra picker ao clicar em botão)
});

// Adiciona botão de emoji no input
function addEmojiBtn() {
  const wrapper = $('input-wrapper');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'emoji-btn';
  btn.innerHTML = '😊';
  btn.title = 'Emoji';
  btn.addEventListener('click', e => {
    e.stopPropagation();
    toggleEmojiPicker(btn);
  });
  wrapper.insertBefore(btn, wrapper.firstChild);
}

function toggleEmojiPicker(anchor) {
  if (emojiPickerOpen) {
    closeEmojiPicker();
    return;
  }
  emojiPickerOpen = true;
  if (emojiPickerEl) emojiPickerEl.remove();

  emojiPickerEl = document.createElement('div');
  emojiPickerEl.className = 'emoji-picker';
  const rect = anchor.getBoundingClientRect();
  emojiPickerEl.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  emojiPickerEl.style.left = Math.max(8, rect.left) + 'px';

  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  EMOJIS.forEach(emoji => {
    const span = document.createElement('span');
    span.className = 'emoji-item';
    span.textContent = emoji;
    span.addEventListener('click', () => {
      insertEmoji(emoji);
      closeEmojiPicker();
    });
    grid.appendChild(span);
  });
  emojiPickerEl.appendChild(grid);
  document.body.appendChild(emojiPickerEl);
}

function closeEmojiPicker() {
  emojiPickerOpen = false;
  if (emojiPickerEl) {
    emojiPickerEl.remove();
    emojiPickerEl = null;
  }
}

function insertEmoji(emoji) {
  const input = $('message-input');
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const text = input.value;
  input.value = text.substring(0, start) + emoji + text.substring(end);
  input.selectionStart = input.selectionEnd = start + emoji.length;
  input.focus();
}

document.addEventListener('click', e => {
  if (emojiPickerOpen && emojiPickerEl && !emojiPickerEl.contains(e.target) && !e.target.closest('.emoji-btn')) {
    closeEmojiPicker();
  }
});

// ── CONFIRM MODAL ─────────────────────────────────────────
let confirmResolve = null;

function showConfirm(msg) {
  return new Promise(resolve => {
    confirmResolve = resolve;
    $('confirm-msg').textContent = msg;
    $('confirm-overlay').classList.remove('hidden');
  });
}

function closeConfirm(result) {
  $('confirm-overlay').classList.add('hidden');
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

$('confirm-ok-btn').addEventListener('click', () => closeConfirm(true));
$('confirm-cancel-btn').addEventListener('click', () => closeConfirm(false));

// ── TOAST ─────────────────────────────────────────────────
function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2000);
}

// ── AVATAR HELPER ────────────────────────────────────────
function renderAvatar(el, name, color, imgData) {
  if (imgData && imgData.startsWith('data:image/')) {
    el.innerHTML = `<img src="${escapeHtml(imgData)}" class="avatar-img" alt="">`;
    el.style.background = 'transparent';
    el.style.color = 'transparent';
  } else {
    el.textContent = name[0].toUpperCase();
    el.style.background = color;
    el.style.color = '#fff';
    el.innerHTML = name[0].toUpperCase();
  }
}

// ── UTILS ─────────────────────────────────────────────────
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── MOBILE LONG-PRESS (context menu) ─────────────────────
let touchTimer = null;

function onBubbleTouchStart(e, msgId, isOut) {
  touchTimer = setTimeout(() => {
    touchTimer = null;
    // Mostra contexto como right-click
    const touch = e.touches[0];
    openContextMenu({ preventDefault: () => {}, clientX: touch.clientX, clientY: touch.clientY }, msgId, isOut);
    navigator.vibrate?.(20);
  }, 500);
}

function onBubbleTouchEnd() {
  if (touchTimer) {
    clearTimeout(touchTimer);
    touchTimer = null;
  }
}

// ── MOBILE SCROLL LOCK ────────────────────────────────────
document.addEventListener('touchmove', function(e) {
  let el = e.target; let canScroll = false;
  while (el && el !== document.body) {
    const ov = window.getComputedStyle(el).overflowY;
    if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight) { canScroll = true; break; }
    el = el.parentElement;
  }
  if (!canScroll) e.preventDefault();
}, { passive: false });

document.body.addEventListener('touchstart', function(e) {
  if (e.target === document.body || e.target === document.documentElement) e.preventDefault();
}, { passive: false });

$('attach-btn').addEventListener('touchstart', e => e.stopPropagation(), { passive: true });

// ── MENU DO CLIPE ────────────────────────────────────────
const attachBtn = $('attach-btn');
const attachMenu = $('attach-menu');

function toggleAttachMenu(e) {
  e.stopPropagation();
  e.preventDefault();
  attachMenu.classList.toggle('hidden');
}

attachBtn.addEventListener('click', toggleAttachMenu);
attachBtn.addEventListener('touchend', toggleAttachMenu);

document.addEventListener('click', e => {
  if (!attachMenu.classList.contains('hidden') && !attachMenu.contains(e.target) && e.target !== attachBtn) {
    attachMenu.classList.add('hidden');
  }
});
document.addEventListener('touchend', e => {
  if (!attachMenu.classList.contains('hidden') && !attachMenu.contains(e.target) && e.target !== attachBtn) {
    attachMenu.classList.add('hidden');
  }
});

function triggerImageUpload(e) {
  e.stopPropagation();
  attachMenu.classList.add('hidden');
  $('image-file-input').click();
}
$('attach-image-btn').addEventListener('click', triggerImageUpload);
$('attach-image-btn').addEventListener('touchend', triggerImageUpload);

function triggerDocUpload(e) {
  e.stopPropagation();
  attachMenu.classList.add('hidden');
  $('doc-file-input').click();
}
$('attach-doc-btn').addEventListener('click', triggerDocUpload);
$('attach-doc-btn').addEventListener('touchend', triggerDocUpload);

$('image-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !currentRoomId) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const container = $('messages-container');
  const loadingRow = document.createElement('div');
  loadingRow.className = 'message-row out';
  loadingRow.innerHTML = `<div class="bubble"><div class="bubble-uploading"><div class="upload-spinner"></div>Enviando imagem…</div></div>`;
  container.appendChild(loadingRow);
  scrollToBottom();
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const res = await fetch(`${API}/api/upload/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64, mime: file.type })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Falha no upload');
    const url = json.url;
    loadingRow.remove();
    const pendingId = 'pending_' + Date.now();
    pendingMessages.push({ id: pendingId, roomId: currentRoomId, content: url, msgType: 'image', replyTo: null });
    ws.send(JSON.stringify({ type: 'send_message', roomId: currentRoomId, content: url, msgType: 'image', _pendingId: pendingId }));
    const pendingMsg = { id: pendingId, roomId: currentRoomId, authorId: currentUser.id, authorName: currentUser.username, content: url, type: 'image', timestamp: new Date().toISOString(), status: 'sending' };
    appendMessage(pendingMsg);
    updateRoomPreview({ ...pendingMsg, content: '📷 Imagem' });
  } catch (err) {
    loadingRow.remove();
    const errRow = document.createElement('div');
    errRow.className = 'message-row out';
    errRow.innerHTML = `<div class="bubble" style="color:#e53935;font-size:13px">Falha: ${escapeHtml(err.message)}</div>`;
    container.appendChild(errRow);
    scrollToBottom();
    setTimeout(() => errRow.remove(), 6000);
  }
});

// ── START ─────────────────────────────────────────────────
init();
addEmojiBtn();

// ── MODAL NOVA CONVERSA ───────────────────────────────────
let foundUser = null;

function openNewChatModal() {
  foundUser = null;
  $('modal-search').classList.remove('hidden');
  $('modal-found').classList.add('hidden');
  $('modal-username-input').value = '';
  $('modal-search-error').classList.add('hidden');
  $('modal-search-error').textContent = '';
  $('modal-overlay').classList.remove('hidden');
  setTimeout(() => $('modal-username-input').focus(), 80);
}

function closeModal() {
  $('modal-overlay').classList.add('hidden');
  foundUser = null;
}

$('new-chat-btn').addEventListener('click', openNewChatModal);
$('search-new-chat-btn').addEventListener('click', openNewChatModal);

$('modal-overlay').addEventListener('click', e => {
  if (e.target === $('modal-overlay')) closeModal();
});
$('modal-close-btn').addEventListener('click', closeModal);
$('modal-found-close-btn').addEventListener('click', closeModal);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeProfileModal();
    closeCustomizeModal();
    closeGroupModal();
    closeEditGroupModal();
    closeGroupMembersModal();
    closePasswordModal();
    closeConfirm(false);
    closeEmojiPicker();
    if (editingMsgId) cancelEdit();
  }
});

$('modal-search-btn').addEventListener('click', searchUser);
$('modal-username-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchUser();
});

async function searchUser() {
  const raw = $('modal-username-input').value.trim();
  const username = raw.replace(/^@\s*[-–—]?\s*/, '').trim();
  const errorEl = $('modal-search-error');
  errorEl.classList.add('hidden');
  if (!username) {
    errorEl.textContent = 'Digite um nome de usuário.';
    errorEl.classList.remove('hidden');
    return;
  }
  const btn = $('modal-search-btn');
  btn.textContent = 'Procurando…';
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/api/users/search?username=${encodeURIComponent(username)}`);
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Usuário não encontrado.';
      errorEl.classList.remove('hidden');
      return;
    }
    foundUser = data;
    const av = $('modal-found-avatar');
    if (data.avatarData && data.avatarData.startsWith('data:image/')) {
      av.innerHTML = `<img src="${escapeHtml(data.avatarData)}" class="avatar-img" alt="">`;
      av.style.background = 'transparent';
    } else {
      av.textContent = data.username[0].toUpperCase();
      av.style.background = data.avatarColor || avatarColor(data.username);
    }
    $('modal-found-name').textContent = data.username;
    $('modal-search').classList.add('hidden');
    $('modal-found').classList.remove('hidden');
  } catch {
    errorEl.textContent = 'Erro de conexão.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.textContent = 'Procurar';
    btn.disabled = false;
  }
}

$('modal-start-btn').addEventListener('click', async () => {
  if (!foundUser) return;
  const btn = $('modal-start-btn');
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="margin-right:8px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Iniciando…`;
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/api/rooms/dm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: foundUser.id })
    });
    if (!res.ok) { const err = await res.json(); alert(err.error || 'Erro'); return; }
    const room = await res.json();
    const idx = rooms.findIndex(r => r.id === room.id);
    if (idx === -1) rooms.unshift(room); else rooms[idx] = room;
    renderRoomList(rooms);
    closeModal();
    openRoom(room);
  } catch { alert('Erro de conexão.'); }
  finally {
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="margin-right:8px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Iniciar Conversa`;
    btn.disabled = false;
  }
});

// ── MODAL NOVO GRUPO ─────────────────────────────────────
let groupUsers = [];
let selectedGroupMembers = [];

function openGroupModal() {
  selectedGroupMembers = [];
  $('group-name-input').value = '';
  $('group-member-filter').value = '';
  $('group-modal-error').classList.add('hidden');
  $('group-modal-error').textContent = '';
  $('group-modal-overlay').classList.remove('hidden');
  loadGroupUsers();
  setTimeout(() => $('group-name-input').focus(), 80);
}

function closeGroupModal() {
  $('group-modal-overlay').classList.add('hidden');
}

$('group-modal-close').addEventListener('click', closeGroupModal);
$('group-modal-overlay').addEventListener('click', e => {
  if (e.target === $('group-modal-overlay')) closeGroupModal();
});

async function loadGroupUsers() {
  try {
    const res = await fetch(`${API}/api/users`);
    if (!res.ok) return;
    groupUsers = await res.json();
    renderGroupUsers(groupUsers);
  } catch {}
}

function renderGroupUsers(list) {
  const el = $('group-user-list');
  el.innerHTML = '';
  // Filtra o proprio usuario
  const filtered = list.filter(u => u.id !== currentUser.id);
  if (filtered.length === 0) {
    el.innerHTML = '<div class="admin-loading" style="padding:20px">Nenhum outro usuário encontrado.</div>';
    return;
  }
  filtered.forEach(u => {
    const item = document.createElement('div');
    item.className = 'group-user-item' + (selectedGroupMembers.includes(u.id) ? ' selected' : '');
    const avColor = u.avatarColor || avatarColor(u.username);
    const avatarHtml = u.avatarData && u.avatarData.startsWith('data:image/')
      ? `<div class="avatar" style="background:transparent"><img src="${escapeHtml(u.avatarData)}" class="avatar-img" alt=""></div>`
      : `<div class="avatar" style="background:${avColor}">${u.username[0].toUpperCase()}</div>`;
    item.innerHTML = `
      ${avatarHtml}
      <span class="group-user-name">${escapeHtml(u.username)}</span>
      <div class="group-user-check">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>`;
    item.dataset.userId = u.id;
    item.addEventListener('click', () => toggleGroupMember(u.id));
    el.appendChild(item);
  });
}

function toggleGroupMember(userId) {
  const idx = selectedGroupMembers.indexOf(userId);
  if (idx === -1) {
    selectedGroupMembers.push(userId);
  } else {
    selectedGroupMembers.splice(idx, 1);
  }
  // So alterna a classe visual sem re-renderizar tudo
  const item = document.querySelector(`.group-user-item[data-user-id="${userId}"]`);
  if (item) item.classList.toggle('selected');
}

// Filtro de usuarios no modal de grupo
$('group-member-filter').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = q ? groupUsers.filter(u => u.username.toLowerCase().includes(q)) : groupUsers;
  renderGroupUsers(filtered);
});

$('group-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('group-create-btn').click();
});

$('group-create-btn').addEventListener('click', async () => {
  const name = $('group-name-input').value.trim();
  const errorEl = $('group-modal-error');
  errorEl.classList.add('hidden');

  if (!name) {
    errorEl.textContent = 'Digite um nome para o grupo.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (selectedGroupMembers.length === 0) {
    errorEl.textContent = 'Selecione pelo menos um participante.';
    errorEl.classList.remove('hidden');
    return;
  }

  const btn = $('group-create-btn');
  btn.textContent = 'Criando…';
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/api/rooms/group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, members: selectedGroupMembers })
    });

    if (!res.ok) {
      const err = await res.json();
      errorEl.textContent = err.error || 'Erro ao criar grupo.';
      errorEl.classList.remove('hidden');
      return;
    }

    const room = await res.json();
    rooms.unshift(room);
    renderRoomList(rooms);
    closeGroupModal();
    openRoom(room);
    showToast(`Grupo "${room.name}" criado!`);
  } catch {
    errorEl.textContent = 'Erro de conexão.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.textContent = 'Criar Grupo';
    btn.disabled = false;
  }
});

// ── MODAL EDITAR GRUPO ────────────────────────────────────
let editGroupRoomId = null;
let editGroupAvatarData = null;

function openEditGroupModal(room) {
  editGroupRoomId = room.id;
  editGroupAvatarData = null;
  $('edit-group-title').textContent = `Editar: ${escapeHtml(room.name)}`;
  $('edit-group-name-input').value = room.name;
  $('edit-group-error').classList.add('hidden');
  $('edit-group-error').textContent = '';

  const av = $('edit-group-avatar');
  const color = room.avatarColor || '#4a5568';
  renderAvatar(av, room.name, color, room.avatarData);

  $('edit-group-overlay').classList.remove('hidden');
  setTimeout(() => $('edit-group-name-input').focus(), 80);
}

function closeEditGroupModal() {
  $('edit-group-overlay').classList.add('hidden');
  editGroupRoomId = null;
  editGroupAvatarData = null;
}

$('edit-group-close').addEventListener('click', closeEditGroupModal);
$('edit-group-overlay').addEventListener('click', e => {
  if (e.target === $('edit-group-overlay')) closeEditGroupModal();
});

$('edit-group-avatar-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    editGroupAvatarData = dataUrl;
    const av = $('edit-group-avatar');
    av.innerHTML = `<img src="${escapeHtml(dataUrl)}" class="avatar-img" alt="">`;
    av.style.background = 'transparent';
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

$('edit-group-remove-photo').addEventListener('click', async () => {
  if (!editGroupRoomId) return;
  const btn = $('edit-group-save-btn');
  btn.textContent = 'Salvando…';
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/api/rooms/${editGroupRoomId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('edit-group-name-input').value.trim(), avatarData: null })
    });
    if (!res.ok) {
      const err = await res.json();
      $('edit-group-error').textContent = err.error || 'Erro';
      $('edit-group-error').classList.remove('hidden');
      return;
    }
    closeEditGroupModal();
    const roomIdx = rooms.findIndex(r => r.id === editGroupRoomId);
    if (roomIdx !== -1) {
      rooms[roomIdx].avatarData = null;
    }
    renderRoomList(rooms);
    if (currentRoomId === editGroupRoomId) {
      const room = rooms.find(r => r.id === currentRoomId);
      if (room) {
        renderAvatar($('chat-avatar'), room.name, room.avatarColor || '#4a5568', null);
      }
    }
    showToast('Foto removida!');
  } catch {
    $('edit-group-error').textContent = 'Erro de conexão.';
    $('edit-group-error').classList.remove('hidden');
  } finally {
    btn.textContent = 'Salvar';
    btn.disabled = false;
  }
});

$('edit-group-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('edit-group-save-btn').click();
});

// ── DELETAR GRUPO ───────────────────────────────────────
$('edit-group-delete-btn').addEventListener('click', async () => {
  if (!editGroupRoomId) return;
  const room = rooms.find(r => r.id === editGroupRoomId);
  const roomName = room?.name || 'este grupo';
  const ok = await showConfirm(`Tem certeza que deseja deletar "${roomName}"? Todos os membros perderão acesso e as mensagens serão apagadas.`);
  if (!ok) return;

  const btn = $('edit-group-delete-btn');
  btn.textContent = 'Deletando…';
  btn.disabled = true;

  try {
    const roomId = editGroupRoomId;

    const res = await fetch(`${API}/api/rooms/${roomId}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || 'Erro ao deletar grupo');
      btn.textContent = 'Deletar Grupo';
      btn.disabled = false;
      return;
    }

    closeEditGroupModal();
    rooms = rooms.filter(r => r.id !== roomId);
    renderRoomList(rooms);

    // Se a sala deletada era a atual, volta pro empty state
    if (currentRoomId === roomId) {
      currentRoomId = null;
      $('chat-view').classList.add('hidden');
      $('empty-state').classList.remove('hidden');
    }

    showToast('Grupo deletado!');
  } catch {
    showToast('Erro de conexão.');
  } finally {
    btn.textContent = 'Deletar Grupo';
    btn.disabled = false;
  }
});

$('edit-group-save-btn').addEventListener('click', async () => {
  if (!editGroupRoomId) return;
  const name = $('edit-group-name-input').value.trim();
  const errorEl = $('edit-group-error');
  errorEl.classList.add('hidden');

  if (!name) {
    errorEl.textContent = 'O nome não pode ficar vazio.';
    errorEl.classList.remove('hidden');
    return;
  }

  const btn = $('edit-group-save-btn');
  btn.textContent = 'Salvando…';
  btn.disabled = true;

  try {
    const body = { name };
    if (editGroupAvatarData) body.avatarData = editGroupAvatarData;

    const res = await fetch(`${API}/api/rooms/${editGroupRoomId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json();
      errorEl.textContent = err.error || 'Erro ao salvar.';
      errorEl.classList.remove('hidden');
      return;
    }

    closeEditGroupModal();
    // Atualiza a sala na lista
    const roomIdx = rooms.findIndex(r => r.id === editGroupRoomId);
    if (roomIdx !== -1) {
      rooms[roomIdx].name = name;
      if (editGroupAvatarData) rooms[roomIdx].avatarData = editGroupAvatarData;
    }
    renderRoomList(rooms);
    // Atualiza o header do chat
    if (currentRoomId === editGroupRoomId) {
      $('chat-name').textContent = name;
      const room = rooms.find(r => r.id === currentRoomId);
      if (room) {
        const color = room.avatarColor || avatarColor(name);
        renderAvatar($('chat-avatar'), name, color, room.avatarData);
      }
    }
    editGroupRoomId = null;
    editGroupAvatarData = null;
    showToast('Grupo atualizado!');
  } catch {
    errorEl.textContent = 'Erro de conexão.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.textContent = 'Salvar';
    btn.disabled = false;
  }
});

// ── MENU TRÊS PONTOS (SIDEBAR HEADER) ────────────────────
const headerMenuBtn = $('header-menu-btn');
const headerDropdown = $('header-dropdown');

headerMenuBtn.addEventListener('click', e => {
  e.stopPropagation();
  const isHidden = headerDropdown.classList.contains('hidden');
  if (isHidden) {
    const rect = headerMenuBtn.getBoundingClientRect();
    headerDropdown.style.top = (rect.bottom + 6) + 'px';
    headerDropdown.style.right = (window.innerWidth - rect.right) + 'px';
  }
  headerDropdown.classList.toggle('hidden');
});

document.addEventListener('click', e => {
  if (!headerDropdown.classList.contains('hidden') && !headerDropdown.contains(e.target) && e.target !== headerMenuBtn) {
    headerDropdown.classList.add('hidden');
  }
});

headerDropdown.querySelectorAll('.dropdown-item').forEach(item => {
  item.addEventListener('click', () => headerDropdown.classList.add('hidden'));
});

// ── PAINEL ADMIN ──────────────────────────────────────────
const adminPanelBtn = $('dropdown-admin-btn');
if (adminPanelBtn) {
  adminPanelBtn.addEventListener('click', () => {
    if (currentUser && currentUser.isAdmin) {
      showAdminScreen(currentUser);
    }
  });
}

// Mostra/esconde botao admin e novo grupo no dropdown conforme usuario
function updateAdminDropdownVisibility() {
  const btn = $('dropdown-admin-btn');
  if (btn) {
    if (currentUser && currentUser.isAdmin) {
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }
  const groupBtn = $('dropdown-group-btn');
  if (groupBtn) {
    if (currentUser && currentUser.isAdmin) {
      groupBtn.classList.remove('hidden');
    } else {
      groupBtn.classList.add('hidden');
    }
  }
}

// ── PERFIL ────────────────────────────────────────────────
$('dropdown-profile-btn').addEventListener('click', () => openProfileModal());
$('dropdown-settings-btn')?.addEventListener('click', () => openProfileModal());

function openProfileModal() {
  if (!currentUser) return;
  const av = $('profile-avatar');
  avatarUploadData = null;
  renderAvatar(av, currentUser.username, currentUser.avatarColor || avatarColor(currentUser.username), currentUser.avatarData);
  av.style.background = currentUser.avatarData ? 'transparent' : (currentUser.avatarColor || avatarColor(currentUser.username));
  $('profile-username').value = currentUser.username;
  $('profile-error').classList.add('hidden');
  $('profile-modal-overlay').classList.remove('hidden');
  setTimeout(() => $('profile-username').focus(), 80);
}

function closeProfileModal() {
  $('profile-modal-overlay').classList.add('hidden');
}

$('profile-modal-close').addEventListener('click', closeProfileModal);

$('profile-modal-overlay').addEventListener('click', e => {
  if (e.target === $('profile-modal-overlay')) closeProfileModal();
});

let avatarUploadData = null;

$('profile-avatar-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    avatarUploadData = dataUrl;
    const av = $('profile-avatar');
    av.innerHTML = `<img src="${escapeHtml(dataUrl)}" class="avatar-img" alt="">`;
    av.style.background = 'transparent';
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

$('profile-save-btn').addEventListener('click', async () => {
  const username = $('profile-username').value.trim();
  const errorEl = $('profile-error');
  errorEl.classList.add('hidden');
  const btn = $('profile-save-btn');
  btn.textContent = 'Salvando…';
  btn.disabled = true;
  try {
    const body = {};
    if (username && username.length >= 3) body.username = username;
    if (avatarUploadData) body.avatar = avatarUploadData;
    if (Object.keys(body).length === 0) {
      errorEl.textContent = 'Nada para salvar.';
      errorEl.classList.remove('hidden');
      return;
    }
    const res = await fetch(`${API}/api/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json();
      errorEl.textContent = err.error || 'Erro ao salvar.';
      errorEl.classList.remove('hidden');
      return;
    }
    const updated = await res.json();
    currentUser = updated;
    showToast('Perfil atualizado!');
    closeProfileModal();
    loadRooms();
  } catch {
    errorEl.textContent = 'Erro de conexão.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.textContent = 'Salvar';
    btn.disabled = false;
  }
});

$('profile-username').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('profile-save-btn').click();
});

// ── MENU TRÊS PONTOS DO CHAT ──────────────────────────────
const chatMenuBtn = $('chat-menu-btn');
const chatDropdown = $('chat-dropdown');

chatMenuBtn.addEventListener('click', e => {
  e.stopPropagation();
  const isHidden = chatDropdown.classList.contains('hidden');
  if (isHidden) {
    const rect = chatMenuBtn.getBoundingClientRect();
    chatDropdown.style.top = (rect.bottom + 6) + 'px';
    chatDropdown.style.right = (window.innerWidth - rect.right) + 'px';
  }
  chatDropdown.classList.toggle('hidden');
});

document.addEventListener('click', e => {
  if (!chatDropdown.classList.contains('hidden') && !chatDropdown.contains(e.target) && e.target !== chatMenuBtn) {
    chatDropdown.classList.add('hidden');
  }
});

chatDropdown.querySelectorAll('.dropdown-item').forEach(item => {
  item.addEventListener('click', () => chatDropdown.classList.add('hidden'));
});

// ── LIMPAR CONVERSA ───────────────────────────────────────
$('clear-chat-btn').addEventListener('click', async () => {
  if (!currentRoomId) return;
  const ok = await showConfirm('Tem certeza que deseja limpar as mensagens?');
  if (!ok) return;
  const res = await fetch(`${API}/api/rooms/${currentRoomId}/messages`, { method: 'DELETE' });
  if (res.ok) {
    $('messages-container').innerHTML = '';
    showToast('Conversa limpa!');
  }
});

// ── MODAL DE IMAGEM ───────────────────────────────────────
let imgModalZoom = 1;
const IMG_ZOOM_STEP = 0.25;
const IMG_ZOOM_MIN = 0.5;
const IMG_ZOOM_MAX = 3;

function openImageModal(src) {
  imgModalZoom = 1;
  const modal = $('image-modal');
  const img = $('img-modal-img');
  img.src = src;
  img.style.transform = 'scale(1)';
  $('img-modal-zoom-label').textContent = '100%';
  $('img-modal-download').dataset.src = src;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeImageModal() {
  $('image-modal').classList.add('hidden');
  $('img-modal-img').src = '';
  document.body.style.overflow = '';
}

function setImageZoom(z) {
  imgModalZoom = Math.min(IMG_ZOOM_MAX, Math.max(IMG_ZOOM_MIN, z));
  $('img-modal-img').style.transform = `scale(${imgModalZoom})`;
  $('img-modal-zoom-label').textContent = Math.round(imgModalZoom * 100) + '%';
}

$('img-modal-close').addEventListener('click', closeImageModal);
$('image-modal').addEventListener('click', e => { if (e.target === $('image-modal')) closeImageModal(); });
$('img-modal-zoom-in').addEventListener('click', e => { e.stopPropagation(); setImageZoom(imgModalZoom + IMG_ZOOM_STEP); });
$('img-modal-zoom-out').addEventListener('click', e => { e.stopPropagation(); setImageZoom(imgModalZoom - IMG_ZOOM_STEP); });

$('img-modal-download').addEventListener('click', async e => {
  e.stopPropagation();
  const src = e.currentTarget.dataset.src;
  if (!src) return;
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'imagem_' + Date.now() + (blob.type.includes('png') ? '.png' : '.jpg');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch { window.open(src, '_blank'); }
});

document.addEventListener('keydown', e => {
  if (!$('image-modal').classList.contains('hidden')) {
    if (e.key === 'Escape') closeImageModal();
    if (e.key === '+' || e.key === '=') setImageZoom(imgModalZoom + IMG_ZOOM_STEP);
    if (e.key === '-') setImageZoom(imgModalZoom - IMG_ZOOM_STEP);
  }
});

// ── UPLOAD DE DOCUMENTO ───────────────────────────────────
$('doc-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !currentRoomId) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const MAX = 200 * 1024 * 1024;
  if (file.size > MAX) { alert('Máximo 200MB.'); return; }
  const container = $('messages-container');
  const loadingRow = document.createElement('div');
  loadingRow.className = 'message-row out';
  loadingRow.innerHTML = `<div class="bubble"><div class="bubble-uploading"><div class="upload-spinner"></div>Enviando documento…</div></div>`;
  container.appendChild(loadingRow);
  scrollToBottom();
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const dataUrl = `data:${file.type || 'application/octet-stream'};base64,${base64}`;
    const content = JSON.stringify({ name: file.name, data: dataUrl });
    loadingRow.remove();
    const pendingId = 'pending_' + Date.now();
    pendingMessages.push({ id: pendingId, roomId: currentRoomId, content, msgType: 'file', replyTo: null });
    ws.send(JSON.stringify({ type: 'send_message', roomId: currentRoomId, content, msgType: 'file', _pendingId: pendingId }));
    const pendingMsg = { id: pendingId, roomId: currentRoomId, authorId: currentUser.id, authorName: currentUser.username, content, type: 'file', timestamp: new Date().toISOString(), status: 'sending' };
    appendMessage(pendingMsg);
    updateRoomPreview({ ...pendingMsg, content: '📄 ' + file.name });
  } catch (err) {
    loadingRow.remove();
    const errRow = document.createElement('div');
    errRow.className = 'message-row out';
    errRow.innerHTML = `<div class="bubble" style="color:#e53935;font-size:13px">Falha: ${escapeHtml(err.message)}</div>`;
    container.appendChild(errRow);
    scrollToBottom();
    setTimeout(() => errRow.remove(), 6000);
  }
});

function downloadFile(dataUrl, name) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── OLHO DE SENHA ─────────────────────────────────────────
const EYE_OPEN = `<svg class="eye-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8696a0" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF = `<svg class="eye-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8696a0" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function toggleEye(inputId, btn) {
  const input = document.getElementById(inputId);
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.innerHTML = isPassword ? EYE_OFF : EYE_OPEN;
}

function checkPasswordMatch() {
  const p1 = document.getElementById('reg-password').value;
  const p2 = document.getElementById('reg-password2').value;
  const badge = document.getElementById('password-match-badge');
  if (!p2) { badge.classList.add('hidden'); badge.classList.remove('match', 'no-match'); return; }
  badge.classList.remove('hidden');
  if (p1 === p2) {
    badge.classList.add('match');
    badge.classList.remove('no-match');
    badge.textContent = '✓ Correto';
  } else {
    badge.classList.add('no-match');
    badge.classList.remove('match');
    badge.textContent = '✗ Incorreto';
  }
}

// ── MODAL DE MEMBROS DO GRUPO ────────────────────────────
let currentMembersRoom = null;

function openGroupMembersModal(room) {
  if (!room || room.isDM) return;
  currentMembersRoom = room;
  
  $('group-members-title').textContent = room.name;
  $('group-members-count').textContent = `${room.members?.length || 0} participantes`;
  
  // Mostra/esconde botao editar grupo (só admin ou criador do grupo)
  const editBtn = $('group-members-edit-btn');
  const canEdit = currentUser && (currentUser.isAdmin || room.createdBy === currentUser.id);
  if (canEdit) {
    editBtn.classList.remove('hidden');
  } else {
    editBtn.classList.add('hidden');
  }
  
  const listEl = $('group-members-list');
  listEl.innerHTML = '<div class="admin-loading" style="padding:20px">Carregando...</div>';
  
  $('group-members-overlay').classList.remove('hidden');
  
  // Busca dados de todos os usuarios pra mapear IDs
  fetch(`${API}/api/users`)
    .then(r => r.json())
    .then(users => {
      const members = (room.members || []).map(id => {
        const user = users.find(u => u.id === id);
        return user || { id, username: 'Desconhecido', avatarColor: '#666', avatarData: null };
      });
      
      // Admin/criador primeiro
      members.sort((a, b) => {
        if (a.id === room.createdBy) return -1;
        if (b.id === room.createdBy) return 1;
        if (a.isAdmin && !b.isAdmin) return -1;
        if (!a.isAdmin && b.isAdmin) return 1;
        return a.username.localeCompare(b.username);
      });
      
      listEl.innerHTML = '';
      
      if (members.length === 0) {
        listEl.innerHTML = '<div class="admin-loading" style="padding:20px">Nenhum participante.</div>';
        return;
      }
      
      members.forEach(member => {
        const card = document.createElement('div');
        card.className = 'group-member-card';
        
        const avColor = member.avatarColor || avatarColor(member.username);
        const hasAvatar = member.avatarData && member.avatarData.startsWith('data:image/');
        
        let avatarHtml;
        if (hasAvatar) {
          avatarHtml = `<div class="avatar" style="background:transparent"><img src="${escapeHtml(member.avatarData)}" class="avatar-img" alt=""></div>`;
        } else {
          avatarHtml = `<div class="avatar" style="background:${avColor}">${member.username[0].toUpperCase()}</div>`;
        }
        
        let roleHtml = '';
        if (member.id === room.createdBy) {
          roleHtml = '<span class="group-member-badge">Criador</span>';
        } else if (member.isAdmin) {
          roleHtml = '<span class="group-member-badge">Admin</span>';
        }
        
        const isYou = member.id === currentUser.id;
        const nameSuffix = isYou ? ' <span style="color:var(--text-muted);font-weight:400;font-size:13px">(você)</span>' : '';
        
        card.innerHTML = `
          ${avatarHtml}
          <div class="group-member-info">
            <div class="group-member-name">${escapeHtml(member.username)}${nameSuffix}</div>
          </div>
          ${roleHtml}
        `;
        listEl.appendChild(card);
      });
    })
    .catch(() => {
      listEl.innerHTML = '<div class="admin-loading" style="color:#e53935;padding:20px">Erro ao carregar participantes.</div>';
    });
}

function closeGroupMembersModal() {
  $('group-members-overlay').classList.add('hidden');
  $('group-members-list').innerHTML = '';
  currentMembersRoom = null;
}

$('group-members-close').addEventListener('click', closeGroupMembersModal);
$('group-members-overlay').addEventListener('click', e => {
  if (e.target === $('group-members-overlay')) closeGroupMembersModal();
});

// Botao editar grupo dentro do modal de membros
$('group-members-edit-btn').addEventListener('click', () => {
  const room = currentMembersRoom;
  if (!room) return;
  // Fecha o modal de membros sem perder a referencia da sala
  $('group-members-overlay').classList.add('hidden');
  $('group-members-list').innerHTML = '';
  currentMembersRoom = null;
  openEditGroupModal(room);
});

// ── CLICK NO HEADER DO CHAT (perfil / membros do grupo) ─────
$('chat-header-info').addEventListener('click', () => {
  console.log('CLICOU NO HEADER DO CHAT');
  console.log('currentRoomId:', currentRoomId);
  const room = rooms.find(r => r.id === currentRoomId);
  console.log('room encontrada:', room);
  console.log('room.isDM:', room?.isDM);
  console.log('room.members:', room?.members);
  if (!room) {
    console.log('room nao encontrada, retornando');
    return;
  }
  if (room.isDM) {
    console.log('é DM, mostrando toast');
    showToast(room.name);
    return;
  }
  // Grupo — mostra a lista de membros (igual zap)
  console.log('vai abrir modal de membros');
  openGroupMembersModal(room);
});

// ═══════════════════════════════════════════════════════════
//   DARK MODE & PERSONALIZACAO
// ═══════════════════════════════════════════════════════════

// ── CHAVE DO LOCAL STORAGE ────────────────────────────────
const LS_THEME = 'speedchat_theme';
const LS_BG_COLOR = 'speedchat_bg_color';
const LS_BG_IMAGE = 'speedchat_bg_image';
const LS_BUBBLE = 'speedchat_bubble_color';
const LS_ACCENT = 'speedchat_accent_color';

// ── APLICAR TEMA SALVO ────────────────────────────────────
function loadTheme() {
  const theme = localStorage.getItem(LS_THEME);
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const toggle = $('customize-dark-toggle');
    if (toggle) toggle.checked = true;
    updateThemeBtnText(true);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function updateThemeBtnText(isDark) {
  const span = $('theme-btn-text');
  if (span) {
    span.textContent = isDark ? 'Tema Claro' : 'Tema Escuro';
    const svgEl = span.closest('.dropdown-item')?.querySelector('svg');
    if (svgEl) {
      if (isDark) {
        svgEl.innerHTML = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/><circle cx="12" cy="12" r="5"/>';
      } else {
        svgEl.innerHTML = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
      }
    }
  }
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(LS_THEME, 'light');
    const toggle = $('customize-dark-toggle');
    if (toggle) toggle.checked = false;
    updateThemeBtnText(false);
    // Restaura fundo personalizado se existir
    const bgColor = localStorage.getItem(LS_BG_COLOR);
    const bgImage = localStorage.getItem(LS_BG_IMAGE);
    if (bgColor) applyBgColor(bgColor);
    else if (bgImage) applyBgImage(bgImage);
    else {
      // Volta fundo padrao claro
      const msgsArea = $('messages-area');
      if (msgsArea) {
        msgsArea.style.background = '';
        msgsArea.style.backgroundImage = '';
      }
    }
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem(LS_THEME, 'dark');
    const toggle = $('customize-dark-toggle');
    if (toggle) toggle.checked = true;
    updateThemeBtnText(true);
    // Remove estilos inline de fundo pra deixar o dark mode css prevalecer
    const msgsArea = $('messages-area');
    if (msgsArea) {
      msgsArea.style.background = '';
      msgsArea.style.backgroundImage = '';
    }
  }
}

// Botão tema no dropdown principal
$('dropdown-theme-btn').addEventListener('click', toggleTheme);

// ── CARREGAR PERSONALIZACAO SALVA ─────────────────────────
function loadCustomization() {
  // Fundo do chat - cor
  const bgColor = localStorage.getItem(LS_BG_COLOR);
  if (bgColor) {
    applyBgColor(bgColor);
    markActiveColor('customize-bg-colors', bgColor);
  }

  // Fundo do chat - imagem
  const bgImage = localStorage.getItem(LS_BG_IMAGE);
  if (bgImage) {
    applyBgImage(bgImage);
  }

  // Cor da bolha
  const bubbleColor = localStorage.getItem(LS_BUBBLE);
  if (bubbleColor) {
    applyBubbleColor(bubbleColor);
    markActiveColor('customize-bubble-colors', bubbleColor, 'data-bubble');
    updateBubblePreview(bubbleColor);
  }

  // Cor de destaque
  const accentColor = localStorage.getItem(LS_ACCENT);
  if (accentColor) {
    applyAccentColor(accentColor);
    markActiveColor('customize-accent-colors', accentColor);
  }

  // Tema escuro
  loadTheme();
}

function applyBgColor(color) {
  const msgsArea = $('messages-area');
  if (msgsArea) {
    msgsArea.style.background = color;
    msgsArea.style.backgroundImage = 'none';
  }
  $('login-screen').style.background = color;
}

function applyBgImage(dataUrl) {
  const msgsArea = $('messages-area');
  if (msgsArea) {
    msgsArea.style.background = `url(${dataUrl}) center/cover no-repeat`;
  }
}

function applyBubbleColor(color) {
  const bubbleColor = hexToRgba(color, 0.78);
  const borderColor = hexToRgba(color, 0.60);
  document.documentElement.style.setProperty('--custom-bubble-out', bubbleColor);
  document.documentElement.style.setProperty('--custom-bubble-border', borderColor);
}

function applyAccentColor(color) {
  document.documentElement.style.setProperty('--custom-accent', color);
  // Aplica no botao enviar
  const sendBtn = $('send-btn');
  if (sendBtn) sendBtn.style.background = color;
  // Aplica nos botoes primarios
  document.querySelectorAll('.btn-primary, .modal-btn-primary, .admin-btn:not(.admin-btn-danger):not(.admin-btn-msg)').forEach(el => {
    el.style.background = color;
  });
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function markActiveColor(containerId, value, attr) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const attrName = attr || 'data-color';
  container.querySelectorAll('.customize-color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute(attrName) === value);
  });
}

function updateBubblePreview(color) {
  const preview = $('customize-bubble-preview');
  if (!preview) return;
  const bubble = preview.querySelector('.bubble');
  if (bubble) {
    bubble.style.background = hexToRgba(color, 0.78);
    bubble.style.borderColor = hexToRgba(color, 0.60);
  }
}

// ── ABRIR/FECHAR MODAL DE PERSONALIZACAO ───────────────────
function openCustomizeModal() {
  $('customize-modal-overlay').classList.remove('hidden');
  // Sincroniza toggle com estado atual
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const toggle = $('customize-dark-toggle');
  if (toggle) toggle.checked = isDark;
  // Atualiza preview da bolha
  const bubbleColor = localStorage.getItem(LS_BUBBLE) || '#d4fdd2';
  updateBubblePreview(bubbleColor);
}

function closeCustomizeModal() {
  $('customize-modal-overlay').classList.add('hidden');
}

$('customize-modal-close').addEventListener('click', closeCustomizeModal);
$('customize-modal-overlay').addEventListener('click', e => {
  if (e.target === $('customize-modal-overlay')) closeCustomizeModal();
});

// Botao personalizar no dropdown
$('dropdown-customize-btn').addEventListener('click', () => {
  headerDropdown.classList.add('hidden');
  openCustomizeModal();
});

// Botao novo grupo no dropdown
$('dropdown-group-btn').addEventListener('click', () => {
  headerDropdown.classList.add('hidden');
  openGroupModal();
});

// ── EVENTOS DO MODAL ──────────────────────────────────────

// Toggle tema escuro
$('customize-dark-toggle').addEventListener('change', function() {
  if (this.checked) {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem(LS_THEME, 'dark');
    updateThemeBtnText(true);
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(LS_THEME, 'light');
    updateThemeBtnText(false);
  }
});

// Cores de fundo do chat
$('customize-bg-colors').addEventListener('click', e => {
  const btn = e.target.closest('.customize-color-btn');
  if (!btn) return;
  const color = btn.dataset.color;
  if (!color) return;
  localStorage.setItem(LS_BG_COLOR, color);
  localStorage.removeItem(LS_BG_IMAGE);
  applyBgColor(color);
  markActiveColor('customize-bg-colors', color);
  showToast('Fundo alterado!');
});

// Upload de imagem de fundo
$('customize-bg-upload-btn').addEventListener('click', () => {
  $('customize-bg-input').click();
});

$('customize-bg-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    localStorage.setItem(LS_BG_IMAGE, dataUrl);
    localStorage.removeItem(LS_BG_COLOR);
    applyBgImage(dataUrl);
    // Desmarca cor
    document.querySelectorAll('#customize-bg-colors .customize-color-btn').forEach(b => b.classList.remove('active'));
    showToast('Imagem de fundo aplicada!');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// Reset de fundo
$('customize-bg-reset').addEventListener('click', () => {
  localStorage.removeItem(LS_BG_COLOR);
  localStorage.removeItem(LS_BG_IMAGE);
  const msgsArea = $('messages-area');
  if (msgsArea) {
    msgsArea.style.background = '';
    msgsArea.style.backgroundImage = '';
  }
  document.querySelectorAll('#customize-bg-colors .customize-color-btn').forEach(b => b.classList.remove('active'));
  showToast('Fundo restaurado ao padrão');
});

// Cores da bolha
$('customize-bubble-colors').addEventListener('click', e => {
  const btn = e.target.closest('.customize-bubble-btn');
  if (!btn) return;
  const color = btn.dataset.bubble;
  if (!color) return;
  localStorage.setItem(LS_BUBBLE, color);
  applyBubbleColor(color);
  markActiveColor('customize-bubble-colors', color, 'data-bubble');
  updateBubblePreview(color);
  showToast('Cor das mensagens alterada!');
});

// Cores de destaque
$('customize-accent-colors').addEventListener('click', e => {
  const btn = e.target.closest('.customize-color-btn');
  if (!btn) return;
  const color = btn.dataset.accent;
  if (!color) return;
  localStorage.setItem(LS_ACCENT, color);
  applyAccentColor(color);
  markActiveColor('customize-accent-colors', color);
  showToast('Cor de destaque alterada!');
});

// ── INICIALIZAR PERSONALIZACAO ────────────────────────────
loadCustomization();
