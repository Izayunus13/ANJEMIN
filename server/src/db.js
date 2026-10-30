import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createPostgresDatabase} from './postgres-db.js';

const connectionString=process.env.DATABASE_URL;
const driver=process.env.ANJEMIN_DB_DRIVER||(connectionString||process.env.VERCEL?'postgres':'sqlite');
export const remoteDatabase=driver!=='sqlite';
let database;
if(remoteDatabase){
 database=createPostgresDatabase({connectionString,driver});
}else{
 const folder=path.resolve(process.env.ANJEMIN_DATA_DIR||'server/data');
 fs.mkdirSync(folder,{recursive:true});
 database=new DatabaseSync(path.join(folder,'anjemin.sqlite'));
}
export const db=database;

function initializeSchema(){
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, full_name TEXT NOT NULL, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE, phone TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('CUSTOMER','DRIVER','ADMIN')),
  driver_status TEXT NOT NULL DEFAULT 'NONE' CHECK(driver_status IN ('NONE','PENDING','APPROVED','REJECTED')),
  ready INTEGER NOT NULL DEFAULT 0, ktm_path TEXT, campus_email TEXT, vehicle TEXT,
  sim_declared INTEGER DEFAULT 0, referral_code TEXT NOT NULL UNIQUE, referred_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(referred_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS signup_otp (
 phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0,
 last_sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS listings (
 id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price>0), description TEXT NOT NULL, image_path TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','RESERVED','SOLD')),
 buyer_id TEXT, agreed_price INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(seller_id) REFERENCES users(id), FOREIGN KEY(buyer_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS conversations (
 id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(listing_id,buyer_id),
 FOREIGN KEY(listing_id) REFERENCES listings(id), FOREIGN KEY(buyer_id) REFERENCES users(id),
 FOREIGN KEY(seller_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL,
 body TEXT NOT NULL, offer_amount INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(conversation_id) REFERENCES conversations(id), FOREIGN KEY(sender_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS vouchers (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL,
 redeemed_order_id TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS service_orders (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, driver_id TEXT,
 type TEXT NOT NULL CHECK(type IN ('RIDE','DELIVERY','JASTIP')),
 pickup TEXT NOT NULL, destination TEXT NOT NULL,
 pickup_lat REAL, pickup_lng REAL, destination_lat REAL, destination_lng REAL,
 item_name TEXT, item_category TEXT, item_weight REAL, image_path TEXT,
 place_id TEXT, place_name TEXT, notes TEXT NOT NULL DEFAULT '',
 fare INTEGER NOT NULL CHECK(fare>0), platform_fee INTEGER NOT NULL, promo_discount INTEGER NOT NULL DEFAULT 0,
 voucher_id TEXT, status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLAIMED','COMPLETED','CANCELLED')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT,
 FOREIGN KEY(customer_id) REFERENCES users(id), FOREIGN KEY(driver_id) REFERENCES users(id),
 FOREIGN KEY(voucher_id) REFERENCES vouchers(id)
);
CREATE TABLE IF NOT EXISTS order_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id TEXT NOT NULL REFERENCES service_orders(id),
 sender_id TEXT NOT NULL REFERENCES users(id),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_order_messages ON order_messages(order_id,id);
CREATE TABLE IF NOT EXISTS ledger (
 id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL UNIQUE,
 gross_fee INTEGER NOT NULL, promo_cost INTEGER NOT NULL DEFAULT 0, collected INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS referral_awards (
 referred_user_id TEXT PRIMARY KEY, inviter_id TEXT NOT NULL, order_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_status_type ON service_orders(status,type);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON service_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status,created_at);
CREATE INDEX IF NOT EXISTS idx_vouchers_available ON vouchers(user_id,redeemed_order_id,expires_at);
`);

// Only newly registered accounts must complete the new profile step.
for(const [name,definition] of [
 ['profile_photo_path','TEXT'],
 ['profile_required','INTEGER NOT NULL DEFAULT 0 CHECK(profile_required IN (0,1))'],
 ['profile_completed_at','TEXT']
])if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name===name))db.exec('ALTER TABLE users ADD COLUMN '+name+' '+definition);

// Driver documents remain nullable for accounts created before document uploads were required.
if(!db.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='sim_type')){
 db.exec("ALTER TABLE users ADD COLUMN sim_type TEXT CHECK(sim_type IN ('A','C'))");
}
if(!db.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='sim_path')){
 db.exec('ALTER TABLE users ADD COLUMN sim_path TEXT');
}

// Upgrade existing local databases without changing existing orders.
if(!db.prepare('PRAGMA table_info(service_orders)').all().some(column=>column.name==='vehicle_type')){
 db.exec("ALTER TABLE service_orders ADD COLUMN vehicle_type TEXT NOT NULL DEFAULT 'MOTOR' CHECK(vehicle_type IN ('MOTOR','MOBIL'))");
}

if(!db.prepare('PRAGMA table_info(listings)').all().some(column=>column.name==='image_paths')){
 db.exec("ALTER TABLE listings ADD COLUMN image_paths TEXT NOT NULL DEFAULT '[]'");
}


if(!db.prepare('PRAGMA table_info(service_orders)').all().some(c=>c.name==='payment_required')){
 db.exec('ALTER TABLE service_orders ADD COLUMN payment_required INTEGER NOT NULL DEFAULT 0');
 db.exec('ALTER TABLE service_orders ADD COLUMN delivery_reported_at TEXT');
}
db.exec("CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES service_orders(id), mode TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0), status TEXT NOT NULL CHECK(status IN ('CREATING','PENDING','HELD','RELEASED','EXPIRED','FAILED')), qr_url TEXT, expires_at TEXT NOT NULL, paid_at TEXT, released_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
db.exec("CREATE TABLE IF NOT EXISTS wallet_credits (id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES users(id), order_id TEXT NOT NULL UNIQUE REFERENCES service_orders(id), payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id), amount INTEGER NOT NULL CHECK(amount>=0), mode TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");


// Existing listings keep their publication; new API uploads explicitly require payment.
if(!db.prepare('PRAGMA table_info(listings)').all().some(c=>c.name==='publication_required'))db.exec('ALTER TABLE listings ADD COLUMN publication_required INTEGER NOT NULL DEFAULT 0 CHECK(publication_required IN (0,1))');
db.exec(`CREATE TABLE IF NOT EXISTS listing_fee_payments (
 id TEXT PRIMARY KEY,listing_id TEXT NOT NULL UNIQUE REFERENCES listings(id),
 mode TEXT NOT NULL CHECK(mode IN ('SIMULATION','MIDTRANS_SANDBOX','MIDTRANS_LIVE')),
 amount INTEGER NOT NULL CHECK(amount=3000),
 status TEXT NOT NULL CHECK(status IN ('CREATING','PENDING','PAID','EXPIRED','FAILED')),
 qr_url TEXT,expires_at TEXT NOT NULL,paid_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

// Stable short account numbers for existing and future users.
db.exec(`
 CREATE TABLE IF NOT EXISTS user_numbers (
  number INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
 );
 INSERT INTO user_numbers(user_id)
 SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM user_numbers)
 ORDER BY created_at,id;
 CREATE TRIGGER IF NOT EXISTS assign_user_number AFTER INSERT ON users
 BEGIN INSERT INTO user_numbers(user_id) VALUES(NEW.id); END;
`);

db.exec(`CREATE TABLE IF NOT EXISTS order_reports (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES service_orders(id),reporter_id TEXT NOT NULL REFERENCES users(id),
 category TEXT NOT NULL CHECK(category IN ('DANGER','SUSPICIOUS','LOST_ITEM')),details TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

// Account access is separate from driver verification.
if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='account_status')){
 db.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(account_status IN ('ACTIVE','FROZEN'))");
}
if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='frozen_at'))db.exec('ALTER TABLE users ADD COLUMN frozen_at TEXT');
if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='freeze_reason'))db.exec('ALTER TABLE users ADD COLUMN freeze_reason TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS account_status_history (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),admin_id TEXT NOT NULL REFERENCES users(id),
 previous_status TEXT NOT NULL,new_status TEXT NOT NULL,reason TEXT NOT NULL,
 report_id TEXT REFERENCES order_reports(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

// Unknown historical entries remain separate from simulation and live income.
if(!db.prepare('PRAGMA table_info(ledger)').all().some(c=>c.name==='mode')){
 db.exec("ALTER TABLE ledger ADD COLUMN mode TEXT NOT NULL DEFAULT 'LEGACY'");
 db.exec("UPDATE ledger SET mode=(SELECT p.mode FROM payments p WHERE p.order_id=ledger.source_id) WHERE source_type='SERVICE' AND EXISTS(SELECT 1 FROM payments p WHERE p.order_id=ledger.source_id)");
}

// Keep marketplace history even when a cancelled listing is reserved again.
db.exec(`CREATE TABLE IF NOT EXISTS market_orders (
 id TEXT PRIMARY KEY,listing_id TEXT NOT NULL REFERENCES listings(id),
 buyer_id TEXT NOT NULL REFERENCES users(id),seller_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,category TEXT NOT NULL,image_path TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),
 status TEXT NOT NULL CHECK(status IN ('RESERVED','SOLD','CANCELLED')),
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,completed_at TEXT,cancelled_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_market_order ON market_orders(listing_id) WHERE status='RESERVED';
CREATE INDEX IF NOT EXISTS market_orders_buyer ON market_orders(buyer_id,created_at);
CREATE INDEX IF NOT EXISTS market_orders_seller ON market_orders(seller_id,created_at);
INSERT INTO market_orders(id,listing_id,buyer_id,seller_id,title,category,image_path,amount,status,created_at)
 SELECT 'legacy-'||l.id,l.id,l.buyer_id,l.seller_id,l.title,l.category,l.image_path,COALESCE(l.agreed_price,l.price),l.status,NULL
 FROM listings l WHERE l.buyer_id IS NOT NULL AND l.status IN ('RESERVED','SOLD')
 AND NOT EXISTS(SELECT 1 FROM market_orders o WHERE o.listing_id=l.id AND o.buyer_id=l.buyer_id AND o.status=l.status);
INSERT OR IGNORE INTO conversations(id,listing_id,buyer_id,seller_id)
 SELECT lower(hex(randomblob(16))),listing_id,buyer_id,seller_id FROM market_orders;
`);

if(!db.prepare('PRAGMA table_info(market_orders)').all().some(c=>c.name==='payment_required'))db.exec('ALTER TABLE market_orders ADD COLUMN payment_required INTEGER NOT NULL DEFAULT 0');
if(!db.prepare('PRAGMA table_info(market_orders)').all().some(c=>c.name==='handover_at'))db.exec('ALTER TABLE market_orders ADD COLUMN handover_at TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS market_payments (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE REFERENCES market_orders(id),mode TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>0),platform_fee INTEGER NOT NULL CHECK(platform_fee>=0 AND platform_fee<=amount),
 status TEXT NOT NULL CHECK(status IN ('PENDING','HELD','RELEASED','EXPIRED','CANCELLED','REFUNDED')),
 expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,paid_at TEXT,released_at TEXT,refunded_at TEXT
);
CREATE TABLE IF NOT EXISTS market_wallet_credits (
 id TEXT PRIMARY KEY,seller_id TEXT NOT NULL REFERENCES users(id),order_id TEXT NOT NULL UNIQUE REFERENCES market_orders(id),
 payment_id TEXT NOT NULL UNIQUE REFERENCES market_payments(id),amount INTEGER NOT NULL CHECK(amount>=0),mode TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS market_withdrawals (
 id TEXT PRIMARY KEY,seller_id TEXT NOT NULL REFERENCES users(id),mode TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>0),channel TEXT NOT NULL CHECK(channel IN ('BANK','EWALLET')),
 provider TEXT NOT NULL,account_name TEXT NOT NULL,masked_number TEXT NOT NULL,
 request_key TEXT NOT NULL,request_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status='SIMULATED'),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(seller_id,request_key)
);
CREATE INDEX IF NOT EXISTS market_withdrawals_seller ON market_withdrawals(seller_id,mode,created_at)`);

db.exec(`CREATE TABLE IF NOT EXISTS driver_withdrawals (
 id TEXT PRIMARY KEY,driver_id TEXT NOT NULL REFERENCES users(id),mode TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>0),channel TEXT NOT NULL CHECK(channel IN ('BANK','EWALLET')),
 provider TEXT NOT NULL,account_name TEXT NOT NULL,masked_number TEXT NOT NULL,
 request_key TEXT NOT NULL,request_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status='SIMULATED'),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(driver_id,request_key)
);
CREATE INDEX IF NOT EXISTS driver_withdrawals_driver ON driver_withdrawals(driver_id,mode,created_at)`);


if(!db.prepare('PRAGMA table_info(order_messages)').all().some(c=>c.name==='media_only'))db.exec('ALTER TABLE order_messages ADD COLUMN media_only INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS order_message_media (
 id TEXT PRIMARY KEY,message_id INTEGER NOT NULL UNIQUE REFERENCES order_messages(id) ON DELETE CASCADE,
 order_id TEXT NOT NULL REFERENCES service_orders(id),sender_id TEXT NOT NULL REFERENCES users(id),
 file_path TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 3145728),
 request_key TEXT NOT NULL,request_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(order_id,sender_id,request_key)
);
CREATE INDEX IF NOT EXISTS order_media_order ON order_message_media(order_id)`);


for(const name of ['delivered_at','read_at'])if(!db.prepare('PRAGMA table_info(order_messages)').all().some(c=>c.name===name))db.exec('ALTER TABLE order_messages ADD COLUMN '+name+' TEXT');
db.exec('CREATE INDEX IF NOT EXISTS order_messages_pending_delivery ON order_messages(delivered_at,order_id,id)');

// Claimed achievement bonuses are immutable wallet credits, separate from order income.
db.exec(`CREATE TABLE IF NOT EXISTS driver_achievement_rewards (
 id TEXT PRIMARY KEY,driver_id TEXT NOT NULL REFERENCES users(id),milestone TEXT NOT NULL,
 target INTEGER NOT NULL CHECK(target>0),title TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),
 mode TEXT NOT NULL CHECK(mode='SIMULATION'),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(driver_id,milestone,mode)
);
CREATE INDEX IF NOT EXISTS driver_rewards_account ON driver_achievement_rewards(driver_id,mode,created_at)`);

// Consent records are separate from uploaded identity documents.
db.exec(`CREATE TABLE IF NOT EXISTS driver_rules_consents (
 user_id TEXT NOT NULL REFERENCES users(id),
 rules_version TEXT NOT NULL,
 accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,rules_version)
)`);

 if(remoteDatabase){
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users(lower(username))');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users(lower(email))');
  db.exec('CREATE TABLE IF NOT EXISTS stored_files(name TEXT PRIMARY KEY,body BYTEA NOT NULL)');
 }
}
if(remoteDatabase)db.exec('BEGIN IMMEDIATE');
try{
 const marker=remoteDatabase?db.prepare("SELECT to_regclass('_anjemin_schema_version') AS relation").get().relation:null;
 const current=marker?db.prepare('SELECT version FROM _anjemin_schema_version ORDER BY version DESC LIMIT 1').get()?.version:null;
 if(!remoteDatabase||current!==2){
  initializeSchema();
  if(remoteDatabase){
   db.exec('CREATE TABLE IF NOT EXISTS _anjemin_schema_version(version INTEGER PRIMARY KEY)');
   db.prepare('INSERT INTO _anjemin_schema_version(version) VALUES(?) ON CONFLICT DO NOTHING').run(2);
  }
 }
 if(remoteDatabase)db.exec('COMMIT');
}catch(error){
 if(remoteDatabase){try{db.exec('ROLLBACK');}catch{}db.close();}
 throw error;
}

export function seedAdmin({email, username, phone, password, hashPassword}) {
  if (!email || !username || !phone || !password || password.startsWith('GANTI_')) return;
  const exists = db.prepare("SELECT id FROM users WHERE role='ADMIN' LIMIT 1").get();
  if (exists) return;
  if (password.length < 12) throw new Error('Password admin minimal 12 karakter');
  db.prepare(`INSERT INTO users (id,full_name,username,email,phone,password_hash,role,referral_code)
    VALUES (?,?,?,?,?,?,'ADMIN',?)`).run(crypto.randomUUID(),'Pengelola ANJEMIN',username,email,phone,hashPassword(password),'ADM'+crypto.randomBytes(4).toString('hex').toUpperCase());
  console.log('Akun pengelola pertama berhasil di-bootstrap dari .env');
}
