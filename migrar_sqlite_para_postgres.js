const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const POSTGRES_URL = 'postgresql://speedchat_db_user:1u5fOI59a2hxAinJk4M1sV77wMV1jod2@dpg-d8vdt6gjs32c738vo48g-a/speedchat_db';
const SQLITE_PATH = 'D:\speedchat_data\speedchat.db';

async function main() {
  console.log('=== MIGRAR SQLITE PARA POSTGRES ===\n');

  // ler do sqlite
  let data;
  try {
    const sdb = new Database(SQLITE_PATH);
    const row = sdb.prepare('SELECT data FROM app_state WHERE id = 1').get();
    sdb.close();
    if (!row) { console.log('SQLite vazio.'); return; }
    data = JSON.parse(row.data);
    console.log('SQLite: ' + (data.users?.length || 0) + ' usuarios, ' + (data.rooms?.length || 0) + ' salas, ' + (data.messages?.length || 0) + ' mensagens\n');
  } catch (err) {
    console.error('Erro ao ler SQLite:', err.message);
    return;
  }

  // conectar no postgres
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await pool.query('SELECT 1');
    console.log('Conectado ao PostgreSQL do Render!');
  } catch (err) {
    console.error('Erro ao conectar:', err.message);
    await pool.end();
    return;
  }

  // cria tabela (usando crase pra evitar problemas com aspas)
  const sql = `CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb)`;
  await pool.query(sql);

  // merge com dados existentes
  const existing = await pool.query('SELECT data FROM app_state WHERE id = 1');
  if (existing.rows.length > 0) {
    const old = typeof existing.rows[0].data === 'string' ? JSON.parse(existing.rows[0].data) : existing.rows[0].data;
    console.log('PostgreSQL ja tem ' + (old.users?.length || 0) + ' usuarios');
    const ids = new Set(old.users.map(u => u.id));
    for (const u of data.users || []) {
      if (!ids.has(u.id)) { old.users.push(u); ids.add(u.id); }
      else if (u.id === 'user_admin') {
        const idx = old.users.findIndex(x => x.id === 'user_admin');
        if (idx >= 0) { old.users[idx].isAdmin = true; old.users[idx].isSuperAdmin = true; }
      }
    }
    const rids = new Set(old.rooms.map(r => r.id));
    for (const r of data.rooms || []) { if (!rids.has(r.id)) { old.rooms.push(r); rids.add(r.id); } }
    const mids = new Set(old.messages.map(m => m.id));
    for (const m of data.messages || []) { if (!mids.has(m.id)) { old.messages.push(m); mids.add(m.id); } }
    data = old;
  }

  await pool.query('INSERT INTO app_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1', [JSON.stringify(data)]);

  console.log('Salvo no PostgreSQL do Render!');
  console.log('' + (data.users?.length || 0) + ' usuarios, ' + (data.rooms?.length || 0) + ' salas, ' + (data.messages?.length || 0) + ' mensagens');

  await pool.end();
  console.log('Concluido!');
}

main().catch(err => { console.error('Erro:', err); process.exit(1); });
