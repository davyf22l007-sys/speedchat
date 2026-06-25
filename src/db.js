const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const ADMIN_USERNAME = process.env.ADMIN_USER || 'davyf22l';
const ADMIN_PASSWORD = process.env.ADMIN_PASS || '@Davyf22l5820';
const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

let cache = null;
let saveTimer = null;
let isLoading = false;
let loadQueue = [];

// --- ESQUEMA DO BANCO ---
const SCHEMA = `
CREATE TABLE IF NOT EXISTS speedchat_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  avatar_color TEXT,
  avatar_data TEXT,
  is_admin BOOLEAN DEFAULT false,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS speedchat_rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_dm BOOLEAN DEFAULT false,
  members TEXT NOT NULL DEFAULT '[]',
  dm_names TEXT,
  dm_avatar_colors TEXT,
  avatar_color TEXT,
  avatar_data TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS speedchat_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_avatar_data TEXT,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'text',
  timestamp TEXT NOT NULL,
  edited BOOLEAN DEFAULT false,
  deleted BOOLEAN DEFAULT false,
  reply_to TEXT,
  read BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS speedchat_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS speedchat_cleared (
  key TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_room ON speedchat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON speedchat_sessions(user_id);
`;

function getInitialData() {
  const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const adminId = 'user_admin';
  return {
    users: [{ id: adminId, username: ADMIN_USERNAME, password: adminHash, avatarColor: '#e74c3c', isAdmin: true, createdAt: new Date().toISOString() }],
    rooms: [{ id: 'room_general', name: 'Geral', isDM: false, members: [adminId], avatarColor: '#25D366', createdAt: new Date().toISOString() }],
    messages: [],
    sessions: {},
    clearedAt: {}
  };
}

// --- CARREGAR DO POSTGRES PARA O CACHE ---
async function loadFromPG() {
  const data = getInitialData();

  const usersRes = await pool.query('SELECT * FROM speedchat_users');
  data.users = usersRes.rows.map(r => ({
    id: r.id,
    username: r.username,
    password: r.password,
    avatarColor: r.avatar_color,
    avatarData: r.avatar_data,
    isAdmin: r.is_admin,
    createdAt: r.created_at
  }));

  const roomsRes = await pool.query('SELECT * FROM speedchat_rooms');
  data.rooms = roomsRes.rows.map(r => ({
    id: r.id,
    name: r.name,
    isDM: r.is_dm,
    members: JSON.parse(r.members),
    dmNames: r.dm_names ? JSON.parse(r.dm_names) : undefined,
    dmAvatarColors: r.dm_avatar_colors ? JSON.parse(r.dm_avatar_colors) : undefined,
    avatarColor: r.avatar_color,
    avatarData: r.avatar_data,
    createdBy: r.created_by,
    createdAt: r.created_at
  }));

  const msgsRes = await pool.query('SELECT * FROM speedchat_messages ORDER BY timestamp ASC');
  data.messages = msgsRes.rows.map(r => ({
    id: r.id,
    roomId: r.room_id,
    authorId: r.author_id,
    authorName: r.author_name,
    authorAvatarData: r.author_avatar_data,
    content: r.content,
    type: r.type,
    timestamp: r.timestamp,
    edited: r.edited,
    deleted: r.deleted,
    replyTo: r.reply_to ? JSON.parse(r.reply_to) : undefined,
    read: r.read
  }));

  const sessRes = await pool.query('SELECT * FROM speedchat_sessions');
  data.sessions = {};
  sessRes.rows.forEach(r => { data.sessions[r.token] = { userId: r.user_id, createdAt: r.created_at }; });

  const clearRes = await pool.query('SELECT * FROM speedchat_cleared');
  data.clearedAt = {};
  clearRes.rows.forEach(r => { data.clearedAt[r.key] = r.timestamp; });

  return data;
}

// --- SALVAR DO CACHE PARA O POSTGRES ---
async function saveToPG() {
  if (!cache) return;
  const data = cache;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM speedchat_users');
    for (const u of data.users) {
      await client.query(
        'INSERT INTO speedchat_users (id, username, password, avatar_color, avatar_data, is_admin, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [u.id, u.username, u.password, u.avatarColor || null, u.avatarData || null, u.isAdmin || false, u.createdAt]
      );
    }

    await client.query('DELETE FROM speedchat_rooms');
    for (const r of data.rooms) {
      await client.query(
        'INSERT INTO speedchat_rooms (id, name, is_dm, members, dm_names, dm_avatar_colors, avatar_color, avatar_data, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [r.id, r.name, r.isDM || false, JSON.stringify(r.members), r.dmNames ? JSON.stringify(r.dmNames) : null, r.dmAvatarColors ? JSON.stringify(r.dmAvatarColors) : null, r.avatarColor || null, r.avatarData || null, r.createdBy || null, r.createdAt]
      );
    }

    await client.query('DELETE FROM speedchat_messages');
    for (const m of data.messages) {
      await client.query(
        'INSERT INTO speedchat_messages (id, room_id, author_id, author_name, author_avatar_data, content, type, timestamp, edited, deleted, reply_to, read) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [m.id, m.roomId, m.authorId, m.authorName, m.authorAvatarData || null, m.content, m.type || 'text', m.timestamp, m.edited || false, m.deleted || false, m.replyTo ? JSON.stringify(m.replyTo) : null, m.read || false]
      );
    }

    await client.query('DELETE FROM speedchat_sessions');
    for (const [token, sess] of Object.entries(data.sessions)) {
      await client.query(
        'INSERT INTO speedchat_sessions (token, user_id, created_at) VALUES ($1,$2,$3)',
        [token, sess.userId, sess.createdAt]
      );
    }

    await client.query('DELETE FROM speedchat_cleared');
    for (const [key, ts] of Object.entries(data.clearedAt || {})) {
      await client.query(
        'INSERT INTO speedchat_cleared (key, timestamp) VALUES ($1,$2)',
        [key, ts]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao salvar no PostgreSQL:', err.message);
  } finally {
    client.release();
  }
}

// --- API PUBLICA ---

async function init() {
  // Criar tabelas
  await pool.query(SCHEMA);

  // Verificar se ja tem dados
  const count = await pool.query('SELECT COUNT(*) as c FROM speedchat_users');
  if (parseInt(count.rows[0].c) === 0) {
    // Migrar dados do JSON se existir
    const fs = require('fs');
    const path = require('path');
    const jsonPath = path.resolve(__dirname, '../data/db.json');
    let migrated = false;
    try {
      if (fs.existsSync(jsonPath)) {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        const jsonData = JSON.parse(raw);
        cache = jsonData;
        await saveToPG();
        migrated = true;
      }
    } catch (e) {
      console.log('Nao foi possivel migrar JSON, criando dados iniciais...');
    }

    if (!migrated) {
      cache = getInitialData();
      await saveToPG();
    }
  } else {
    // Carregar do PG pro cache
    cache = await loadFromPG();
  }
}

function read() {
  return cache;
}

function write(data) {
  cache = data;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveToPG().catch(err => console.error('Erro no save:', err.message));
  }, 500);
}

async function flush() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (cache) await saveToPG();
}

module.exports = { init, read, write, flush };
