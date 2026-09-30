-- Trial balance reconstruction from the Tally-derived masters/transactions tables.
--
-- Methodology (validated against "Trial Balance April 1st to Sep 21st 2026.pdf"):
--   - Balance-sheet ledgers (top-level group.is_revenue = 'No'): tab_ledgers.opening_balance
--     already holds the ledger's closing balance for the loaded period, so it is used as-is.
--   - P&L ledgers (top-level group.is_revenue = 'Yes'): opening_balance is 0 for these, so the
--     closing balance is the sum of tab_ledger_entries.amount for that ledger.
--   - Sign convention in this data: negative amount = Debit, positive amount = Credit.
--
-- Run with: psql "postgresql://postgres:asa%40123@localhost:5434/mini_etl" -f trial_balance.sql

-- 1. Resolve every group to its top-level ancestor (name + is_revenue flag).
CREATE OR REPLACE TEMP VIEW group_top AS
WITH RECURSIVE walk AS (
    SELECT name, parent, name AS top_name, is_revenue AS top_is_revenue
    FROM tab_groups
    WHERE parent IS NULL

    UNION ALL

    SELECT g.name, g.parent, w.top_name, w.top_is_revenue
    FROM tab_groups g
    JOIN walk w ON g.parent = w.name
)
SELECT * FROM walk;

-- 2. Net movement per ledger from the transaction detail.
CREATE OR REPLACE TEMP VIEW ledger_movement AS
SELECT ledger_name, COALESCE(SUM(amount), 0) AS movement
FROM tab_ledger_entries
GROUP BY ledger_name;

-- 3. Closing balance per ledger, classified BS vs P&L via the resolved top-level group.
CREATE OR REPLACE TEMP VIEW trial_balance_ledger AS
SELECT
    l.name                                              AS ledger_name,
    l.parent                                            AS ledger_parent,
    COALESCE(gt.top_name, l.parent, l.name)             AS top_group,
    COALESCE(gt.top_is_revenue, 'No')                   AS top_is_revenue,
    COALESCE(l.opening_balance, 0)                      AS opening_balance,
    COALESCE(lm.movement, 0)                            AS movement,
    CASE
        WHEN COALESCE(gt.top_is_revenue, 'No') = 'Yes'
            THEN COALESCE(lm.movement, 0)
        ELSE COALESCE(l.opening_balance, 0)
    END                                                  AS closing_balance
FROM tab_ledgers l
LEFT JOIN group_top gt      ON gt.name = l.parent
LEFT JOIN ledger_movement lm ON lm.ledger_name = l.name;

-- === A. Ledger-level trial balance ===
SELECT
    ledger_name,
    ledger_parent,
    top_group,
    CASE WHEN closing_balance < 0 THEN -closing_balance ELSE 0 END AS debit,
    CASE WHEN closing_balance > 0 THEN closing_balance  ELSE 0 END AS credit
FROM trial_balance_ledger
WHERE closing_balance <> 0
ORDER BY top_group, ledger_name;

-- === B. Group-level summary (compare against the PDF's bold group rows) ===
SELECT
    top_group,
    SUM(CASE WHEN closing_balance < 0 THEN -closing_balance ELSE 0 END) AS total_debit,
    SUM(CASE WHEN closing_balance > 0 THEN closing_balance  ELSE 0 END) AS total_credit
FROM trial_balance_ledger
GROUP BY top_group
HAVING SUM(ABS(closing_balance)) <> 0
ORDER BY top_group;

-- === C. Grand total (should equal PDF's Grand Total 130,858,409.93 on both sides) ===
SELECT
    SUM(CASE WHEN closing_balance < 0 THEN -closing_balance ELSE 0 END) AS grand_total_debit,
    SUM(CASE WHEN closing_balance > 0 THEN closing_balance  ELSE 0 END) AS grand_total_credit
FROM trial_balance_ledger;

-- === D. Sanity check: total should be 0 (confirms double-entry integrity of raw entries) ===
SELECT SUM(amount) AS should_be_zero FROM tab_ledger_entries;
