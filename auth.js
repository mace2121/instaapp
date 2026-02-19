require('dotenv').config();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');

function login(email, password, ip = '') {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
      if (err || !user) {
        logAction(null, 'LOGIN_FAILED', `Email: ${email}, Error: Kullanıcı bulunamadı`, ip, 'ERROR');
        return reject("Kullanıcı bulunamadı");
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        logAction(user.id, 'LOGIN_FAILED', `Email: ${email}, Error: Şifre yanlış`, ip, 'ERROR');
        return reject("Şifre yanlış");
      }

      const token = jwt.sign(
        { id: user.id, name: user.name, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      logAction(user.id, 'LOGIN_SUCCESS', `User: ${user.name}`, ip, 'SUCCESS');
      resolve({ token, user: { id: user.id, name: user.name, role: user.role } });
    });
  });
}

function register(name, email, password, role = 'user') {
  return new Promise(async (resolve, reject) => {
    try {
      const hash = await bcrypt.hash(password, 10);
      db.run(
        `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
        [name, email, hash, role],
        function (err) {
          if (err) {
            if (err.message.includes('UNIQUE')) return reject("Bu e-posta adresi zaten kullanımda");
            return reject(err.message);
          }
          logAction(this.lastID, 'REGISTER', `Name: ${name}, Email: ${email}`, '', 'SUCCESS');
          resolve({ id: this.lastID });
        }
      );
    } catch (e) {
      reject(e.message);
    }
  });
}

function logAction(userId, action, details, ip = '', status = 'INFO') {
  db.run(
    `INSERT INTO logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)`,
    [userId, action, details, ip, status]
  );
}

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Yetkisiz erişim' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Geçersiz token' });
    req.user = user;
    next();
  });
}

function isAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin yetkisi gerekli' });
  }
}

module.exports = { login, register, logAction, verifyToken, isAdmin };
