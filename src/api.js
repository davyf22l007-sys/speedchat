const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { broadcastAvatarUpdate, broadcastGroupDeleted } = require('./ws');

const router = express.Router();

function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });

  const data = db.read();
  const session = data.sessions[token];
  if (!session) return res.status(401).json({ error: 'Sessão inválida.' });

  req.userId = session.userId;
  next();
}

router.get('/rooms', requireAuth, (req, res) => {
  const data = db.read();
  const rooms = data.rooms.filter(r => r.members.includes(req.userId));
  const clearedAt = data.clearedAt || {};

  const enriched = rooms.map(room => {
    const cutoff = clearedAt[`${req.userId}:${room.id}`] || null;
    const msgs = data.messages.filter(m => {
      if (m.roomId !== room.id) return false;
      if (cutoff && m.timestamp <= cutoff) return false;
      return true;
    });
    const last = msgs[msgs.length - 1] || null;

    let displayName = room.name;
    let displayColor = room.avatarColor;
    let avatarData = room.avatarData || null;
    if (room.isDM && room.dmNames) {
      displayName = room.dmNames[req.userId] || room.name;
    }
    if (room.isDM && room.dmAvatarColors) {
      displayColor = room.dmAvatarColors[req.userId] || room.avatarColor;
    }
    // Puxa o avatarData do outro usuário na DM
    if (room.isDM && room.members) {
      const otherUserId = room.members.find(id => id !== req.userId);
      if (otherUserId) {
        const otherUser = data.users.find(u => u.id === otherUserId);
        if (otherUser && otherUser.avatarData) {
          avatarData = otherUser.avatarData;
        }
      }
    }

    // Inclui hasPassword (bool) sem expor a senha
    const enrichedRoom = { ...room, name: displayName, avatarColor: displayColor, avatarData: avatarData, lastMessage: last, unread: 0 };
    enrichedRoom.hasPassword = !!room.password;
    return enrichedRoom;
  });

  res.json(enriched);
});

router.get('/rooms/:roomId/messages', requireAuth, (req, res) => {
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room || !room.members.includes(req.userId)) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  const clearedAt = data.clearedAt || {};
  const cutoff = clearedAt[`${req.userId}:${req.params.roomId}`] || null;

  let messages = data.messages.filter(m => {
    if (m.roomId !== req.params.roomId) return false;
    if (cutoff && m.timestamp <= cutoff) return false;
    return true;
  });

  // Paginação: as últimas mensagens primeiro
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const total = messages.length;
  const hasMore = offset + limit < total;

  // Pega do final pra trás (mais recentes primeiro)
  const startIndex = Math.max(0, total - offset - limit);
  const endIndex = total - offset;
  const page = messages.slice(startIndex, endIndex);

  // Enriquece cada mensagem com avatarData atual do autor
  const enriched = page.map(m => {
    const author = data.users.find(u => u.id === m.authorId);
    return { ...m, authorAvatarData: author?.avatarData || null };
  });

  res.json({ messages: enriched, total, hasMore, offset, limit });
});

router.post('/rooms/:roomId/messages', requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Mensagem vazia.' });
  }

  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room || !room.members.includes(req.userId)) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  const user = data.users.find(u => u.id === req.userId);
  const message = {
    id: 'msg_' + uuidv4().split('-')[0],
    roomId: req.params.roomId,
    authorId: req.userId,
    authorName: user.username,
    content: content.trim(),
    timestamp: new Date().toISOString()
  };

  data.messages.push(message);
  db.write(data);

  res.json(message);
});

// ── LIMPAR MENSAGENS DA CONVERSA (apenas para o usuário atual) ────────────
router.delete('/rooms/:roomId/messages', requireAuth, (req, res) => {
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room || !room.members.includes(req.userId)) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  if (!data.clearedAt) data.clearedAt = {};
  data.clearedAt[`${req.userId}:${req.params.roomId}`] = new Date().toISOString();
  db.write(data);

  res.json({ ok: true });
});

// ── BUSCAR USUÁRIO POR USERNAME ───────────────────────────
router.get('/users/search', requireAuth, (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'Informe o username.' });

  const data = db.read();
  const found = data.users.find(u =>
    u.username.toLowerCase() === username.trim().toLowerCase()
  );

  if (!found) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (found.id === req.userId) return res.status(400).json({ error: 'Você não pode iniciar uma conversa consigo mesmo.' });

  res.json({ id: found.id, username: found.username, avatarColor: found.avatarColor, avatarData: found.avatarData || null, bio: found.bio || '' });
});

// ── CRIAR OU RECUPERAR CONVERSA PRIVADA (DM) ─────────────
router.post('/rooms/dm', requireAuth, (req, res) => {
  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId obrigatório.' });

  const data = db.read();
  const me = req.userId;

  const existing = data.rooms.find(r =>
    r.isDM &&
    r.members.length === 2 &&
    r.members.includes(me) &&
    r.members.includes(targetUserId)
  );

  if (existing) {
    const cutoff = (data.clearedAt || {})[`${me}:${existing.id}`] || null;
    const msgs = data.messages.filter(m => {
      if (m.roomId !== existing.id) return false;
      if (cutoff && m.timestamp <= cutoff) return false;
      return true;
    });
    const last = msgs[msgs.length - 1] || null;
    const displayName = (existing.dmNames && existing.dmNames[me]) || existing.name;
    const displayColor = (existing.dmAvatarColors && existing.dmAvatarColors[me]) || existing.avatarColor;
    let avatarData = existing.avatarData || null;
    const otherUserId = existing.members.find(id => id !== me);
    if (otherUserId) {
      const otherUser = data.users.find(u => u.id === otherUserId);
      if (otherUser && otherUser.avatarData) {
        avatarData = otherUser.avatarData;
      }
    }
    return res.json({ ...existing, name: displayName, avatarColor: displayColor, avatarData: avatarData, lastMessage: last, unread: 0 });
  }

  const targetUser = data.users.find(u => u.id === targetUserId);
  if (!targetUser) return res.status(404).json({ error: 'Usuário alvo não encontrado.' });

  const meUser = data.users.find(u => u.id === me);

  const newRoom = {
    id: 'room_' + uuidv4().split('-')[0],
    name: targetUser.username,
    isDM: true,
    members: [me, targetUserId],
    dmNames: {
      [me]: targetUser.username,
      [targetUserId]: meUser.username
    },
    dmAvatarColors: {
      [me]: targetUser.avatarColor,
      [targetUserId]: meUser.avatarColor
    },
    avatarColor: targetUser.avatarColor,
    createdAt: new Date().toISOString()
  };

  data.rooms.push(newRoom);
  db.write(data);

  const newOtherUserId = newRoom.members.find(id => id !== me);
  let newAvatarData = newRoom.avatarData || null;
  if (newOtherUserId) {
    const newOtherUser = data.users.find(u => u.id === newOtherUserId);
    if (newOtherUser && newOtherUser.avatarData) {
      newAvatarData = newOtherUser.avatarData;
    }
  }

  res.status(201).json({
    ...newRoom,
    name: newRoom.dmNames[me],
    avatarColor: newRoom.dmAvatarColors[me],
    avatarData: newAvatarData,
    lastMessage: null,
    unread: 0
  });
});

// ── EDITAR MENSAGEM ────────────────────────────────────────
router.put('/rooms/:roomId/messages/:messageId', requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Mensagem vazia.' });
  }

  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);
  if (!room || !room.members.includes(req.userId)) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  const msg = data.messages.find(m => m.id === req.params.messageId && m.roomId === req.params.roomId);
  if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  if (msg.authorId !== req.userId) return res.status(403).json({ error: 'Você só pode editar suas próprias mensagens.' });
  if (msg.deleted) return res.status(400).json({ error: 'Mensagem deletada.' });

  msg.content = content.trim();
  msg.edited = true;
  db.write(data);

  res.json(msg);
});

// ── DELETAR MENSAGEM ──────────────────────────────────────
router.delete('/rooms/:roomId/messages/:messageId', requireAuth, (req, res) => {
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);
  if (!room || !room.members.includes(req.userId)) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  const msg = data.messages.find(m => m.id === req.params.messageId && m.roomId === req.params.roomId);
  if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  if (msg.authorId !== req.userId) return res.status(403).json({ error: 'Você só pode deletar suas próprias mensagens.' });

  msg.deleted = true;
  msg.content = '';
  msg.type = 'text';
  db.write(data);

  res.json({ ok: true });
});

// ── ATUALIZAR PERFIL ──────────────────────────────────────
router.put('/profile', requireAuth, (req, res) => {
  const { username, avatar } = req.body;
  
  const data = db.read();
  const user = data.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  if (username && username.trim()) {
    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 20) {
      return res.status(400).json({ error: 'O nome deve ter entre 3 e 20 caracteres.' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      return res.status(400).json({ error: 'Use apenas letras, números ou underscore.' });
    }
    const exists = data.users.find(u => u.id !== req.userId && u.username.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      return res.status(409).json({ error: 'Este nome já está em uso.' });
    }
    data.messages.forEach(m => {
      if (m.authorId === req.userId) m.authorName = trimmed;
    });
    // Atualiza o nome que os OUTROS veem nas DMs com esse usuário
    // Só atualiza dmNames das salas que o usuário realmente participa
    data.rooms.forEach(r => {
      if (r.dmNames && r.members && r.members.includes(req.userId)) {
        r.members.forEach(memberId => {
          if (memberId !== req.userId && r.dmNames[memberId]) {
            r.dmNames[memberId] = trimmed;
          }
        });
        // Se o nome da sala (DM) ainda é o nome antigo, atualiza
        if (r.isDM && r.name === user.username) {
          r.name = trimmed;
        }
      }
    });
    user.username = trimmed;
  }

  let avatarChanged = false;

  // Atualiza avatar (base64) se enviado — max 2MB
  if (avatar && typeof avatar === 'string' && avatar.startsWith('data:image/')) {
    const sizeBytes = Math.ceil(avatar.length * 3 / 4);
    if (sizeBytes > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Imagem muito grande. Máximo 2MB.' });
    }
    user.avatarData = avatar;
    avatarChanged = true;
  }

  // Salva recado (bio)
  if (req.body.bio !== undefined) {
    const bio = String(req.body.bio).trim();
    if (bio.length > 150) {
      return res.status(400).json({ error: 'O recado deve ter no máximo 150 caracteres.' });
    }
    user.bio = bio;
  }

  db.write(data);

  res.json({
    id: user.id,
    username: user.username,
    avatarColor: user.avatarColor,
    avatarData: user.avatarData,
    bio: user.bio || ''
  });

  // Avisa geral via websocket que o perfil mudou
  if (avatarChanged) {
    broadcastAvatarUpdate(req.userId, user.avatarData);
  }
});

// ── BUSCAR MENSAGENS NO CHAT ──────────────────────────────
router.get('/rooms/:roomId/search', requireAuth, (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);

  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);
  if (!room || !room.members.includes(req.userId)) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  const query = q.toLowerCase();
  const results = data.messages.filter(m => {
    if (m.roomId !== req.params.roomId) return false;
    if (m.deleted) return false;
    return m.content.toLowerCase().includes(query) || m.authorName.toLowerCase().includes(query);
  });

  res.json(results.slice(-30)); // últimas 30 correspondências
});

// ── LISTAR TODOS OS USUÁRIOS (para selecionar membros do grupo) ─
router.get('/users', requireAuth, (req, res) => {
  const data = db.read();
  const users = data.users.map(u => ({
    id: u.id,
    username: u.username,
    avatarColor: u.avatarColor,
    avatarData: u.avatarData || null,
    bio: u.bio || ''
  }));
  res.json(users);
});

// ── CRIAR GRUPO ───────────────────────────────────────────
router.post('/rooms/group', requireAuth, (req, res) => {
  const { name, members } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nome do grupo é obrigatório.' });
  }

  if (!members || !Array.isArray(members) || members.length < 2) {
    return res.status(400).json({ error: 'Selecione pelo menos 1 outro usuário.' });
  }

  const trimmedName = name.trim();
  if (trimmedName.length > 30) {
    return res.status(400).json({ error: 'O nome deve ter no máximo 30 caracteres.' });
  }

  // Garante que o criador esta na lista
  if (!members.includes(req.userId)) {
    members.push(req.userId);
  }

  const data = db.read();

  // Verifica se todos os membros existem
  const allExist = members.every(id => data.users.find(u => u.id === id));
  if (!allExist) {
    return res.status(400).json({ error: 'Um ou mais usuários não existem.' });
  }

  const { v4: uuidv4 } = require('uuid');

  const newRoom = {
    id: 'room_' + uuidv4().split('-')[0],
    name: trimmedName,
    isDM: false,
    members,
    avatarColor: '#4a5568',
    avatarData: null,
    createdBy: req.userId,
    createdAt: new Date().toISOString(),
    isGlobal: false
  };

  data.rooms.push(newRoom);
  db.write(data);

  res.status(201).json({
    ...newRoom,
    lastMessage: null,
    unread: 0
  });
});

// ── VERIFICAR SE GRUPO TEM SENHA (qualquer usuário autenticado) ──
router.get('/rooms/:roomId/password-check', requireAuth, (req, res) => {
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala não encontrada.' });
  if (room.isDM) return res.json({ hasPassword: false });
  res.json({ hasPassword: !!room.password });
});

// ── ENTRAR EM GRUPO COM SENHA ────────────────────────────
router.post('/rooms/:roomId/join', requireAuth, (req, res) => {
  const { password } = req.body;

  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  if (room.isDM) {
    return res.status(400).json({ error: 'Não pode entrar em conversas privadas.' });
  }

  // Se já é membro, verifica senha mesmo assim (se o grupo tiver senha)
  if (room.members.includes(req.userId)) {
    if (room.password && (!password || password.trim() !== room.password)) {
      return res.status(403).json({ error: 'Senha incorreta.' });
    }
    return res.json({ ok: true, alreadyMember: true });
  }

  // Verifica senha pra quem não é membro
  if (room.password) {
    if (!password || password.trim() !== room.password) {
      return res.status(403).json({ error: 'Senha incorreta.' });
    }
  }

  // Adiciona como membro
  room.members.push(req.userId);
  db.write(data);

  res.json({ ok: true, alreadyMember: false });
});

// ── EDITAR SALA (nome e avatar) — só admin ou criador ────
router.put('/rooms/:roomId', requireAuth, (req, res) => {
  const { name, avatarData } = req.body;

  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room || !room.members.includes(req.userId)) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  // Nao pode editar DM
  if (room.isDM) {
    return res.status(403).json({ error: 'Não pode editar conversas privadas.' });
  }

  // Só admin global ou criador do grupo pode editar
  const user = data.users.find(u => u.id === req.userId);
  if (!user || (!user.isAdmin && room.createdBy !== req.userId)) {
    return res.status(403).json({ error: 'Apenas administradores podem editar o grupo.' });
  }

  if (name !== undefined) {
    if (!name.trim() || name.trim().length > 30) {
      return res.status(400).json({ error: 'O nome deve ter entre 1 e 30 caracteres.' });
    }
    room.name = name.trim();
  }

  if (avatarData !== undefined) {
    if (avatarData && typeof avatarData === 'string' && avatarData.startsWith('data:image/')) {
      const sizeBytes = Math.ceil(avatarData.length * 3 / 4);
      if (sizeBytes > 2 * 1024 * 1024) {
        return res.status(400).json({ error: 'Imagem muito grande. Máximo 2MB.' });
      }
      room.avatarData = avatarData;
    } else if (avatarData === null) {
      room.avatarData = null;
    }
  }

  db.write(data);

  res.json({ id: room.id, name: room.name, avatarColor: room.avatarColor, avatarData: room.avatarData || null });
});

// ── DELETAR GRUPO — só admin ────────────────────────────
router.delete('/rooms/:roomId', requireAuth, (req, res) => {
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room || !room.members.includes(req.userId)) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  // Nao pode deletar DM
  if (room.isDM) {
    return res.status(403).json({ error: 'Não pode deletar conversas privadas.' });
  }

  // Só admin global pode deletar grupo
  const user = data.users.find(u => u.id === req.userId);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: 'Apenas administradores podem deletar grupos.' });
  }

  // Guarda os membros antes de remover
  const members = [...room.members];

  // Remove todas as mensagens do grupo
  data.messages = data.messages.filter(m => m.roomId !== room.id);

  // Remove a sala
  data.rooms = data.rooms.filter(r => r.id !== room.id);

  db.write(data);

  // Avisa todos os membros via websocket
  broadcastGroupDeleted(room.id, members);

  res.json({ ok: true });
});

module.exports = { router, requireAuth };
