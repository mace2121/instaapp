const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/app.db');

const email = 'mahsum@instaapp.local';
const name = 'Mahsum';
const pass = '123456';
const role = 'super_admin';

async function createUser() {
    const hash = await bcrypt.hash(pass, 10);
    db.run('INSERT OR REPLACE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [name, email, hash, role], function (err) {
            if (err) {
                console.error('Hata:', err.message);
            } else {
                console.log('Kullanıcı oluşturuldu/güncellendi: mahsum@instaapp.local / 123456');
            }
            db.close();
        });
}

createUser();
