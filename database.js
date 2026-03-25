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

  // Migration: Add details, ip_address, status to logs if they don't exist
  db.all("PRAGMA table_info(logs)", (err, columns) => {
    if (!err && columns) {
      if (!columns.some(c => c.name === 'details')) db.run("ALTER TABLE logs ADD COLUMN details TEXT");
      if (!columns.some(c => c.name === 'ip_address')) db.run("ALTER TABLE logs ADD COLUMN ip_address TEXT");
      if (!columns.some(c => c.name === 'status')) db.run("ALTER TABLE logs ADD COLUMN status TEXT");
    }
  });

  // Uygulama Ayarları (Meta API vb.)
  db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  // Default values for new settings if they don't exist
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('fee_per_post', '5')`);
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('min_withdrawal_limit', '200')`);
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('bonus_per_100_likes', '10')`);

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
  // Migration: Add check_status and last_checked_at to wallet_transactions
  db.all("PRAGMA table_info(wallet_transactions)", (err, columns) => {
    if (!err && columns) {
      if (!columns.some(c => c.name === 'check_status')) db.run("ALTER TABLE wallet_transactions ADD COLUMN check_status TEXT DEFAULT 'pending'");
      if (!columns.some(c => c.name === 'last_checked_at')) db.run("ALTER TABLE wallet_transactions ADD COLUMN last_checked_at DATETIME");
    }
  });

  // Gelen Haberler (Submitted News)
  db.run(`CREATE TABLE IF NOT EXISTS submitted_news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fullname TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        media_urls TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  // Tasks (To-Do Listesi)
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        assigned_by INTEGER,
        assigned_to INTEGER,
        status TEXT DEFAULT 'pending', /* pending, in_progress, completed */
        due_date DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(assigned_by) REFERENCES users(id),
        FOREIGN KEY(assigned_to) REFERENCES users(id)
    )`);

  // Anketler (Surveys)
  db.run(`CREATE TABLE IF NOT EXISTS surveys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  // Anket Soruları (Survey Questions) - Çoklu soru desteği
        db.run(`CREATE TABLE IF NOT EXISTS survey_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            survey_id INTEGER,
            question_text TEXT,
            selection_type TEXT DEFAULT 'single', -- single or multiple
            parent_question_id INTEGER DEFAULT NULL,
            parent_option_id INTEGER DEFAULT NULL,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE
        )`);

  // Anket Seçenekleri (Survey Options)
  db.run(`CREATE TABLE IF NOT EXISTS survey_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        survey_id INTEGER NOT NULL,
        question_id INTEGER,
        option_text TEXT NOT NULL,
        option_type TEXT DEFAULT 'radio',
        FOREIGN KEY(survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
        FOREIGN KEY(question_id) REFERENCES survey_questions(id) ON DELETE CASCADE
    )`);

  // Migration: survey_options'a option_type        // survey_questions migration
        db.all("PRAGMA table_info(survey_questions)", (err, rows) => {
            if (err) return;
            const cols = rows.map(r => r.name);
            if (!cols.includes('selection_type')) {
                db.run("ALTER TABLE survey_questions ADD COLUMN selection_type TEXT DEFAULT 'single'");
            }
            if (!cols.includes('parent_question_id')) {
                db.run("ALTER TABLE survey_questions ADD COLUMN parent_question_id INTEGER DEFAULT NULL");
            }
            if (!cols.includes('parent_option_id')) {
                db.run("ALTER TABLE survey_questions ADD COLUMN parent_option_id INTEGER DEFAULT NULL");
            }
        });

        // survey_options migration
        db.all("PRAGMA table_info(survey_options)", (err, rows) => {
    if (!err && rows) {
      if (!rows.some(c => c.name === 'option_type')) db.run("ALTER TABLE survey_options ADD COLUMN option_type TEXT DEFAULT 'radio'");
      if (!rows.some(c => c.name === 'question_id')) db.run("ALTER TABLE survey_options ADD COLUMN question_id INTEGER");
    }
  });

  // Anket Cevapları (Survey Responses)
  db.run(`CREATE TABLE IF NOT EXISTS survey_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        survey_id INTEGER NOT NULL,
        question_id INTEGER,
        option_id INTEGER,
        text_answer TEXT,
        user_id INTEGER,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
        FOREIGN KEY(option_id) REFERENCES survey_options(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  // Migration: survey_responses'a question_id, text_answer ekle, option_id nullable yap
  db.all("PRAGMA table_info(survey_responses)", (err, columns) => {
    if (!err && columns) {
      if (!columns.some(c => c.name === 'question_id')) db.run("ALTER TABLE survey_responses ADD COLUMN question_id INTEGER");
      if (!columns.some(c => c.name === 'text_answer')) db.run("ALTER TABLE survey_responses ADD COLUMN text_answer TEXT");
    }
  });

  // İçerik İstekleri (Content Requests)
  db.run(`CREATE TABLE IF NOT EXISTS content_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fullname TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        media_urls TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

module.exports = db;
