const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.resolve(__dirname, '../data/db.json');

const ADMIN_USERNAME = process.env.ADMIN_USER || 'davyf22l';
const ADMIN_PASSWORD = process.env.ADMIN_PASS || '@Davyf22l5820';

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
  const exists = data.users.find(u => u.id === 'user_admin' || u.isAdmin === true);
  if (exists) {
    // Garante que o admin existente tenha isAdmin
    exists.isAdmin = true;
    // Garante que o admin seja membro da sala Geral
    const general = data.rooms.find(r => r.id === 'room_general');
    if (general && !general.members.includes(exists.id)) {
      general.members.push(exists.id);
    }
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
    createdAt: new Date().toISOString()
  });
  // Adiciona o novo admin na sala Geral
  const general = data.rooms.find(r => r.id === 'room_general');
  if (general && !general.members.includes(adminId)) {
    general.members.push(adminId);
  }
  return true;
}

function read() {
  if (!fs.existsSync(DB_PATH)) {
    const data = getInitialData();
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return data;
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  const data = JSON.parse(raw);
  // Garante que sempre exista um admin
  if (ensureAdmin(data)) {
    write(data);
  }
  return data;
}

function write(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { read, write };
