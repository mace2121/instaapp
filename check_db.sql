SELECT id, name, earnings_balance FROM users WHERE role='editor';
SELECT SUM(earnings_balance) as TotalSum, SUM(CASE WHEN earnings_balance > 0 THEN earnings_balance ELSE 0 END) as PositiveSum FROM users WHERE role='editor';
SELECT * FROM settings WHERE key='bonus_per_100_likes';
