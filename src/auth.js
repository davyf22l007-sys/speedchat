const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const router = express.Router();

const AVATAR_COLORS = [
  '#25D366', '#7B61FF', '#FF6B6B', '#F7B731', '#2BCBBA',
  '#FC5C65', '#45AAF2', '#FD9644', '#A55EEA', '#26DE81'
];

// ── REGISTER ──────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }

  const trimmed = username.trim();

  if (trimmed.length < 3 || trimmed.length > 20) {
    return res.status(400).json({ error: 'O nome de usuário deve ter entre 3 e 20 caracteres.' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Use apenas letras, números ou underscore.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  }

  const data = db.read();

  const exists = data.users.find(u => u.username.toLowerCase() === trimmed.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'Este nome de usuário já está em uso.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const color = AVATAR_COLORS[data.users.length % AVATAR_COLORS.length];
  const token = uuidv4();

  const newUser = {
    id: 'user_' + uuidv4().split('-')[0],
    username: trimmed,
    password: hash,
    avatarColor: color,
    createdAt: new Date().toISOString(),
    bio: ''
  };

  data.users.push(newUser);

  // Adiciona à sala geral e a todos os grupos globais
  const general = data.rooms.find(r => r.id === 'room_general');
  if (general && !general.members.includes(newUser.id)) {
    general.members.push(newUser.id);
  }
  data.rooms.forEach(r => {
    if (r.isGlobal && !r.members.includes(newUser.id)) {
      r.members.push(newUser.id);
    }
  });

  data.sessions[token] = { userId: newUser.id, createdAt: new Date().toISOString() };
  db.write(data);

  res.cookie('session', token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.status(201).json({
    id: newUser.id,
    username: newUser.username,
    avatarColor: newUser.avatarColor,
    avatarData: newUser.avatarData || null,
    bio: newUser.bio || '',
    isAdmin: newUser.isAdmin || false
  });
});

// ── LOGIN ─────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }

  const data = db.read();
  const user = data.users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }

  const token = uuidv4();
  data.sessions[token] = { userId: user.id, createdAt: new Date().toISOString() };
  db.write(data);

  res.cookie('session', token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.json({
    id: user.id,
    username: user.username,
    avatarColor: user.avatarColor,
    avatarData: user.avatarData || null,
    bio: user.bio || '',
    isAdmin: user.isAdmin || false
  });
});

// ── LOGOUT ────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const token = req.cookies?.session;
  if (token) {
    const data = db.read();
    delete data.sessions[token];
    db.write(data);
  }
  res.clearCookie('session');
  res.json({ ok: true });
});

// ── ME ────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });

  const data = db.read();
  const session = data.sessions[token];
  if (!session) return res.status(401).json({ error: 'Sessão inválida.' });

  const user = data.users.find(u => u.id === session.userId);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });

  res.json({
    id: user.id,
    username: user.username,
    avatarColor: user.avatarColor,
    avatarData: user.avatarData || null,
    bio: user.bio || '',
    isAdmin: user.isAdmin || false
  });
});

module.exports = router;
