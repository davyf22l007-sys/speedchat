const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_DIR = 'D:\speedchat_data';
const DB_PATH = path.join(DB_DIR, 'speedchat.db');
const DB_JSON = path.resolve(__dirname, 'data/db.json');
const ADMIN_USER = process.env.ADMIN_USER || 'davyf22l';
const ADMIN_PASS = process.env.ADMIN_PASS || '@Davyf22l5820';

console.log('=== MIGRAR DB.JSON PARA SQLITE ===\n');

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY, data TEXT)');

let data;

if (fs.existsSync(DB_JSON)) {
  try {
    const raw = fs.readFileSync(DB_JSON, 'utf-8');
    data = JSON.parse(raw);
    console.log('db.json carregado:');
    console.log('  ' + (data.users?.length || 0) + ' usuarios');
    console.log('  ' + (data.rooms?.length || 0) + ' salas');
    console.log('  ' + (data.messages?.length || 0) + ' mensagens');
  } catch (err) {
    console.error('Erro ao ler db.json:', err.message);
    data = null;
  }
} else {
  console.log('db.json nao encontrado');
  data = null;
}

if (!data) {
  const adminHash = bcrypt.hashSync(ADMIN_PASS, 10);
  data = {
    users: [{ id: 'user_admin', username: ADMIN_USER, password: adminHash, avatarColor: '#e74c3c', isAdmin: true, isSuperAdmin: true, createdAt: new Date().toISOString() }],
    rooms: [{ id: 'room_general', name: 'Geral', isDM: false, members: ['user_admin'], avatarColor: '#25D366', createdAt: new Date().toISOString() }],
    messages: [],
    sessions: {},
    clearedAt: {}
  };
  console.log('Dados iniciais criados.');
} else {
  const admin = data.users.find(u => u.id === 'user_admin');
  if (admin) {
    if (!admin.password || !admin.password.startsWith('$2a$')) {
      console.log('Corrigindo hash do admin...');
      admin.password = bcrypt.hashSync(ADMIN_PASS, 10);
    }
    admin.isAdmin = true;
    admin.isSuperAdmin = true;
    admin.username = ADMIN_USER;
  }
}

db.prepare('INSERT OR REPLACE INTO app_state (id, data) VALUES (1, ?)').run(JSON.stringify(data));

console.log('\nSalvo no SQLite em: ' + DB_PATH);
console.log('  ' + (data.users?.length || 0) + ' usuarios');
console.log('  ' + (data.rooms?.length || 0) + ' salas');
console.log('  ' + (data.messages?.length || 0) + ' mensagens');

db.close();
console.log('\nConcluido!');
