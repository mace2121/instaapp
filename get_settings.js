const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const dbPath = path.resolve(__dirname, 'data/app.db');
const db = new sqlite3.Database(dbPath);

console.log("Reading token...");
db.all("SELECT value FROM settings WHERE key = 'META_ACCESS_TOKEN'", [], (err, rows) => {
    if (err) { console.error("DB Error:", err); return; }
    if (rows.length > 0) {
        fs.writeFileSync('token.txt', rows[0].value.trim());
        console.log("Token saved to token.txt");
    } else {
        console.error("Token not found in DB");
    }
});
