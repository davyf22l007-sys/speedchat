const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { sanitizeContent } = require('./sanitize');
const { broadcastPasswordUpdate, broadcastMessagesCleared } = require('./ws');

const router = express.Router();

function requireAdmin(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });

  const data = db.read();
  const session = data.sessions[token];
  if (!session) return res.status(401).json({ error: 'Sessão inválida.' });

  const user = data.users.find(u => u.id === session.userId);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });
  if (!user.isAdmin) return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });

  req.userId = user.id;
  req.adminUser = user;
  req.isSuperAdmin = user.isSuperAdmin || false;
  next();
}

function requireSuperAdmin(req, res, next) {
  requireAdmin(req, res, () => {
    if (!req.isSuperAdmin) {
      return res.status(403).json({ error: 'Acesso negado. Apenas o super administrador pode fazer isso.' });
    }
    next();
  });
}

// ── LISTAR TODOS OS USUÁRIOS ──────────────────────────────
router.get('/users', requireAdmin, (req, res) => {
  const data = db.read();
  const users = data.users.map(u => ({
    id: u.id,
    username: u.username,
    avatarColor: u.avatarColor,
    avatarData: u.avatarData || null,
    isAdmin: u.isAdmin || false,
    isSuperAdmin: u.isSuperAdmin || false,
    createdAt: u.createdAt
  }));
  res.json(users);
});

// ── DELETAR UM USUÁRIO ────────────────────────────────────
router.delete('/users/:userId', requireAdmin, (req, res) => {
  const { userId } = req.params;

  if (userId === req.userId) {
    return res.status(400).json({ error: 'Você não pode deletar a si mesmo.' });
  }

  const data = db.read();
  const userIndex = data.users.findIndex(u => u.id === userId);

  if (userIndex === -1) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  const user = data.users[userIndex];

  // Proteção: ninguém pode deletar o super admin
  if (user.isSuperAdmin) {
    return res.status(400).json({ error: 'Você não pode deletar o super administrador.' });
  }

  // Admin comum não pode deletar outro admin
  if (user.isAdmin && !req.isSuperAdmin) {
    return res.status(400).json({ error: 'Apenas o super administrador pode deletar outros administradores.' });
  }

  // Remove o usuário
  data.users.splice(userIndex, 1);

  // Remove sessões desse usuário
  for (const [token, session] of Object.entries(data.sessions)) {
    if (session.userId === userId) {
      delete data.sessions[token];
    }
  }

  // Remove o usuário dos membros das salas
  data.rooms.forEach(room => {
    room.members = room.members.filter(id => id !== userId);
    if (room.dmNames) delete room.dmNames[userId];
    if (room.dmAvatarColors) delete room.dmAvatarColors[userId];
  });

  // Deleta as mensagens do usuário
  data.messages = data.messages.filter(m => m.authorId !== userId);

  // Remove salas DM que ficaram vazias
  data.rooms = data.rooms.filter(r => {
    if (r.isDM && r.members.length < 2) return false;
    return true;
  });

  db.write(data);

  res.json({ ok: true, message: 'Usuário deletado com sucesso.' });
});

// ── ALTERAR SENHA DE UM USUÁRIO ───────────────────────────
router.put('/users/:userId/password', requireAdmin, (req, res) => {
  const { userId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
  }

  const data = db.read();
  const user = data.users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  user.password = bcrypt.hashSync(newPassword, 10);
  db.write(data);

  res.json({ ok: true, message: 'Senha alterada com sucesso.' });
});

// ── EDITAR USUÁRIO (username) ─────────────────────────────
router.put('/users/:userId', requireAdmin, (req, res) => {
  const { userId } = req.params;
  const { username } = req.body;

  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'Nome de usuário é obrigatório.' });
  }

  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 20) {
    return res.status(400).json({ error: 'O nome deve ter entre 3 e 20 caracteres.' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Use apenas letras, números ou underscore.' });
  }

  const data = db.read();
  const user = data.users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  const exists = data.users.find(u => u.id !== userId && u.username.toLowerCase() === trimmed.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'Este nome já está em uso.' });
  }

  // Atualiza nome nas mensagens
  data.messages.forEach(m => {
    if (m.authorId === userId) m.authorName = trimmed;
  });

  // Atualiza nome nos DMs
  data.rooms.forEach(r => {
    if (r.dmNames && r.dmNames[userId]) r.dmNames[userId] = trimmed;
  });

  user.username = trimmed;
  db.write(data);

  res.json({ ok: true, message: 'Usuário atualizado.' });
});

// ── LISTAR SALAS/CONVERSAS DE UM USUÁRIO ────────────────
router.get('/users/:userId/rooms', requireAdmin, (req, res) => {
  const { userId } = req.params;
  const data = db.read();

  const user = data.users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  const userRooms = data.rooms.filter(r => r.members.includes(userId));

  const enriched = userRooms.map(room => {
    const msgs = data.messages.filter(m => m.roomId === room.id);
    const last = msgs[msgs.length - 1] || null;

    let displayName = room.name;
    if (room.isDM && room.dmNames) {
      displayName = room.dmNames[userId] || room.name;
    }

    return {
      id: room.id,
      name: displayName,
      isDM: room.isDM || false,
      createdAt: room.createdAt,
      lastMessage: last ? {
        content: last.type === 'image' ? '📷 Imagem' : last.type === 'file' ? '📄 Documento' : last.content,
        timestamp: last.timestamp,
        authorName: last.authorName
      } : null,
      messageCount: msgs.length
    };
  });

  // Ordena: mais recente primeiro
  enriched.sort((a, b) => {
    if (!a.lastMessage) return 1;
    if (!b.lastMessage) return -1;
    return new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp);
  });

  res.json(enriched);
});

// ── LISTAR MENSAGENS DE UMA SALA (admin) ────────────────
router.get('/users/:userId/rooms/:roomId/messages', requireAdmin, (req, res) => {
  const { userId, roomId } = req.params;
  const data = db.read();

  const room = data.rooms.find(r => r.id === roomId);
  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  const messages = data.messages
    .filter(m => m.roomId === roomId)
    .map(m => {
      const author = data.users.find(u => u.id === m.authorId);
      return { ...m, authorAvatarData: author?.avatarData || null };
    });

  res.json(messages);
});

// ── LISTAR TODAS AS SALAS (grupos não-DM) ──────────────
router.get('/rooms', requireAdmin, (req, res) => {
  // Força sempre dados frescos - sem cache
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const data = db.read();
  const rooms = data.rooms
    .filter(r => !r.isDM)
    .map(r => ({
      id: r.id,
      name: r.name,
      memberCount: r.members ? r.members.length : 0,
      isGlobal: r.isGlobal || false,
      createdAt: r.createdAt
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(rooms);
});

// ── ALTERNAR GRUPO GLOBAL (toggle) ──────────────────────
router.put('/rooms/:roomId/global', requireAdmin, (req, res) => {
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  if (room.isDM) {
    return res.status(400).json({ error: 'Não pode marcar DM como global.' });
  }

  const { isGlobal } = req.body;

  // Se for marcar como global mas tem senha, bloqueia
  if (isGlobal && room.password) {
    return res.status(400).json({ error: 'Grupos com senha não podem ser globais. Remova a senha primeiro.' });
  }

  room.isGlobal = !!isGlobal;

  // Quando marca como global, add automaticamente todos os users existentes
  let added = 0;
  if (room.isGlobal) {
    data.users.forEach(u => {
      if (!room.members.includes(u.id)) {
        room.members.push(u.id);
        added++;
      }
    });
  }

  db.write(data);

  res.json({ ok: true, isGlobal: room.isGlobal, added });
});

// ── CRIAR GRUPO (admin) ─────────────────────────────────
router.post('/rooms', requireAdmin, (req, res) => {
  const { name, members, isGlobal, password } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nome do grupo é obrigatório.' });
  }

  const trimmedName = name.trim();
  if (trimmedName.length > 30) {
    return res.status(400).json({ error: 'O nome deve ter no máximo 30 caracteres.' });
  }

  // Garante que o admin criador ta na lista
  if (!members.includes(req.userId)) {
    members.push(req.userId);
  }

  if (!members || !Array.isArray(members) || members.length === 0) {
    return res.status(400).json({ error: 'Selecione pelo menos um membro.' });
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
    isGlobal: !!isGlobal
  };

  // Se tiver senha, adiciona hasheada (e não pode ser global)
  if (password && typeof password === 'string' && password.trim().length >= 3) {
    if (newRoom.isGlobal) {
      return res.status(400).json({ error: 'Grupos globais não podem ter senha.' });
    }
    newRoom.password = bcrypt.hashSync(password.trim(), 10);
  }

  data.rooms.push(newRoom);
  db.write(data);

  res.status(201).json({
    id: newRoom.id,
    name: newRoom.name,
    memberCount: newRoom.members.length,
    isGlobal: newRoom.isGlobal,
    hasPassword: !!newRoom.password,
    createdAt: newRoom.createdAt
  });
});

// ── VERIFICAR SE GRUPO TEM SENHA (sem expor a senha) ────
router.get('/rooms/:roomId/password', requireAdmin, (req, res) => {
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  res.json({ hasPassword: !!room.password });
});

// ── DEFINIR/REMOVER SENHA DE UM GRUPO ───────────────────
router.put('/rooms/:roomId/password', requireAdmin, (req, res) => {
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  if (room.isDM) {
    return res.status(400).json({ error: 'Não pode definir senha em conversas privadas.' });
  }

  const { password } = req.body;

  if (password && typeof password === 'string' && password.trim().length > 0) {
    if (password.trim().length < 3) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 3 caracteres.' });
    }

    // Não permite senha em grupos globais
    if (room.isGlobal) {
      return res.status(400).json({ error: 'Grupos globais não podem ter senha. Desmarque como global primeiro.' });
    }

    // Hasheia a senha com bcrypt
    room.password = bcrypt.hashSync(password.trim(), 10);
    db.write(data);
    broadcastPasswordUpdate(room.id);
    return res.json({ ok: true, hasPassword: true, message: 'Senha definida com sucesso!' });
  } else {
    // Remove a senha se existir
    if (room.password) {
      delete room.password;
      db.write(data);
      broadcastPasswordUpdate(room.id);
      return res.json({ ok: true, hasPassword: false, message: 'Senha removida com sucesso!' });
    }
    return res.json({ ok: true, hasPassword: false, message: 'O grupo já não tinha senha.' });
  }
});

// ── ADICIONAR MEMBRO A UM GRUPO ───────────────────────────
router.post('/rooms/:roomId/members', requireAdmin, (req, res) => {
  const { userId } = req.body;
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  if (room.isDM) {
    return res.status(400).json({ error: 'Não pode adicionar membros em conversas privadas.' });
  }

  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório.' });
  }

  const user = data.users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  if (room.members.includes(userId)) {
    return res.status(400).json({ error: 'Usuário já é membro deste grupo.' });
  }

  room.members.push(userId);
  db.write(data);

  res.json({ ok: true, message: `${user.username} adicionado ao grupo!` });
});

// ── LISTAR MEMBROS DE UM GRUPO (com dados) ────────────────
router.get('/rooms/:roomId/members', requireAdmin, (req, res) => {
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  const members = (room.members || []).map(id => {
    const user = data.users.find(u => u.id === id);
    return user
      ? {
          id: user.id,
          username: user.username,
          avatarColor: user.avatarColor,
          avatarData: user.avatarData || null,
          isAdmin: user.isAdmin || false,
          isSuperAdmin: user.isSuperAdmin || false
        }
      : { id, username: 'Desconhecido', avatarColor: '#666', avatarData: null, isAdmin: false, isSuperAdmin: false };
  });

  res.json(members);
});

// ── REMOVER MEMBRO DE UM GRUPO ────────────────────────────
router.delete('/rooms/:roomId/members/:userId', requireAdmin, (req, res) => {
  const { roomId, userId } = req.params;
  const data = db.read();
  const room = data.rooms.find(r => r.id === roomId);

  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  if (room.isDM) {
    return res.status(400).json({ error: 'Não pode remover membros de conversas privadas.' });
  }

  // Protege super admin
  const targetUser = data.users.find(u => u.id === userId);
  if (targetUser && targetUser.isSuperAdmin) {
    return res.status(400).json({ error: 'Não pode remover o super administrador do grupo.' });
  }

  const idx = room.members.indexOf(userId);
  if (idx === -1) {
    return res.status(404).json({ error: 'Usuário não é membro deste grupo.' });
  }

  room.members.splice(idx, 1);
  db.write(data);

  res.json({ ok: true, message: 'Membro removido do grupo.' });
});

// ── ADICIONAR TODOS OS USUÁRIOS EXISTENTES A UM GRUPO ───
router.post('/rooms/:roomId/add-all-users', requireAdmin, (req, res) => {
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  if (room.isDM) {
    return res.status(400).json({ error: 'Não pode adicionar usuários em conversas privadas.' });
  }

  // Não permite add todos em grupos com senha (burla a proteção)
  if (room.password) {
    return res.status(400).json({ error: 'Grupos com senha não podem receber adição em massa. Remova a senha primeiro.' });
  }

  let added = 0;
  data.users.forEach(u => {
    if (!room.members.includes(u.id)) {
      room.members.push(u.id);
      added++;
    }
  });

  db.write(data);

  res.json({ ok: true, added });
});

// ── ALTERNAR ADMIN (promover/rebaixar) ────────────────────
router.post('/users/:userId/toggle-admin', requireSuperAdmin, (req, res) => {
  const { userId } = req.params;
  const { isAdmin } = req.body;

  const data = db.read();
  const user = data.users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  // Não pode alterar o próprio super admin
  if (user.isSuperAdmin) {
    return res.status(400).json({ error: 'Você não pode alterar o super administrador.' });
  }

  // Se for pra promover e já é admin, ou rebaixar e já não é, avisa
  if (isAdmin && user.isAdmin) {
    return res.status(400).json({ error: 'Este usuário já é administrador.' });
  }
  if (!isAdmin && !user.isAdmin) {
    return res.status(400).json({ error: 'Este usuário não é administrador.' });
  }

  user.isAdmin = !!isAdmin;
  db.write(data);

  const action = isAdmin ? 'promovido' : 'rebaixado';
  res.json({ ok: true, message: `Usuário ${action} com sucesso!`, isAdmin: user.isAdmin });
});

// ── APAGAR TODAS AS MENSAGENS DE UM GRUPO (admin) ───────
router.delete('/rooms/:roomId/messages', requireAdmin, (req, res) => {
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
  }

  if (room.isDM) {
    return res.status(400).json({ error: 'Não pode apagar mensagens de conversas privadas.' });
  }

  // Remove todas as mensagens do grupo
  const before = data.messages.length;
  data.messages = data.messages.filter(m => m.roomId !== room.id);
  const removed = before - data.messages.length;

  db.write(data);

  // Avisa todos os membros via websocket
  broadcastMessagesCleared(room.id);

  res.json({ ok: true, removed });
});

module.exports = router;
