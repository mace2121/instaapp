require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./database');

const name = "Mahsum";
const email = "admin@instaapp.local";
const password = "123456"; // sonra değiştireceğiz

(async () => {
  const hash = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
    [name, email, hash, "super_admin"],
    function (err) {
      if (err) {
        console.log("Hata:", err.message);
      } else {
        console.log("Süper Admin oluşturuldu.");
      }
      process.exit();
    }
  );
})();
