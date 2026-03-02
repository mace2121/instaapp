const db = require('./app/database');
const { runWorker } = require('./app/worker');

db.serialize(() => {
    // 1. Delete all false deductions
    db.run("DELETE FROM wallet_transactions WHERE type='DELETION_DEDUCTION'", async (err) => {
        if (err) throw err;
        console.log("Deleted old false deductions.");

        // 2. Reset transactions to pending
        db.run("UPDATE wallet_transactions SET check_status = 'pending' WHERE type = 'EARNING'", async (err2) => {
            if (err2) throw err2;
            console.log("Reset earning statuses to pending.");

            // 3. Recalculate true user balances from raw remaining earning records
            db.all("SELECT id FROM users WHERE role = 'editor'", [], (err3, editors) => {
                if (err3) throw err3;
                let processed = 0;
                editors.forEach(editor => {
                    db.get(`
                        SELECT 
                            COALESCE(SUM(CASE WHEN type IN ('EARNING', 'LIKE_BONUS') THEN amount ELSE 0 END), 0) -
                            COALESCE(SUM(CASE WHEN type IN ('WITHDRAWAL', 'DELETION_DEDUCTION') THEN ABS(amount) ELSE 0 END), 0) as real_balance
                        FROM wallet_transactions 
                        WHERE user_id = ?
                    `, [editor.id], (err4, row) => {
                        if (err4) throw err4;
                        const newB = Math.max(0, row.real_balance);
                        db.run("UPDATE users SET earnings_balance = ? WHERE id = ?", [newB, editor.id], (err5) => {
                            if (err5) throw err5;
                            console.log(`Updated Editor ${editor.id} balance to ${newB}`);
                            processed++;

                            // 4. When all users updated, run the fixed worker.
                            if (processed === editors.length) {
                                console.log("All balances fixed. Running robust worker test...");
                                runWorker().then(() => {
                                    db.all("SELECT SUM(earnings_balance) as tot FROM users WHERE role='editor'", (e, r) => {
                                        console.log("FINAL UNPAID BALANCE TOTAL:", r[0].tot);
                                    });
                                });
                            }
                        });
                    });
                });
            });
        });
    });
});
