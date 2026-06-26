const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.resolve(__dirname, '../data/db.json');

const ADMIN_USERNAME = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASS;

let pool = null;
let usingPostgres = false;
let cache = null;
let saveTimer = null;

function getInitialData() {
  const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const adminId = 'user_admin';
  return {
    users: [
      {
        id: adminId,
        username: ADMIN_USERNAME,
        password: adminHash,
        avatarColor: '#e74c3c',
        isAdmin: true,
        isSuperAdmin: true,
        createdAt: new Date().toISOString()
      }
    ],
    rooms: [
      {
        id: 'room_general',
        name: 'Geral',
        isDM: false,
        members: [adminId],
        avatarColor: '#25D366',
        createdAt: new Date().toISOString()
      }
    ],
    messages: [],
    sessions: {},
    clearedAt: {}
  };
}

function ensureAdmin(data) {
  const superAdmin = data.users.find(u => u.id === 'user_admin');
  if (superAdmin) {
    superAdmin.isAdmin = true;
    superAdmin.isSuperAdmin = true;
    const general = data.rooms.find(r => r.id === 'room_general');
    if (general && !general.members.includes(superAdmin.id)) {
      general.members.push(superAdmin.id);
    }
    data.users.forEach(u => {
      if (u.id !== 'user_admin') {
        u.isSuperAdmin = false;
      }
    });
    return false;
  }
  const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const adminId = 'user_admin';
  data.users.push({
    id: adminId,
    username: ADMIN_USERNAME,
    password: adminHash,
    avatarColor: '#e74c3c',
    isAdmin: true,
    isSuperAdmin: true,
    createdAt: new Date().toISOString()
  });
  const general = data.rooms.find(r => r.id === 'room_general');
  if (general && !general.members.includes(adminId)) {
    general.members.push(adminId);
  }
  return true;
}

// ── INICIALIZAÇÃO ASSÍNCRONA ─────────────────────────────

async function init() {
  // Valida credenciais do admin - env vars SÃO obrigatórias
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error(
      '❌ ADMIN_USER e ADMIN_PASS são obrigatórios!\n' +
      '   Configure as variáveis de ambiente antes de iniciar:\n' +
      '   ADMIN_USER=seu_nome ADMIN_PASS=sua_senha npm start'
    );
  }

  const DATABASE_URL = process.env.DATABASE_URL;
  if (DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production'
          ? { rejectUnauthorized: false }
          : false
      });

      // Testa conexão
      await pool.query('SELECT 1');

      // Cria tabela se não existir
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_state (
          id INTEGER PRIMARY KEY,
          data JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `);

      // Carrega dados existentes ou cria iniciais
      const result = await pool.query('SELECT data FROM app_state WHERE id = 1');
      if (result.rows.length === 0) {
        cache = getInitialData();
        await pool.query(
          'INSERT INTO app_state (id, data) VALUES (1, $1)',
          [JSON.stringify(cache)]
        );
        console.log('📦 Dados iniciais criados no PostgreSQL.');
      } else {
        const raw = result.rows[0].data;
        cache = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (ensureAdmin(cache)) {
          await pool.query(
            'UPDATE app_state SET data = $1 WHERE id = 1',
            [JSON.stringify(cache)]
          );
        }
        console.log(`📦 Dados carregados do PostgreSQL (${cache.users.length} usuários, ${cache.rooms.length} salas, ${cache.messages.length} mensagens).`);
      }

      usingPostgres = true;
      console.log('✅ PostgreSQL conectado com sucesso!');
      return;
    } catch (err) {
      console.error('❌ Erro ao conectar PostgreSQL:', err.message);
      console.log('📁 Usando db.json como fallback...');
      if (pool) {
        try { await pool.end(); } catch {}
        pool = null;
      }
    }
  }

  // Fallback: carrega do arquivo local
  cache = loadFromDisk();
  console.log('📁 Usando db.json local.');
}

// ── LEITURA / ESCRITA EM ARQUIVO ─────────────────────────

function loadFromDisk() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const data = getInitialData();
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
      return data;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (ensureAdmin(data)) {
      scheduleSave(data);
    }
    return data;
  } catch (err) {
    console.error('Erro ao carregar db.json, criando dados iniciais:', err.message);
    const data = getInitialData();
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch {}
    return data;
  }
}

function saveToDisk(data) {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar db.json:', err.message);
  }
}

// ── LEITURA / ESCRITA NO POSTGRESQL ──────────────────────

async function saveToPostgres(data) {
  if (!pool) return;
  try {
    await pool.query(
      'UPDATE app_state SET data = $1 WHERE id = 1',
      [JSON.stringify(data)]
    );
  } catch (err) {
    console.error('Erro ao salvar no PostgreSQL:', err.message);
  }
}

function scheduleSave(data) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (usingPostgres) {
      saveToPostgres(data);
    } else {
      saveToDisk(data);
    }
  }, 200);
}

// ── API PÚBLICA ──────────────────────────────────────────

function read() {
  if (!cache) {
    cache = loadFromDisk();
  }
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
      try {
        await saveToPostgres(cache);
        console.log('💾 Dados salvos no PostgreSQL.');
      } catch (err) {
        console.error('Erro ao salvar no PostgreSQL durante flush:', err.message);
      }
      try {
        await pool.end();
        pool = null;
      } catch {}
    } else {
      saveToDisk(cache);
    }
  }
}

module.exports = { init, read, write, flush };
