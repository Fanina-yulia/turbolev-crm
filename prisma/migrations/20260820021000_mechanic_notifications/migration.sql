CREATE TABLE "MechanicNotification" (
    "id" VARCHAR(64) NOT NULL,
    "eventKey" VARCHAR(220) NOT NULL,
    "mechanicId" VARCHAR(64) NOT NULL,
    "recipientUserId" VARCHAR(64),
    "appointmentId" VARCHAR(64),
    "workOrderId" VARCHAR(64),
    "findingId" VARCHAR(64),
    "type" VARCHAR(48) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "body" TEXT,
    "vehicleLabel" TEXT,
    "plateNumber" VARCHAR(24),
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MechanicNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MechanicNotification_eventKey_key" ON "MechanicNotification"("eventKey");
CREATE INDEX "MechanicNotification_mechanicId_readAt_createdAt_idx" ON "MechanicNotification"("mechanicId", "readAt", "createdAt");
CREATE INDEX "MechanicNotification_recipientUserId_readAt_createdAt_idx" ON "MechanicNotification"("recipientUserId", "readAt", "createdAt");
CREATE INDEX "MechanicNotification_appointmentId_createdAt_idx" ON "MechanicNotification"("appointmentId", "createdAt");
CREATE INDEX "MechanicNotification_workOrderId_createdAt_idx" ON "MechanicNotification"("workOrderId", "createdAt");
CREATE INDEX "MechanicNotification_findingId_createdAt_idx" ON "MechanicNotification"("findingId", "createdAt");

CREATE OR REPLACE FUNCTION "turbolev_mechanic_notification_id"(seed TEXT)
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'mn_' || md5(
    COALESCE(seed, '') || ':' ||
    clock_timestamp()::text || ':' ||
    random()::text || ':' ||
    pg_backend_pid()::text
  );
$$;

CREATE OR REPLACE FUNCTION "turbolev_appointment_status_label"(status_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE status_value
    WHEN 'BOOKED' THEN 'Заплановано'
    WHEN 'ARRIVED' THEN 'Автомобіль прибув'
    WHEN 'DIAGNOSTICS' THEN 'Діагностика'
    WHEN 'WAITING_PARTS_SELECTION' THEN 'Підбір деталей'
    WHEN 'WAITING_CALCULATION' THEN 'Розрахунок'
    WHEN 'WAITING_APPROVAL' THEN 'Очікує погодження'
    WHEN 'WAITING_PARTS' THEN 'Очікує запчастини'
    WHEN 'READY_FOR_REPAIR' THEN 'Готово до ремонту'
    WHEN 'IN_REPAIR' THEN 'У ремонті'
    WHEN 'WAITING_QC' THEN 'Контроль якості'
    WHEN 'READY_FOR_PICKUP' THEN 'Готово до видачі'
    WHEN 'COMPLETED' THEN 'Завершено'
    WHEN 'WARRANTY' THEN 'Гарантійне звернення'
    WHEN 'PAUSED' THEN 'Пауза'
    WHEN 'NO_SHOW' THEN 'Не приїхав'
    WHEN 'CANCELLED' THEN 'Скасовано'
    WHEN 'RESERVE' THEN 'Резерв'
    ELSE status_value
  END;
$$;

CREATE OR REPLACE FUNCTION "turbolev_write_mechanic_notification"(
  mechanic_id TEXT,
  appointment_id TEXT,
  work_order_id TEXT,
  event_type TEXT,
  event_title TEXT,
  event_body TEXT,
  vehicle_label TEXT,
  plate_number TEXT,
  event_payload JSONB,
  event_key_seed TEXT,
  event_created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  notification_id TEXT;
  recipient_user_id TEXT;
  event_key TEXT;
BEGIN
  IF mechanic_id IS NULL OR mechanic_id = '' THEN
    RETURN;
  END IF;

  notification_id := "turbolev_mechanic_notification_id"(event_key_seed);
  event_key := left(event_key_seed || ':' || notification_id, 220);

  SELECT m."userId"
  INTO recipient_user_id
  FROM "ServiceMechanic" m
  WHERE m.id = mechanic_id
  LIMIT 1;

  INSERT INTO "MechanicNotification" (
    "id", "eventKey", "mechanicId", "recipientUserId", "appointmentId", "workOrderId",
    "type", "title", "body", "vehicleLabel", "plateNumber", "payload", "createdAt", "updatedAt"
  ) VALUES (
    notification_id, event_key, mechanic_id, recipient_user_id, appointment_id, work_order_id,
    event_type, event_title, event_body, vehicle_label, plate_number, event_payload,
    COALESCE(event_created_at, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
  );
END;
$$;

CREATE OR REPLACE FUNCTION "turbolev_service_appointment_notifications"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  post_name TEXT;
  schedule_label TEXT;
  vehicle_name TEXT;
  payload JSONB;
BEGIN
  vehicle_name := COALESCE(NULLIF(NEW."vehicleLabel", ''), NULLIF(NEW."plateNumber", ''), 'Автомобіль');
  SELECT p.name INTO post_name FROM "ServicePost" p WHERE p.id = NEW."postId" LIMIT 1;
  schedule_label := to_char(NEW."plannedStartAt" AT TIME ZONE 'Europe/Kyiv', 'DD.MM, HH24:MI');
  payload := jsonb_build_object(
    'appointmentId', NEW.id,
    'workOrderId', NEW."workOrderId",
    'status', NEW.status::text,
    'postId', NEW."postId",
    'post', post_name,
    'plannedStartAt', NEW."plannedStartAt",
    'plannedEndAt', NEW."plannedEndAt"
  );

  IF TG_OP = 'INSERT' THEN
    IF NEW."mechanicId" IS NOT NULL THEN
      PERFORM "turbolev_write_mechanic_notification"(
        NEW."mechanicId", NEW.id, NEW."workOrderId", 'ASSIGNED', 'Нове призначення',
        vehicle_name || ' · ' || schedule_label || COALESCE(' · ' || post_name, ''),
        NEW."vehicleLabel", NEW."plateNumber", payload,
        'appointment:' || NEW.id || ':assigned:' || NEW."mechanicId",
        NEW."createdAt"
      );
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."mechanicId" IS DISTINCT FROM NEW."mechanicId" THEN
    IF OLD."mechanicId" IS NOT NULL THEN
      PERFORM "turbolev_write_mechanic_notification"(
        OLD."mechanicId", NEW.id, NEW."workOrderId", 'UNASSIGNED', 'Призначення змінено',
        vehicle_name || ' передано іншому механіку.',
        NEW."vehicleLabel", NEW."plateNumber", payload,
        'appointment:' || NEW.id || ':unassigned:' || OLD."mechanicId",
        NEW."updatedAt"
      );
    END IF;
    IF NEW."mechanicId" IS NOT NULL THEN
      PERFORM "turbolev_write_mechanic_notification"(
        NEW."mechanicId", NEW.id, NEW."workOrderId", 'ASSIGNED', 'Нове призначення',
        vehicle_name || ' · ' || schedule_label || COALESCE(' · ' || post_name, ''),
        NEW."vehicleLabel", NEW."plateNumber", payload,
        'appointment:' || NEW.id || ':assigned:' || NEW."mechanicId",
        NEW."updatedAt"
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."mechanicId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD."plannedStartAt" IS DISTINCT FROM NEW."plannedStartAt"
     OR OLD."plannedEndAt" IS DISTINCT FROM NEW."plannedEndAt" THEN
    PERFORM "turbolev_write_mechanic_notification"(
      NEW."mechanicId", NEW.id, NEW."workOrderId", 'SCHEDULE_CHANGED', 'Змінено час запису',
      vehicle_name || ' · новий час ' || schedule_label,
      NEW."vehicleLabel", NEW."plateNumber", payload,
      'appointment:' || NEW.id || ':schedule', NEW."updatedAt"
    );
  END IF;

  IF OLD."postId" IS DISTINCT FROM NEW."postId" THEN
    PERFORM "turbolev_write_mechanic_notification"(
      NEW."mechanicId", NEW.id, NEW."workOrderId", 'POST_CHANGED', 'Змінено пост',
      vehicle_name || ' · ' || COALESCE(post_name, 'пост не призначено'),
      NEW."vehicleLabel", NEW."plateNumber", payload,
      'appointment:' || NEW.id || ':post', NEW."updatedAt"
    );
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM "turbolev_write_mechanic_notification"(
      NEW."mechanicId", NEW.id, NEW."workOrderId", 'STATUS_CHANGED', 'Оновлено статус авто',
      vehicle_name || ' · ' || "turbolev_appointment_status_label"(NEW.status::text),
      NEW."vehicleLabel", NEW."plateNumber", payload,
      'appointment:' || NEW.id || ':status:' || NEW.status::text, NEW."updatedAt"
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ServiceAppointment_mechanic_notifications_trg"
AFTER INSERT OR UPDATE OF "mechanicId", "plannedStartAt", "plannedEndAt", "postId", "status"
ON "ServiceAppointment"
FOR EACH ROW
EXECUTE FUNCTION "turbolev_service_appointment_notifications"();

CREATE OR REPLACE FUNCTION "turbolev_mechanic_finding_notifications"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  mechanic_id TEXT;
  recipient_user_id TEXT;
  vehicle_name TEXT;
  plate_number TEXT;
  work_description TEXT;
  notification_id TEXT;
  event_key TEXT;
BEGIN
  IF NEW."resolutionCode" IS DISTINCT FROM 'CLARIFICATION_REQUIRED'
     OR OLD."resolutionCode" IS NOT DISTINCT FROM 'CLARIFICATION_REQUIRED' THEN
    RETURN NEW;
  END IF;

  mechanic_id := NEW."mechanicResourceId";
  recipient_user_id := NEW."mechanicUserId";
  IF mechanic_id IS NULL THEN
    SELECT m.id INTO mechanic_id
    FROM "ServiceMechanic" m
    WHERE m."userId" = recipient_user_id AND m."isActive" = TRUE
    ORDER BY m."updatedAt" DESC
    LIMIT 1;
  END IF;
  IF mechanic_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(NULLIF(concat_ws(' ', v.brand, v.model, v.year::text), ''), NULLIF(v."plateNumber", ''), 'Автомобіль'),
    v."plateNumber"
  INTO vehicle_name, plate_number
  FROM "WorkOrder" wo
  JOIN "Vehicle" v ON v.id = wo."vehicleId"
  WHERE wo.id = NEW."workOrderId"
  LIMIT 1;

  SELECT l.description INTO work_description
  FROM "WorkOrderLine" l
  WHERE l.id = NEW."workOrderLineId"
  LIMIT 1;

  notification_id := "turbolev_mechanic_notification_id"('finding:' || NEW.id || ':clarification');
  event_key := left('finding:' || NEW.id || ':clarification:' || notification_id, 220);
  INSERT INTO "MechanicNotification" (
    "id", "eventKey", "mechanicId", "recipientUserId", "workOrderId", "findingId",
    "type", "title", "body", "vehicleLabel", "plateNumber", "payload", "createdAt", "updatedAt"
  ) VALUES (
    notification_id, event_key, mechanic_id, recipient_user_id, NEW."workOrderId", NEW.id,
    'CLARIFICATION_REQUIRED', 'Потрібне уточнення',
    COALESCE(NULLIF(NEW."managerComment", ''), 'Сервіс-менеджер просить уточнити виявлену несправність.'),
    COALESCE(vehicle_name, 'Автомобіль'), plate_number,
    jsonb_build_object('findingId', NEW.id, 'workOrderId', NEW."workOrderId", 'workOrderLineId', NEW."workOrderLineId", 'workDescription', work_description),
    COALESCE(NEW."reviewedAt", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER "MechanicWorkFinding_mechanic_notifications_trg"
AFTER UPDATE OF "resolutionCode" ON "MechanicWorkFinding"
FOR EACH ROW
EXECUTE FUNCTION "turbolev_mechanic_finding_notifications"();

-- Restore one persistent assignment event for every service case that is active at deployment time.
WITH ranked AS (
  SELECT
    a.*,
    m."userId" AS "recipientUserId",
    p.name AS "postName",
    wo.status AS "workOrderStatus",
    ROW_NUMBER() OVER (
      PARTITION BY a."mechanicId", COALESCE(NULLIF(a."workOrderId", ''), a.id)
      ORDER BY a."updatedAt" DESC, a."plannedStartAt" DESC
    ) AS rn
  FROM "ServiceAppointment" a
  JOIN "ServiceMechanic" m ON m.id = a."mechanicId"
  LEFT JOIN "ServicePost" p ON p.id = a."postId"
  LEFT JOIN "WorkOrder" wo ON wo.id = a."workOrderId"
  WHERE a."mechanicId" IS NOT NULL
    AND a.status::text NOT IN ('CANCELLED', 'RESERVE', 'NO_SHOW')
    AND (
      (a."workOrderId" IS NULL AND a.status::text <> 'COMPLETED')
      OR (a."workOrderId" IS NOT NULL AND wo.id IS NOT NULL AND wo.status NOT IN ('CLOSED', 'CANCELLED'))
      OR (a."workOrderId" IS NOT NULL AND wo.id IS NULL AND a.status::text <> 'COMPLETED')
    )
)
INSERT INTO "MechanicNotification" (
  "id", "eventKey", "mechanicId", "recipientUserId", "appointmentId", "workOrderId",
  "type", "title", "body", "vehicleLabel", "plateNumber", "payload", "createdAt", "updatedAt"
)
SELECT
  'mn_' || md5('bootstrap:' || r.id || ':' || r."mechanicId"),
  left('bootstrap:appointment:' || r.id || ':assigned:' || r."mechanicId", 220),
  r."mechanicId", r."recipientUserId", r.id, r."workOrderId",
  'ASSIGNED', 'Закріплено за вами',
  COALESCE(NULLIF(r."vehicleLabel", ''), NULLIF(r."plateNumber", ''), 'Автомобіль') || ' · ' ||
    to_char(r."plannedStartAt" AT TIME ZONE 'Europe/Kyiv', 'DD.MM, HH24:MI') ||
    COALESCE(' · ' || r."postName", ''),
  r."vehicleLabel", r."plateNumber",
  jsonb_build_object(
    'appointmentId', r.id,
    'workOrderId', r."workOrderId",
    'status', r.status::text,
    'postId', r."postId",
    'post', r."postName",
    'plannedStartAt', r."plannedStartAt",
    'plannedEndAt', r."plannedEndAt",
    'bootstrap', true
  ),
  r."updatedAt", CURRENT_TIMESTAMP
FROM ranked r
WHERE r.rn = 1
ON CONFLICT ("eventKey") DO NOTHING;

-- Restore outstanding manager clarification requests in the same durable feed.
WITH active_findings AS (
  SELECT
    f.*,
    COALESCE(f."mechanicResourceId", m.id) AS "resolvedMechanicId",
    COALESCE(f."mechanicUserId", m."userId") AS "resolvedUserId",
    COALESCE(NULLIF(concat_ws(' ', v.brand, v.model, v.year::text), ''), NULLIF(v."plateNumber", ''), 'Автомобіль') AS "vehicleName",
    v."plateNumber" AS "vehiclePlate",
    l.description AS "workDescription"
  FROM "MechanicWorkFinding" f
  LEFT JOIN "ServiceMechanic" m ON m."userId" = f."mechanicUserId" AND m."isActive" = TRUE
  LEFT JOIN "WorkOrder" wo ON wo.id = f."workOrderId"
  LEFT JOIN "Vehicle" v ON v.id = wo."vehicleId"
  LEFT JOIN "WorkOrderLine" l ON l.id = f."workOrderLineId"
  WHERE f.status::text = 'REVIEWED'
    AND f."resolutionCode" = 'CLARIFICATION_REQUIRED'
)
INSERT INTO "MechanicNotification" (
  "id", "eventKey", "mechanicId", "recipientUserId", "workOrderId", "findingId",
  "type", "title", "body", "vehicleLabel", "plateNumber", "payload", "createdAt", "updatedAt"
)
SELECT
  'mn_' || md5('bootstrap:finding:' || f.id),
  left('bootstrap:finding:' || f.id || ':clarification', 220),
  f."resolvedMechanicId", f."resolvedUserId", f."workOrderId", f.id,
  'CLARIFICATION_REQUIRED', 'Потрібне уточнення',
  COALESCE(NULLIF(f."managerComment", ''), 'Сервіс-менеджер просить уточнити виявлену несправність.'),
  f."vehicleName", f."vehiclePlate",
  jsonb_build_object('findingId', f.id, 'workOrderId', f."workOrderId", 'workOrderLineId', f."workOrderLineId", 'workDescription', f."workDescription", 'bootstrap', true),
  COALESCE(f."reviewedAt", f."updatedAt"), CURRENT_TIMESTAMP
FROM active_findings f
WHERE f."resolvedMechanicId" IS NOT NULL
ON CONFLICT ("eventKey") DO NOTHING;
