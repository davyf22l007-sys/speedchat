const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('./api');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '../public/uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/gif':  '.gif',
  'image/webp': '.webp'
};

// POST /api/upload/image
// Body: { data: "<base64>", mime: "image/jpeg" }
router.post('/image', requireAuth, async (req, res) => {
  const { data, mime } = req.body;

  if (!data || !mime) {
    return res.status(400).json({ error: 'Campos obrigatórios: data, mime.' });
  }

  if (!ALLOWED_MIME[mime]) {
    return res.status(400).json({ error: 'Tipo não permitido. Use JPEG, PNG, GIF ou WEBP.' });
  }

  try {
    const buffer = Buffer.from(data, 'base64');

    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'Imagem muito grande. Máximo 8MB.' });
    }

    // Retorna data URL — persiste no banco sem depender do disco
    const url = `data:${mime};base64,${data}`;
    res.json({ url });
  } catch (err) {
    console.error('Erro ao processar imagem:', err.message);
    res.status(500).json({ error: 'Erro ao processar imagem: ' + err.message });
  }
});

module.exports = router;
