const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');

// --- Auth Functions ---

async function login(email, password, ip = '') {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
      if (err || !user) {
        logAction(null, 'LOGIN_FAILED', `Email: ${email}, Hata: Kullanıcı bulunamadı`, ip, 'ERROR');
        return reject("Geçersiz e-posta veya şifre");
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        logAction(user.id, 'LOGIN_FAILED', `Email: ${email}, Hata: Yanlış şifre`, ip, 'ERROR');
        return reject("Geçersiz e-posta veya şifre");
      }

      const token = jwt.sign(
        { id: user.id, name: user.name, role: user.role, avatar_url: user.avatar_url },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      logAction(user.id, 'LOGIN_SUCCESS', `Kullanıcı: ${user.name}`, ip, 'SUCCESS');
      resolve({ token, user: { id: user.id, name: user.name, role: user.role, avatar_url: user.avatar_url, email: user.email } });
    });
  });
}

async function register(name, email, password, role = 'editor', actorId = null) {
  // Sadece süper admin kullanıcı ekleyebilir (actorId kontrolü API seviyesinde yapılacak)
  return new Promise(async (resolve, reject) => {
    try {
      const hash = await bcrypt.hash(password, 10);
      db.run(
        `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
        [name, email, hash, role],
        function (err) {
          if (err) {
            if (err.message.includes('UNIQUE')) return reject("Bu e-posta adresi zaten kayıtlı");
            return reject(err.message);
          }
          logAction(actorId, 'USER_CREATED', `Yeni Kullanıcı: ${name}, Rol: ${role}`, '', 'SUCCESS');
          resolve({ id: this.lastID });
        }
      );
    } catch (e) {
      reject(e.message);
    }
  });
}

// --- Middleware ---

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Giriş yapmanız gerekiyor' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Oturum geçersiz' });
    req.user = user;
    next();
  });
}

function isSuperAdmin(req, res, next) {
  if (req.user && req.user.role === 'super_admin') {
    next();
  } else {
    res.status(403).json({ error: 'Bu işlem için Süper Admin yetkisi gerekiyor' });
  }
}

// --- Logging ---

function logAction(userId, action, details, ip = '', status = 'INFO') {
  db.run(
    `INSERT INTO logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)`,
    [userId, action, details, ip, status]
  );
}

// --- Settings ---

function getSettings() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM settings`, [], (err, rows) => {
      if (err) return reject(err);
      const settings = {};
      rows.forEach(r => settings[r.key] = r.value);
      resolve(settings);
    });
  });
}

async function updatePassword(userId, newPassword) {
  return new Promise(async (resolve, reject) => {
    try {
      const hash = await bcrypt.hash(newPassword, 10);
      db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, userId], function (err) {
        if (err) return reject(err.message);
        logAction(userId, 'PASSWORD_UPDATED', `Şifre güncellendi`, '', 'SUCCESS');
        resolve({ ok: true });
      });
    } catch (e) {
      reject(e.message);
    }
  });
}

async function updateProfile(userId, data) {
  const { name, avatar_url } = data;
  return new Promise((resolve, reject) => {
    let sql = "UPDATE users SET name = ?";
    const params = [name];

    if (avatar_url !== undefined) {
      sql += ", avatar_url = ?";
      params.push(avatar_url);
    }

    sql += " WHERE id = ?";
    params.push(userId);

    db.run(sql, params, function (err) {
      if (err) return reject(err.message);
      logAction(userId, 'PROFILE_UPDATED', `Profil güncellendi: ${name}`, '', 'SUCCESS');
      resolve({ ok: true });
    });
  });
}

module.exports = { login, register, logAction, verifyToken, isSuperAdmin, getSettings, updatePassword, updateProfile };
