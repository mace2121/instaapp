const db = require('./database');

async function fixBalances() {
    console.log("--- STARTING BALANCE RECOVERY ---");

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // 1. Delete all fake deductions
            db.run("DELETE FROM wallet_transactions WHERE type = 'DELETION_DEDUCTION'", function (err) {
                if (err) console.error("Err 1", err);
                console.log("Deleted fake deductions:", this?.changes);
            });

            // 2. Reset earnings to pending so the new fetch-based worker can re-check them
            db.run("UPDATE wallet_transactions SET check_status = 'pending' WHERE type = 'EARNING' AND check_status != 'verified_bonus_paid'", function (err) {
                if (err) console.error("Err 2", err);
                console.log("Reset earnings to pending:", this?.changes);
            });

            // 3. Recalculate and properly set users earnings_balance
            db.run(`
                UPDATE users SET earnings_balance = (
                    SELECT COALESCE(SUM(amount), 0) FROM wallet_transactions WHERE user_id = users.id AND type IN ('EARNING', 'LIKE_BONUS')
                ) - (
                    SELECT COALESCE(SUM(ABS(amount)), 0) FROM wallet_transactions WHERE user_id = users.id AND type = 'DELETION_DEDUCTION'
                ) - (
                    SELECT COALESCE(SUM(amount), 0) FROM payment_requests WHERE user_id = users.id AND status = 'pending'
                )
                WHERE role = 'editor'
            `, function (err) {
                if (err) console.error("Err 3", err);
                console.log("Recalculated balances:", this?.changes);
            });

            db.run('COMMIT', (err) => {
                if (err) {
                    console.error("COMMIT ERR", err);
                    db.run('ROLLBACK');
                    reject(err);
                } else {
                    console.log("RECOVERY COMPLETE.");
                    resolve();
                }
            });
        });
    });
}

fixBalances().then(() => {
    db.all("SELECT SUM(amount) as total_earned FROM wallet_transactions WHERE type IN ('EARNING', 'LIKE_BONUS')", [], (err, rows) => console.log("New Total Earned:", rows));
    db.all("SELECT SUM(earnings_balance) as current_kasa FROM users WHERE role = 'editor'", [], (err, rows) => console.log("New User Balances Kasa:", rows));
});
