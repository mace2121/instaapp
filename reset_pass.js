const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/app.db');

const email = 'admin@instaapp.local';
const newPass = '123456';

async function reset() {
    const hash = await bcrypt.hash(newPass, 10);
    db.run('UPDATE users SET password_hash = ? WHERE email = ?', [hash, email], function (err) {
        if (err) {
            console.error('Hata:', err.message);
        } else if (this.changes === 0) {
            console.log('Kullanıcı bulunamadı.');
        } else {
            console.log('Şifre başarıyla sıfırlandı: admin@instaapp.local / 123456');
        }
        db.close();
    });
}

reset();
