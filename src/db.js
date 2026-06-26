const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
let Database = null;
try { Database = require('better-sqlite3'); } catch {}

const DB_DIR = process.env.SPEEDCHAT_DB_DIR || 'D:\speedchat_data';
const DB_PATH = path.join(DB_DIR, 'speedchat.db');

const ADMIN_USERNAME = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASS;

let db = null;
let sqliteDb = null;
let usingPostgres = false;
let cache = null;
let saveTimer = null;

function getInitialData() {
  const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const adminId = 'user_admin';
  return {
    users: [{ id: adminId, username: ADMIN_USERNAME, password: adminHash, avatarColor: '#e74c3c', isAdmin: true, isSuperAdmin: true, createdAt: new Date().toISOString() }],
    rooms: [{ id: 'room_general', name: 'Geral', isDM: false, members: [adminId], avatarColor: '#25D366', createdAt: new Date().toISOString() }],
    messages: [], sessions: {}, clearedAt: {}
  };
}

function ensureAdmin(data) {
  const sa = data.users.find(u => u.id === 'user_admin');
  if (sa) {
    sa.isAdmin = true; sa.isSuperAdmin = true;
    const g = data.rooms.find(r => r.id === 'room_general');
    if (g && !g.members.includes(sa.id)) g.members.push(sa.id);
    data.users.forEach(u => { if (u.id !== 'user_admin') u.isSuperAdmin = false; });
    return false;
  }
  const h = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  data.users.push({ id: 'user_admin', username: ADMIN_USERNAME, password: h, avatarColor: '#e74c3c', isAdmin: true, isSuperAdmin: true, createdAt: new Date().toISOString() });
  const g = data.rooms.find(r => r.id === 'room_general');
  if (g && !g.members.includes('user_admin')) g.members.push('user_admin');
  return true;
}

async function init() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error('ADMIN_USER e ADMIN_PASS sao obrigatorios!');
  }

  const DATABASE_URL = process.env.DATABASE_URL;

  // Tenta PostgreSQL primeiro (se tiver DATABASE_URL)
  if (DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
      await pool.query('SELECT 1');
  const sql = `CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb)`;
  await pool.query(sql);
      const r = await pool.query('SELECT data FROM app_state WHERE id = 1');
      if (r.rows.length === 0) {
        cache = getInitialData();
        await pool.query('INSERT INTO app_state (id, data) VALUES (1, $1)', [JSON.stringify(cache)]);
        console.log('Dados iniciais criados no PostgreSQL.');
      } else {
        const raw = r.rows[0].data;
        cache = typeof raw === 'string' ? JSON.parse(raw) : raw;
        ensureAdmin(cache);
        await pool.query('UPDATE app_state SET data = $1 WHERE id = 1', [JSON.stringify(cache)]);
        console.log('Dados carregados do PostgreSQL (' + cache.users.length + ' usuarios, ' + cache.rooms.length + ' salas).');
      }
      db = pool;
      usingPostgres = true;
      console.log('PostgreSQL conectado!');
      return;
    } catch (err) {
      console.error('Erro ao conectar PostgreSQL:', err.message);
      console.log('Usando SQLite como fallback...');
      if (db) { try { await db.end(); } catch {} db = null; }
    }
  }

  // Fallback: SQLite local
  if (!Database) {
    throw new Error('better-sqlite3 nao instalado e sem DATABASE_URL');
  }
  fs.mkdirSync(DB_DIR, { recursive: true });
  sqliteDb = new Database(DB_PATH);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.exec('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY, data TEXT)');

  const row = sqliteDb.prepare('SELECT data FROM app_state WHERE id = 1').get();
  if (row) {
    try {
      cache = JSON.parse(row.data);
      ensureAdmin(cache);
      saveToSqlite(cache);
      console.log('Dados carregados do SQLite (' + cache.users.length + ' usuarios, ' + cache.rooms.length + ' salas).');
    } catch (e) {
      console.error('Erro ao ler SQLite, recriando:', e.message);
      cache = getInitialData();
      saveToSqlite(cache);
    }
  } else {
    cache = getInitialData();
    saveToSqlite(cache);
    console.log('Dados iniciais criados no SQLite.');
  }
  console.log('Banco: ' + DB_PATH);
}

async function saveToPostgres(data) {
  if (!db) return;
  try { await db.query('UPDATE app_state SET data = $1 WHERE id = 1', [JSON.stringify(data)]); }
  catch (err) { console.error('Erro ao salvar no PostgreSQL:', err.message); }
}

function saveToSqlite(data) {
  if (!sqliteDb) return;
  try { sqliteDb.prepare('INSERT OR REPLACE INTO app_state (id, data) VALUES (1, ?)').run(JSON.stringify(data)); }
  catch (err) { console.error('Erro ao salvar no SQLite:', err.message); }
}

function scheduleSave(data) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (usingPostgres) saveToPostgres(data);
    else saveToSqlite(data);
  }, 200);
}

function read() {
  if (!cache) throw new Error('Banco nao inicializado.');
  return cache;
}

function write(data) {
  cache = data;
  scheduleSave(data);
}

async function flush() {
  if (cache) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (usingPostgres) {
      await saveToPostgres(cache);
      console.log('Dados salvos no PostgreSQL.');
      try { await db.end(); } catch {} db = null;
    } else {
      saveToSqlite(cache);
      console.log('Dados salvos no SQLite.');
      try { sqliteDb.close(); } catch {} sqliteDb = null;
    }
  }
}

module.exports = { init, read, write, flush };
