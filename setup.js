const bcrypt = require('bcryptjs');
const db = require('./database');
require('dotenv').config();

const name = "Süper Admin";
const email = "admin@instaapp.com";
const pass = "Admin123*"; // Güçlü bir şifre

async function createAdmin() {
    const hash = await bcrypt.hash(pass, 10);
    db.run(
        `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
        [name, email, hash, 'super_admin'],
        function (err) {
            if (err) {
                console.error("Hata:", err.message);
            } else {
                console.log("-----------------------------------------");
                console.log("Süper Admin Başarıyla Oluşturuldu!");
                console.log("Email:", email);
                console.log("Şifre:", pass);
                console.log("-----------------------------------------");
            }
            db.close();
            process.exit();
        }
    );
}

createAdmin();
