const http = require('http');
const host = 'localhost';
const port = 3456;

function get(path, cookie) {
  return new Promise((resolve) => {
    const opts = { hostname: host, port, path, method: 'GET' };
    if (cookie) opts.headers = { 'Cookie': cookie };
    const req = http.get(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.end();
  });
}

function post(path, body, cookie) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: host, port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    if (cookie) opts.headers['Cookie'] = cookie;
    const req = http.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.write(data);
    req.end();
  });
}

function put(path, body, cookie) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: host, port, path, method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    if (cookie) opts.headers['Cookie'] = cookie;
    const req = http.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== TESTE API SENHA ===\n');

  // 1. Login - usa env vars (sem fallback por segurança)
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;
  if (!adminUser || !adminPass) {
    console.log('❌ Configure ADMIN_USER e ADMIN_PASS pra rodar os testes');
    return;
  }
  const login = await post('/auth/login', { username: adminUser, password: adminPass });
  const cookie = login.cookie;
  console.log('1. LOGIN:', login.status, cookie ? 'OK' : 'FAIL');

  if (!cookie) {
    console.log('LOGIN FALHOU - servidor rodando?');
    return;
  }

  // 2. Pegar grupos
  const roomsRes = await get('/admin/rooms', cookie);
  const rooms = JSON.parse(roomsRes.body);
  console.log('2. GRUPOS:', rooms.length, 'status:', roomsRes.status);
  rooms.forEach(r => console.log('   -', r.name, '(' + r.id + ')'));
  
  if (rooms.length === 0) {
    console.log('NAO TEM GRUPOS');
    return;
  }

  const rid = rooms[0].id;
  console.log('\n3. TESTANDO SENHA NO GRUPO:', rooms[0].name);
  
  // 3. Check password BEFORE
  const checkBefore = await get(`/admin/rooms/${rid}/password`, cookie);
  console.log('   ANTES:', checkBefore.status, checkBefore.body);

  // 4. Set password
  const setPw = await put(`/admin/rooms/${rid}/password`, { password: 'teste123' }, cookie);
  console.log('   SET PASSWORD:', setPw.status, setPw.body);
  
  // 5. Check password AFTER
  const checkAfter = await get(`/admin/rooms/${rid}/password`, cookie);
  console.log('   DEPOIS:', checkAfter.status, checkAfter.body);
  
  // 6. Set com senha CURTA pra testar validacao
  const setPw2 = await put(`/admin/rooms/${rid}/password`, { password: 'ab' }, cookie);
  console.log('   SET PASSWORD CURTA (2 chars):', setPw2.status, setPw2.body);

  console.log('\n=== FIM ===');
}

main();
