DELETE FROM wallet_transactions WHERE type='DELETION_DEDUCTION';
UPDATE wallet_transactions SET check_status = 'pending' WHERE type = 'EARNING' AND check_status = 'reversed';
UPDATE users SET earnings_balance = (
  SELECT COALESCE(SUM(CASE WHEN type IN ('EARNING', 'LIKE_BONUS') THEN amount ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN type IN ('WITHDRAWAL', 'DELETION_DEDUCTION') THEN ABS(amount) ELSE 0 END), 0)
  FROM wallet_transactions 
  WHERE wallet_transactions.user_id = users.id
) WHERE role = 'editor';
SELECT role, SUM(earnings_balance) FROM users GROUP BY role;
