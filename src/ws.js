const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const clients = new Map();
const typingTimers = new Map();
const recentMessages = new Map(); // dedup: authorId+content -> timestamp // roomId -> Set<username>

function setupWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies['session'];

    if (!token) {
      ws.close(1008, 'Não autenticado');
      return;
    }

    const data = db.read();
    const session = data.sessions[token];
    if (!session) {
      ws.close(1008, 'Sessão inválida');
      return;
    }

    const user = data.users.find(u => u.id === session.userId);
    if (!user) {
      ws.close(1008, 'Usuário não encontrado');
      return;
    }

    const clientId = uuidv4();
    clients.set(clientId, { ws, userId: user.id, username: user.username });

    ws.send(JSON.stringify({ type: 'connected', userId: user.id, username: user.username }));

    broadcastPresence();

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {
        case 'send_message':
          handleMessage(clientId, msg);
          break;
        case 'typing':
          handleTyping(clientId, msg);
          break;
        case 'delete_message':
          handleDeleteMessage(clientId, msg);
          break;
        case 'edit_message':
          handleEditMessage(clientId, msg);
          break;
        case 'read_receipt':
          handleReadReceipt(clientId, msg);
          break;
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      // Remove typing status ao desconectar
      for (const [roomId, typingSet] of typingTimers.entries()) {
        if (typingSet.has(clientId)) {
          typingSet.delete(clientId);
          broadcast({ type: 'typing_stop', roomId, username: user.username }, clientId);
        }
      }
      broadcastPresence();
    });
  });
}

const processedMsgIds = new Set(); // dedup global por ID

function handleMessage(clientId, msg) {
  // Dedup: ignorar mesma mensagem em menos de 10s
  if (msg.content) {
    const dedupKey = clientId + ':' + msg.content + ':' + (msg.roomId || '');
    const now = Date.now();
    if (recentMessages.has(dedupKey)) {
      const last = recentMessages.get(dedupKey);
      if (now - last < 10000) return;
    }
    recentMessages.set(dedupKey, now);
    // Limpar entradas antigas a cada 100 mensagens
    if (recentMessages.size > 100) {
      const cutoff = now - 30000;
      for (const [k, t] of recentMessages) {
        if (t < cutoff) recentMessages.delete(k);
      }
    }
  }
  const client = clients.get(clientId);
  if (!client) return;

  const { roomId, content, msgType, replyTo } = msg;
  if (!content || !content.trim()) return;

  const data = db.read();
  const room = data.rooms.find(r => r.id === roomId);
  if (!room || !room.members.includes(client.userId)) return;    const user = data.users.find(u => u.id === client.userId);

    const message = {
      id: 'msg_' + uuidv4().split('-')[0],
      roomId,
      authorId: client.userId,
      authorName: client.username,
      authorAvatarData: user?.avatarData || null,
      content: content.trim(),
      type: msgType || 'text',
      timestamp: new Date().toISOString(),
      edited: false,
      deleted: false
    };

  if (replyTo) {
    const original = data.messages.find(m => m.id === replyTo);
    if (original && original.roomId === roomId && !original.deleted) {
      message.replyTo = {
        id: original.id,
        authorName: original.authorName,
        content: original.type === 'image' ? '📷 Imagem' : original.type === 'file' ? '📄 Documento' : original.content.substring(0, 80),
        type: original.type
      };
    }
  }

  // Dedup por ID de mensagem (pra reconexao)
  if (processedMsgIds.has(message.id)) return;
  processedMsgIds.add(message.id);
  // Limpa IDs antigos a cada 200 mensagens
  if (processedMsgIds.size > 200) {
    const idsArray = [...processedMsgIds];
    processedMsgIds.clear();
    idsArray.slice(-100).forEach(id => processedMsgIds.add(id));
  }

  data.messages.push(message);
  db.write(data);

  // Para o typing indicator quando envia
  stopTyping(clientId, roomId);

  // NÃO envia de volta pro próprio remetente (ele já tem a msg local otimista)
  broadcast({ type: 'new_message', message }, clientId);
}

function handleTyping(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;
  const { roomId } = msg;
  if (!roomId) return;

  // Inicia typing
  if (!typingTimers.has(roomId)) typingTimers.set(roomId, new Set());
  const typingSet = typingTimers.get(roomId);
  
  if (!typingSet.has(clientId)) {
    typingSet.add(clientId);
    broadcast({ type: 'typing_start', roomId, username: client.username }, clientId);
  }

  // Auto-stop depois de 3s se não enviar mais nada
  if (client._typingTimer) clearTimeout(client._typingTimer);
  client._typingTimer = setTimeout(() => {
    stopTyping(clientId, roomId);
  }, 3000);
}

function stopTyping(clientId, roomId) {
  const client = clients.get(clientId);
  if (!client) return;
  const typingSet = typingTimers.get(roomId);
  if (typingSet && typingSet.has(clientId)) {
    typingSet.delete(clientId);
    broadcast({ type: 'typing_stop', roomId, username: client.username }, clientId);
  }
  if (client._typingTimer) {
    clearTimeout(client._typingTimer);
    client._typingTimer = null;
  }
}

function handleDeleteMessage(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;
  const { messageId, roomId } = msg;
  if (!messageId || !roomId) return;

  const data = db.read();
  const msgIndex = data.messages.findIndex(m => m.id === messageId && m.roomId === roomId);
  if (msgIndex === -1) return;
  if (data.messages[msgIndex].authorId !== client.userId) return;

  data.messages[msgIndex].deleted = true;
  data.messages[msgIndex].content = '';
  data.messages[msgIndex].type = 'text';
  db.write(data);

  broadcast({ type: 'message_deleted', messageId, roomId });
}

function handleEditMessage(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;
  const { messageId, roomId, content } = msg;
  if (!messageId || !roomId || !content || !content.trim()) return;

  const data = db.read();
  const msgIndex = data.messages.findIndex(m => m.id === messageId && m.roomId === roomId);
  if (msgIndex === -1) return;
  if (data.messages[msgIndex].authorId !== client.userId) return;
  if (data.messages[msgIndex].deleted) return;

  data.messages[msgIndex].content = content.trim();
  data.messages[msgIndex].edited = true;
  db.write(data);

  broadcast({ type: 'message_edited', messageId, roomId, content: content.trim() });
}

function handleReadReceipt(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;
  const { messageId, roomId } = msg;
  if (!messageId || !roomId) return;

  const data = db.read();
  const message = data.messages.find(m => m.id === messageId && m.roomId === roomId);
  if (!message) return;
  if (message.authorId === client.userId) return; // não marca própria mensagem

  broadcast({ type: 'read_receipt', messageId, roomId, reader: client.username });
}

function broadcast(payload, excludeClientId) {
  const str = JSON.stringify(payload);
  for (const [id, { ws }] of clients.entries()) {
    if (id === excludeClientId) continue;
    if (ws.readyState === 1) ws.send(str);
  }
}

function broadcastAvatarUpdate(userId, avatarData) {
  broadcast({ type: 'avatar_updated', userId, avatarData });
}

function broadcastPresence() {
  const online = [...clients.values()].map(c => ({ username: c.username, userId: c.userId }));
  broadcast({ type: 'presence', online });
}

function parseCookies(cookieHeader) {
  const out = {};
  cookieHeader.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('='));
  });
  return out;
}

function broadcastGroupDeleted(roomId, memberIds) {
  // Envia pra todos os membros online do grupo
  for (const [id, { ws, userId }] of clients.entries()) {
    if (memberIds.includes(userId) && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'group_deleted', roomId }));
    }
  }
}

module.exports = { setupWebSocket, broadcastAvatarUpdate, broadcastGroupDeleted };
