const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbDir = path.dirname(process.env.DB_PATH || './data/app.db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(process.env.DB_PATH || './data/app.db');

db.serialize(() => {
  // Kullanıcılar (Süper Admin / Editör)
  db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT CHECK(role IN ('super_admin', 'editor')) DEFAULT 'editor',
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  // Migration: Add avatar_url, iban, earnings_balance if they don't exist
  db.all("PRAGMA table_info(users)", (err, columns) => {
    if (!err && columns) {
      if (!columns.some(c => c.name === 'avatar_url')) db.run("ALTER TABLE users ADD COLUMN avatar_url TEXT");
      if (!columns.some(c => c.name === 'iban')) db.run("ALTER TABLE users ADD COLUMN iban TEXT");
      if (!columns.some(c => c.name === 'earnings_balance')) db.run("ALTER TABLE users ADD COLUMN earnings_balance REAL DEFAULT 0");
    }
  });

  // Denetim Günlükleri
  db.run(`CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  // Uygulama Ayarları (Meta API vb.)
  db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  // Default values for new settings if they don't exist
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('fee_per_post', '1')`);
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('min_withdrawal_limit', '200')`);

  // Ödeme Talepleri
  db.run(`CREATE TABLE IF NOT EXISTS payment_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        status TEXT CHECK(status IN ('pending', 'completed')) DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  // Cüzdan İşlem Geçmişi
  db.run(`CREATE TABLE IF NOT EXISTS wallet_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        type TEXT NOT NULL, -- 'EARNING', 'WITHDRAWAL'
        description TEXT,
        post_id TEXT, -- If related to a specific shared post
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  // Gelen Haberler (Submitted News)
  db.run(`CREATE TABLE IF NOT EXISTS submitted_news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fullname TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        media_urls TEXT, -- JSON array of uploaded file URLs
        status TEXT CHECK(status IN ('pending', 'published', 'rejected')) DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

module.exports = db;
