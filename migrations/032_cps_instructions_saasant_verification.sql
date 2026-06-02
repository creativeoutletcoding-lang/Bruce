-- Migration 032 — CPS project instructions: SaaSant CSV spec + verification read-back rule
-- Data update (not schema). Appends two sections to the CPS project's instructions.
-- Run in the Supabase SQL editor. The NOT LIKE guards make each UPDATE idempotent
-- (safe to re-run; it won't append twice). Run the SELECT after each to verify.

-- ── UPDATE 1: SaaSant CSV output spec ──────────────────────────────────────────
UPDATE projects
SET instructions = instructions || '

---

## OUTPUT 2: SAASANT CSV

Save to the SaasAnt/ subfolder inside CPS PAYROLL as MMDDYYYY.csv.

Format rules (QBO will silently reject non-compliant files with no error):
- Exactly 8 columns: BillNo, Vendor, BillDate, DueDate, Account, Description, Amount, Currency
- Two rows per sitter — never one:
  Row 1: Account = "Contract Labor", Amount = positive Gross Pay
  Row 2: Account = "Workers'' Compensation", Amount = negative WC deduction
- Single net-only rows fail silently in QBO — always two rows per sitter
- BillNo pattern: MM/DD/YYYY-MM/DD/YYYY-## (pay period start/end, sitter number zero-padded, sorted by vendor first name)
- Vendor names: First Last format
- Contractor name substitution (critical): Spencer → Julia Stafford (not "Spencer Stafford")
- Currency: USD'
WHERE id = 'c0c4dcb3-e1ba-4b21-8e63-de0ccb00903e'
  AND instructions NOT LIKE '%## OUTPUT 2: SAASANT CSV%';

SELECT id, name, instructions FROM projects WHERE id = 'c0c4dcb3-e1ba-4b21-8e63-de0ccb00903e';

-- ── UPDATE 2: verification read-back rule ──────────────────────────────────────
UPDATE projects
SET instructions = instructions || '

---

## VERIFICATION SUMMARY RULE

Before presenting the verification summary, read back the totals directly
from the tab just written to the CPS PAYROLL sheet using the Sheets API.
Do not calculate or report figures from memory or from the import file.
The summary figures must come from what was actually written. If the
read-back values do not match the calculated values, flag the discrepancy
in the summary rather than reporting silently.'
WHERE id = 'c0c4dcb3-e1ba-4b21-8e63-de0ccb00903e'
  AND instructions NOT LIKE '%## VERIFICATION SUMMARY RULE%';

SELECT id, name, instructions FROM projects WHERE id = 'c0c4dcb3-e1ba-4b21-8e63-de0ccb00903e';
