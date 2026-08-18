-- Hard Gate #1 defense-in-depth: a WorkOrder may only reference a CONFIRMED diagnostic.
-- The service layer already checks this; these triggers make the invariant impossible to bypass with direct Prisma/SQL writes.

CREATE OR REPLACE FUNCTION enforce_workorder_confirmed_diagnostic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  diagnostic_status "DiagnosticRequestStatus";
  diagnostic_confirmed_at TIMESTAMP(3);
BEGIN
  SELECT dr."status", dr."confirmedAt"
    INTO diagnostic_status, diagnostic_confirmed_at
  FROM "DiagnosticRequest" dr
  WHERE dr."id" = NEW."diagnosticRequestId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DiagnosticRequest % does not exist', NEW."diagnosticRequestId"
      USING ERRCODE = '23503';
  END IF;

  IF diagnostic_status <> 'CONFIRMED'::"DiagnosticRequestStatus" OR diagnostic_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'WorkOrder requires a confirmed DiagnosticRequest'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workorder_confirmed_diagnostic_gate ON "WorkOrder";
CREATE TRIGGER workorder_confirmed_diagnostic_gate
BEFORE INSERT OR UPDATE OF "diagnosticRequestId" ON "WorkOrder"
FOR EACH ROW
EXECUTE FUNCTION enforce_workorder_confirmed_diagnostic();

CREATE OR REPLACE FUNCTION prevent_unconfirming_diagnostic_with_workorder()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW."status" <> 'CONFIRMED'::"DiagnosticRequestStatus" OR NEW."confirmedAt" IS NULL)
     AND EXISTS (
       SELECT 1
       FROM "WorkOrder" wo
       WHERE wo."diagnosticRequestId" = NEW."id"
     ) THEN
    RAISE EXCEPTION 'DiagnosticRequest linked to a WorkOrder must remain confirmed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS diagnostic_remains_confirmed_gate ON "DiagnosticRequest";
CREATE TRIGGER diagnostic_remains_confirmed_gate
BEFORE UPDATE OF "status", "confirmedAt" ON "DiagnosticRequest"
FOR EACH ROW
EXECUTE FUNCTION prevent_unconfirming_diagnostic_with_workorder();
