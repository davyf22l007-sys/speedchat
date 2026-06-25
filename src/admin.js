const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');

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
  next();
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

  if (user.isAdmin) {
    return res.status(400).json({ error: 'Você não pode deletar outro administrador.' });
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

// ── ADICIONAR TODOS OS USUÁRIOS EXISTENTES A UM GRUPO ───
router.post('/rooms/:roomId/add-all-users', requireAdmin, (req, res) => {
  const data = db.read();
  const room = data.rooms.find(r => r.id === req.params.roomId);

  if (!room) {
    return res.status(404).json({ error: 'Sala não encontrada.' });
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

module.exports = router;
