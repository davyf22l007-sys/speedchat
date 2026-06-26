const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./auth');
const { router: apiRoutes } = require('./api');
const uploadRoutes = require('./upload');
const adminRoutes = require('./admin');
const { setupWebSocket } = require('./ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Trust proxy pro rate limit e cookie secure funcionarem atras de proxy (Render, etc)
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, '../public')));

app.use('/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

setupWebSocket(wss);

const db = require('./db');

const PORT = process.env.PORT || 3456;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

server.on('error', (err) => {
  console.error('Erro ao iniciar servidor:', err.message);
  process.exit(1);
});

// Inicia o servidor depois de conectar o banco
async function start() {
  await db.init();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SpeedChat rodando em ${PUBLIC_URL}`);
  });
}

start().catch(err => {
  console.error('Erro fatal ao iniciar:', err);
  process.exit(1);
});

// Salva dados antes de desligar
process.on('SIGTERM', async () => {
  console.log('SIGTERM recebido, salvando dados...');
  try { await db.flush(); } catch {}
  process.exit(0);
});
process.on('SIGINT', async () => {
  console.log('SIGINT recebido, salvando dados...');
  try { await db.flush(); } catch {}
  process.exit(0);
});

// Loga qualquer erro nao tratado pra ajudar debug no Render
process.on('uncaughtException', (err) => {
  console.error('ERRO NAO TRATADO:', err.message, err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('PROMISE REJEITADA NAO TRATADA:', reason);
});
