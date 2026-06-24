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

app.use(express.json({ limit: '300mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

setupWebSocket(wss);

const PORT = process.env.PORT || 3456;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SpeedChat rodando em ${PUBLIC_URL}`);
});
