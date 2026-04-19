-- ═══════════════════════════════════════════════════════════════════════
-- Ledger invariants: balance trigger, posting sanity checks, RLS stubs.
--
-- Drizzle schema-as-code handles columns and FKs. This migration adds
-- what Drizzle cannot express:
--
--   1. CHECK constraints on currency shape.
--   2. The deferred posting-balance trigger (core double-entry
--      invariant: sum of postings per transaction = 0).
--   3. updated_at + version auto-bump triggers.
--   4. Row-Level Security policies (defined, not enabled — enable
--      once auth sets app.current_workspace per request).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. CHECK constraints ───────────────────────────────────────────────

ALTER TABLE postings
  ADD CONSTRAINT postings_currency_shape_ck
  CHECK (currency ~ '^[A-Z]{3}$');
--> statement-breakpoint
ALTER TABLE accounts
  ADD CONSTRAINT accounts_currency_shape_ck
  CHECK (currency ~ '^[A-Z]{3}$');
--> statement-breakpoint
ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_base_currency_shape_ck
  CHECK (base_currency ~ '^[A-Z]{3}$');
--> statement-breakpoint

-- ── 2. Posting-balance trigger ─────────────────────────────────────────
--
-- Fires at COMMIT (DEFERRABLE INITIALLY DEFERRED) so a single SQL
-- transaction can insert the parent transactions row plus N postings
-- rows without the partial state tripping the check.
--
-- For each affected transaction_id, enforces:
--   (a) at least 2 postings,
--   (b) every posting has amount_base_minor populated,
--   (c) SUM(amount_base_minor) = 0.
--
-- Exception: status IN ('draft','error') transactions bypass the check
-- to allow unbalanced working state during manual entry.

CREATE OR REPLACE FUNCTION assert_postings_balance() RETURNS TRIGGER AS $$
DECLARE
  txn_id   uuid;
  txn_stat txn_status;
  null_cnt int;
  sum_base bigint;
  row_cnt  int;
BEGIN
  txn_id := COALESCE(NEW.transaction_id, OLD.transaction_id);

  SELECT status INTO txn_stat FROM transactions WHERE id = txn_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF txn_stat IN ('draft', 'error') THEN RETURN NULL; END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE amount_base_minor IS NULL),
         COALESCE(SUM(amount_base_minor), 0)
    INTO row_cnt, null_cnt, sum_base
    FROM postings
   WHERE transaction_id = txn_id;

  IF row_cnt < 2 THEN
    RAISE EXCEPTION 'Transaction % has % posting(s); a posted transaction must have at least 2', txn_id, row_cnt
      USING ERRCODE = 'check_violation';
  END IF;

  IF null_cnt > 0 THEN
    RAISE EXCEPTION 'Transaction % has % posting(s) with NULL amount_base_minor', txn_id, null_cnt
      USING ERRCODE = 'check_violation';
  END IF;

  IF sum_base <> 0 THEN
    RAISE EXCEPTION 'Postings for transaction % do not balance: sum=% (must be 0)', txn_id, sum_base
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER postings_balance_ck
  AFTER INSERT OR UPDATE OR DELETE ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_postings_balance();
--> statement-breakpoint

-- Re-check on status transition (draft → posted, etc.).
CREATE OR REPLACE FUNCTION assert_balance_on_status_change() RETURNS TRIGGER AS $$
DECLARE
  null_cnt int;
  sum_base bigint;
  row_cnt  int;
BEGIN
  IF NEW.status NOT IN ('posted', 'reconciled', 'voided') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE amount_base_minor IS NULL),
         COALESCE(SUM(amount_base_minor), 0)
    INTO row_cnt, null_cnt, sum_base
    FROM postings
   WHERE transaction_id = NEW.id;

  IF row_cnt < 2 THEN
    RAISE EXCEPTION 'Cannot transition transaction % to %: has % posting(s), need at least 2', NEW.id, NEW.status, row_cnt
      USING ERRCODE = 'check_violation';
  END IF;

  IF null_cnt > 0 OR sum_base <> 0 THEN
    RAISE EXCEPTION 'Cannot transition transaction % to %: postings imbalance (sum=%, null_count=%)', NEW.id, NEW.status, sum_base, null_cnt
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER transactions_status_balance_ck
  AFTER UPDATE OF status ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_balance_on_status_change();
--> statement-breakpoint

-- ── 3. updated_at + version auto-bump ──────────────────────────────────

CREATE OR REPLACE FUNCTION bump_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER users_updated_at        BEFORE UPDATE ON users        FOR EACH ROW EXECUTE FUNCTION bump_updated_at();--> statement-breakpoint
CREATE TRIGGER workspaces_updated_at   BEFORE UPDATE ON workspaces   FOR EACH ROW EXECUTE FUNCTION bump_updated_at();--> statement-breakpoint
CREATE TRIGGER accounts_updated_at     BEFORE UPDATE ON accounts     FOR EACH ROW EXECUTE FUNCTION bump_updated_at();--> statement-breakpoint
CREATE TRIGGER transactions_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION bump_updated_at();--> statement-breakpoint
CREATE TRIGGER documents_updated_at    BEFORE UPDATE ON documents    FOR EACH ROW EXECUTE FUNCTION bump_updated_at();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION bump_version() RETURNS TRIGGER AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER accounts_version_bump     BEFORE UPDATE ON accounts     FOR EACH ROW EXECUTE FUNCTION bump_version();--> statement-breakpoint
CREATE TRIGGER transactions_version_bump BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION bump_version();
--> statement-breakpoint

-- ── 4. Row-Level Security (defined, NOT enabled) ───────────────────────

CREATE POLICY workspaces_isolation ON workspaces
  USING (id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY accounts_isolation ON accounts
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY transactions_isolation ON transactions
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY postings_isolation ON postings
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY documents_isolation ON documents
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY document_links_isolation ON document_links
  USING (EXISTS (
    SELECT 1 FROM documents d
     WHERE d.id = document_links.document_id
       AND d.workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid
  ));
--> statement-breakpoint
CREATE POLICY transaction_events_isolation ON transaction_events
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY idempotency_keys_isolation ON idempotency_keys
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
