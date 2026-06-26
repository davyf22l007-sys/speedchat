// ── SANITIZAÇÃO SERVER-SIDE ──────────────────────────────
// Usado pra evitar XSS no backend (camada extra além do escape no front)

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeContent(str) {
  if (typeof str !== 'string') return '';
  // Remove tags script maliciosas completas (com conteudo)
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Escapa caracteres HTML em vez de remover — preserva <3, a < b, codigo, etc
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .trim();
}

// Apenas remove tags script sem escapar HTML — pra campos que o frontend já escapa (ex: bio)
function stripScriptTags(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').trim();
}

module.exports = { escapeHtml, sanitizeContent, stripScriptTags };
