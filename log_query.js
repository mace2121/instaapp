const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'data/app.db');
const db = new sqlite3.Database(dbPath);

console.log("Querying logs from:", dbPath);

db.all("SELECT action, details, created_at FROM logs WHERE action = 'SHARE_ERROR' ORDER BY created_at DESC LIMIT 5", [], (err, rows) => {
    if (err) {
        console.error("DB Error:", err);
        return;
    }
    rows.forEach(row => {
        console.log(`[${row.created_at}] ${row.action}: ${row.details}`);
    });
});
