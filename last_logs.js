const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    db.all(`SELECT * FROM logs ORDER BY id DESC LIMIT 5`, [], (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        rows.forEach(row => {
            console.log(`[${row.created_at}] ${row.action}: ${row.details}`);
        });
    });
});

db.close();
