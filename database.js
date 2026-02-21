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

  // Migration: Add avatar_url if it doesn't exist
  db.all("PRAGMA table_info(users)", (err, columns) => {
    if (!err && !columns.some(c => c.name === 'avatar_url')) {
      db.run("ALTER TABLE users ADD COLUMN avatar_url TEXT");
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
});

module.exports = db;
