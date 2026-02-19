require('dotenv').config();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('./database');

function login(email, password) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
      if (err || !user) return reject("Kullanıcı bulunamadı");

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return reject("Şifre yanlış");

      const token = jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      resolve(token);
    });
  });
}

module.exports = { login };
