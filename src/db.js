const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.resolve(__dirname, '../data/db.json');

const ADMIN_USERNAME = process.env.ADMIN_USER || 'davyf22l';
const ADMIN_PASSWORD = process.env.ADMIN_PASS || '@Davyf22l5820';

// Cache em memoria - evita ler do disco em toda requisicao
let cache = null;
let saveTimer = null;
let isSaving = false;

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
  // Só o user com id 'user_admin' pode ser super admin
  const superAdmin = data.users.find(u => u.id === 'user_admin');
  if (superAdmin) {
    superAdmin.isAdmin = true;
    superAdmin.isSuperAdmin = true;
    const general = data.rooms.find(r => r.id === 'room_general');
    if (general && !general.members.includes(superAdmin.id)) {
      general.members.push(superAdmin.id);
    }
    // Garante que nenhum outro usuario tenha isSuperAdmin
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

function scheduleSave(data) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveToDisk(data);
    saveTimer = null;
  }, 200);
}

// --- API PUBLICA ---

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

// Forca save imediato (pra usar antes de desligar)
function flush() {
  if (cache) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    saveToDisk(cache);
  }
}

module.exports = { read, write, flush };
