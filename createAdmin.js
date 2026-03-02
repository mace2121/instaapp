require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./database');

const name = "Admin";
const email = "admin@admin.com";
const password = "admin123";

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
