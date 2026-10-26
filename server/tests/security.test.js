import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,validatePhone,amount} from '../src/security.js';
import {db} from '../src/db.js';
test('password di-hash scrypt dengan salt unik',()=>{
 const a=hashPassword('PasswordContoh123'),b=hashPassword('PasswordContoh123');
 assert.notEqual(a,b);assert.equal(verifyPassword('PasswordContoh123',a),true);assert.equal(verifyPassword('PasswordYangSalah',a),false);
});
test('normalisasi nomor telepon Indonesia',()=>{
 assert.equal(validatePhone('0812 3456 7890'),'6281234567890');
 assert.equal(validatePhone('+6281234567890'),'6281234567890');
 assert.throws(()=>validatePhone('abcdefgh'));
});
test('nominal transaksi harus bilangan bulat dalam batas',()=>{
 assert.equal(amount('6000'),6000);assert.throws(()=>amount('0'));assert.throws(()=>amount('6000.2'));
});
test('struktur database inti tersedia',()=>{
 for(const name of ['users','sessions','listings','service_orders','vouchers','conversations','messages','ledger']){
  const row=db.prepare("SELECT name FROM sqlite_master WHERE name=? AND type='table'").get(name);
  assert.ok(row,'Missing '+name);
 }
});
