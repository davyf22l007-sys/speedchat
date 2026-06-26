# SpeedChat - Instrucoes

## Senhas e Acessos

### GitHub
- Email: davyf22l007@gmail.com
- Senha: @Larissaedavy992086495
- Usuario: davyf22l007-sys
- Repo: https://github.com/davyf22l007-sys/speedchat

### Render.com
- Email: felicianocosta15@gmail.com
- Senha: @Davyf22l5820
- Site: https://speedchat-6gxy.onrender.com (db.json - dados resetam)

### Ngrok
- Token: 28XudngLfqNLdDZnukijEDY75P7_3VmtQgcW6R6nrCte2DepP
- Dominio: revolt-designer-dilation.ngrok-free.dev
- Porta local: 3456

### Admin do chat
- Usuario: davyf22l
- Senha: @Davyf22l5820

---

## Como fazer

### Rodar LOCALMENTE (recomendado - dados persistentes)
- Execute iniciar_speedchat.bat
- Banco SQLite em D:\speedchat_data\speedchat.db (NUNCA RESETA)
- Servidor: http://localhost:3456
- Publico (ngrok): https://revolt-designer-dilation.ngrok-free.dev

### Migrar dados do db.json pro SQLite
- Ja foi migrado automaticamente na primeira execucao
- Para rodar manualmente: node migrar_sqlite.js

### Deploy no Render (so pra ter o site no ar, dados resetam)
- Push pro GitHub, Render faz deploy automatico
- URL: https://speedchat-6gxy.onrender.com
- No render os dados NAO persistem (usa db.json)
- Use o servidor LOCAL para dados permanentes

---

## Arquivos importantes
- D:\speedchat_data\speedchat.db - Banco SQLite com TODOS os dados
- src/db.js - Agora usa SQLite (sem postgres, sem aiven)
- migrar_sqlite.js - Script pra migrar db.json pro SQLite
- iniciar_speedchat.bat - Inicia servidor com SQLite + ngrok

---

## Correcoes aplicadas
- Cache em memoria no db.js
- Cache de msgs no frontend
- Duplicacao resolvida
- Fila de msgs pendentes
- Dedup no servidor
- Reconexao websocket
- Banco SQLite local (D:) - dados nunca mais resetam
- Removida dependencia de PostgreSQL/Aiven/Render
