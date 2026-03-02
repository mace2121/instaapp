const db = require('./app/database');
const { runWorker } = require('./app/worker');

db.serialize(() => {
    // 1. Reset all 'reversed' back to 'pending'
    db.run("UPDATE wallet_transactions SET check_status = 'pending' WHERE type = 'EARNING' AND check_status = 'reversed'", async (err) => {
        if (err) throw err;

        console.log("Status reset successfully. Running worker...");

        // 2. Run the worker
        await runWorker();

        // 3. Print the results
        db.all("SELECT check_status, COUNT(id) as count FROM wallet_transactions WHERE type='EARNING' GROUP BY check_status", [], (err2, rows) => {
            if (err2) throw err2;
            console.log("Final check statuses:", rows);
        });
    });
});
