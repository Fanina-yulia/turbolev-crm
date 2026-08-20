-- Backfill the new personal task engine from already active CRM work.
UPDATE "Lead"
SET "nextAction" = "nextAction"
WHERE "assignedUserId" IS NOT NULL
  AND "status"::text IN ('NEW','CONTACTED','QUALIFIED','ESTIMATE','WAITING','NO_ANSWER');

UPDATE "CommunicationInquiry"
SET "answered" = "answered"
WHERE "assignedUserId" IS NOT NULL
  AND "state"::text IN ('NEW','IN_WORK')
  AND "answered" = false;
