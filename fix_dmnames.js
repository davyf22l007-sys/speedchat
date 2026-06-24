const fs = require('fs');
const path = require('path');
const dbPath = path.resolve('data/db.json');
let data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));

const room1 = data.rooms.find(r => r.id === 'room_132617fa');
const room2 = data.rooms.find(r => r.id === 'room_12b347ee');

if (room1) {
  console.log('room_132617fa dmNames antes:', JSON.stringify(room1.dmNames));
  room1.dmNames['user_admin'] = 'dani';
  console.log('room_132617fa dmNames depois:', JSON.stringify(room1.dmNames));
}

if (room2) {
  console.log('room_12b347ee dmNames antes:', JSON.stringify(room2.dmNames));
  room2.dmNames['user_admin'] = 'davy';
  console.log('room_12b347ee dmNames depois:', JSON.stringify(room2.dmNames));
}

fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
console.log('banco atualizado com sucesso');
