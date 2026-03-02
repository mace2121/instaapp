const db = require('./database');
const { metaRequest, getSettings } = require('./meta_api');

async function runWorker() {
    console.log(`[Worker] Kontrol başlatıldı: ${new Date().toLocaleString()}`);

    try {
        // 1. Fetch settings including the timestamp when the bonus was set
        const settings = await getSettings();
        const feePerPost = parseFloat(settings.fee_per_post || 0);
        const bonusAmount = parseFloat(settings.bonus_per_100_likes || 0);

        let bonusActiveDate = new Date('2024-01-01T00:00:00.000Z'); // Default past date
        // Note: the setting saved in the db is 'bonus_per_100_likes_updated_at'. Actually wait, the updated_at column isn't exported by getSettings easily unless it's stored as value. Let's adjust how the settings saves it.
        // I changed the API to save it as key='bonus_per_100_likes_updated_at', value=CURRENT_TIMESTAMP.
        if (settings.bonus_per_100_likes_updated_at) {
            // It's saved as a string timestamp
            bonusActiveDate = new Date(settings.bonus_per_100_likes_updated_at + 'Z');
        }

        // Kontrol edilecek işlemleri getir (son 30 gün, henüz bonus almamış veya silinmemiş olanlar)
        const transactions = await new Promise((resolve, reject) => {
            db.all(`
        SELECT * FROM wallet_transactions 
        WHERE type = 'EARNING' 
        AND (check_status = 'pending' OR check_status IS NULL)
        AND created_at > datetime('now', '-30 days')
      `, [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });

        console.log(`[Worker] ${transactions.length} işlem kontrol edilecek.`);

        for (const tx of transactions) {
            if (!tx.post_id) continue;

            try {
                // Meta API'den medya bilgisini çek (likes_count ve media_url/id ile varlık kontrolü)
                // Not: 'like_count' için paylaşılan medya id'sini kullanıyoruz.
                const media = await metaRequest(`${tx.post_id}`, { fields: 'like_count,id' }, 'GET');

                const currentLikes = media.like_count || 0;
                console.log(`[Worker] Post ${tx.post_id}: ${currentLikes} beğeni.`);

                // 1. BEĞENİ BONUSU KONTROLÜ
                const postDate = new Date(tx.created_at + 'Z');

                // If the post was shared BEFORE the bonus was set/updated, it is NOT eligible.
                const isEligibleForBonus = postDate >= bonusActiveDate && bonusAmount > 0;

                if (currentLikes >= 100 && isEligibleForBonus) {
                    // Bonus daha önce yatmış mı kontrol et
                    const alreadyPaid = await new Promise((res) => {
                        db.get("SELECT id FROM wallet_transactions WHERE user_id = ? AND post_id = ? AND type = 'LIKE_BONUS'", [tx.user_id, tx.post_id], (err, row) => {
                            res(!!row);
                        });
                    });

                    if (!alreadyPaid) {
                        console.log(`[Worker] Post ${tx.post_id} için bonus ödeniyor (100+ Beğeni).`);

                        db.serialize(() => {
                            db.run("INSERT INTO wallet_transactions (user_id, amount, type, description, post_id, check_status) VALUES (?, ?, 'LIKE_BONUS', ?, ?, 'verified_bonus_paid')",
                                [tx.user_id, bonusAmount, `100+ Beğeni Bonusu (Post ID: ${tx.post_id})`, tx.post_id]);
                            db.run("UPDATE users SET earnings_balance = earnings_balance + ? WHERE id = ?", [bonusAmount, tx.user_id]);
                            db.run("UPDATE wallet_transactions SET check_status = 'verified_bonus_paid', last_checked_at = CURRENT_TIMESTAMP WHERE id = ?", [tx.id]);
                        });
                    } else {
                        db.run("UPDATE wallet_transactions SET check_status = 'verified', last_checked_at = CURRENT_TIMESTAMP WHERE id = ?", [tx.id]);
                    }
                } else {
                    // Henüz 100 beğeni yok ama post duruyor, veya geçmiş tarihli post olduğu için bonustan faydalanamıyor.
                    db.run("UPDATE wallet_transactions SET last_checked_at = CURRENT_TIMESTAMP WHERE id = ?", [tx.id]);
                }

            } catch (error) {
                // 2. SİLİNME / DÜŞÜM KONTROLÜ
                let isDeleted = false;
                try {
                    const errorData = JSON.parse(error.message);
                    if (errorData && errorData.error) {
                        const code = errorData.error.code;
                        const subcode = errorData.error.error_subcode;
                        const msg = (errorData.error.message || "").toLowerCase();

                        if ((code === 100 && subcode === 33) || msg.includes("does not exist") || msg.includes("not found")) {
                            isDeleted = true;
                        }
                    }
                } catch (e) {
                    // Not a valid JSON string (maybe a network or fetch error like ENOTFOUND)
                    console.error(`[Worker] Post ${tx.post_id} kontrol edilemedi (JSON dışı hata):`, error.message);
                }

                if (isDeleted) {
                    console.warn(`[Worker] Post ${tx.post_id} bulunamadı veya silinmiş. Ücret iade alınıyor.`);

                    db.serialize(() => {
                        db.run("INSERT INTO wallet_transactions (user_id, amount, type, description, post_id, check_status) VALUES (?, ?, 'DELETION_DEDUCTION', ?, ?, 'reversed')",
                            [tx.user_id, -tx.amount, `İçerik Silindiği İçin Kesinti (Post ID: ${tx.post_id})`, tx.post_id]);
                        db.run("UPDATE users SET earnings_balance = earnings_balance - ? WHERE id = ?", [tx.amount, tx.user_id]);
                        db.run("UPDATE wallet_transactions SET check_status = 'reversed', last_checked_at = CURRENT_TIMESTAMP WHERE id = ?", [tx.id]);
                    });
                } else {
                    console.error(`[Worker] Post ${tx.post_id} genel durum hatası:`, error.message);
                }
            }
        }

    } catch (err) {
        console.error("[Worker] Hata:", err);
    }
}

// Global olarak çağrılabilmesi için (cron job gibi)
module.exports = { runWorker };

// Eğer direkt çalıştırılırsa (test için)
if (require.main === module) {
    runWorker();
}
