const db = require('./database');

async function test() {
    console.log("--- KASA CALCULATION TEST ---");
    const totalEarningRow = await new Promise((res, rej) => db.get("SELECT SUM(amount) as t FROM wallet_transactions WHERE type IN ('EARNING', 'LIKE_BONUS')", [], (err, row) => err ? rej(err) : res(row)));
    const totalDeductionRow = await new Promise((res, rej) => db.get("SELECT SUM(ABS(amount)) as t FROM wallet_transactions WHERE type = 'DELETION_DEDUCTION'", [], (err, row) => err ? rej(err) : res(row)));
    const totalPaidRow = await new Promise((res, rej) => db.get("SELECT SUM(amount) as t FROM payment_requests WHERE status = 'completed'", [], (err, row) => err ? rej(err) : res(row)));

    const rawEarned = (totalEarningRow?.t || 0) - (totalDeductionRow?.t || 0);
    const rawPaid = (totalPaidRow?.t || 0);
    const total_unpaid = Math.max(0, rawEarned - rawPaid);

    console.log({
        totalEarningRow,
        totalDeductionRow,
        totalPaidRow,
        rawEarned,
        rawPaid,
        total_unpaid
    });

    console.log("--- FINANCE ADMIN ENDPOINT TEST ---");
    try {
        const editors = await new Promise((resolve, reject) => {
            db.all("SELECT id, name, email, earnings_balance FROM users WHERE role = 'editor' ORDER BY name ASC", [], (err, rows) => err ? reject(err) : resolve(rows));
        });

        for (let ed of editors) {
            const stats = await new Promise((resolve, reject) => {
                db.get(`
                        SELECT 
                            SUM(CASE WHEN type IN ('EARNING', 'LIKE_BONUS') THEN amount ELSE 0 END) as total_earned,
                            SUM(CASE WHEN type = 'WITHDRAWAL' THEN ABS(amount) ELSE 0 END) as total_requested,
                            SUM(CASE WHEN type = 'DELETION_DEDUCTION' THEN ABS(amount) ELSE 0 END) as total_deducted
                        FROM wallet_transactions WHERE user_id = ?
                    `, [ed.id], (err, row) => err ? reject(err) : resolve(row));
            });

            const paid = await new Promise((resolve, reject) => {
                db.get("SELECT SUM(amount) as t FROM payment_requests WHERE user_id = ? AND status = 'completed'", [ed.id], (err, row) => err ? reject(err) : resolve(row));
            });

            ed.total_earned = stats?.total_earned || 0;
            ed.total_paid = paid?.t || 0;
            ed.total_deducted = stats?.total_deducted || 0;
            ed.net_unpaid = Math.max(0, ed.total_earned - ed.total_deducted - ed.total_paid);
        }
        console.log("Editors loaded successfully:", editors.length);
        console.log("First Editor Sample:", editors[0]);

        const allTxs = await new Promise((resolve, reject) => {
            db.all("SELECT w.*, u.name as user_name FROM wallet_transactions w JOIN users u ON w.user_id = u.id ORDER BY w.created_at DESC LIMIT 200", [], (err, rows) => err ? reject(err) : resolve(rows));
        });
        console.log("AllTXs length:", allTxs ? allTxs.length : 0);
    } catch (e) {
        console.error("ADMIN ENDPOINT CRASH:", e);
    }
}

test();
