import "server-only";
import type { QueryResultRow } from "pg";
import { getSqlPool } from "@/src/lib/sql";
import {
  getAutomaticCommunicationLifecycles,
  type AutomaticCommunicationLifecycleState,
} from "@/src/services/communication-business-lifecycle.service";

export type CommunicationLifecycleState = "NEW" | "IN_WORK" | "WAITING_CLIENT" | "CLOSED" | "NOT_OUR_CLIENT" | "SPAM";

type LifecycleSource = {
  state?: unknown;
  answered?: unknown;
  metadata?: unknown;
  automaticLifecycleState?: unknown;
  automaticLifecycleChangedAt?: unknown;
};

type InquiryLifecycleRow = QueryResultRow & {
  id: string;
  state: string;
  answered: boolean;
  unread: boolean;
  leadId: string | null;
  assignedUserId: string | null;
  metadata: unknown;
};

const manualLifecycleStates = new Set<CommunicationLifecycleState>(["NEW", "IN_WORK", "WAITING_CLIENT", "NOT_OUR_CLIENT"]);

export class CommunicationLifecycleRuleError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "CommunicationLifecycleRuleError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function timestamp(value: unknown) {
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function automaticState(value: unknown): AutomaticCommunicationLifecycleState | null {
  const normalized = String(value || "").toUpperCase();
  return normalized === "NEW" || normalized === "IN_WORK" || normalized === "CLOSED" ? normalized : null;
}

function manualState(metadata: Record<string, unknown> | null): CommunicationLifecycleState | null {
  const normalized = String(metadata?.lifecycleManualState || "").toUpperCase() as CommunicationLifecycleState;
  if (manualLifecycleStates.has(normalized)) return normalized;
  if (metadata?.lifecycleNotOurClientAt) return "NOT_OUR_CLIENT";
  return null;
}

export function resolveCommunicationLifecycleState(source: LifecycleSource): CommunicationLifecycleState {
  const stored = String(source.state || "IN_WORK").toUpperCase();
  const metadata = record(source.metadata);
  if (stored === "SPAM") return "SPAM";
  const automatic = automaticState(source.automaticLifecycleState);
  if (automatic === "CLOSED") return "CLOSED";

  const manual = manualState(metadata);
  const manualAt = timestamp(metadata?.lifecycleManualAt || metadata?.lifecycleNotOurClientAt);
  const latestAutomaticEvent = timestamp(source.automaticLifecycleChangedAt);
  if (manual && manualAt >= latestAutomaticEvent) return manual;
  if (automatic === "IN_WORK") return "IN_WORK";

  if (stored === "NOT_OUR_CLIENT") return "NOT_OUR_CLIENT";
  // Legacy callers that do not yet provide the automatic projection can still
  // read historical closed metadata. API list/snapshot callers always provide it.
  if (!automatic && metadata?.lifecycleClosedAt) return "CLOSED";
  if (stored === "NEW") return "NEW";
  if (Boolean(source.answered)) return "WAITING_CLIENT";
  return "IN_WORK";
}

export function withCommunicationLifecycleState<T extends LifecycleSource>(source: T): T & { state: CommunicationLifecycleState } {
  return { ...source, state: resolveCommunicationLifecycleState(source) };
}

export async function getCommunicationLifecycleSnapshot(id: string) {
  const pool = getSqlPool();
  const [result, automaticLifecycles] = await Promise.all([
    pool.query<InquiryLifecycleRow>(
    `SELECT "id","state","answered","unread","leadId","assignedUserId","metadata"
       FROM "CommunicationInquiry"
      WHERE "id"=$1
      LIMIT 1`,
    [id],
    ),
    getAutomaticCommunicationLifecycles([id]),
  ]);
  const row = result.rows[0];
  if (!row) return null;
  const automaticLifecycle = automaticLifecycles.get(id);
  const enriched = {
    ...row,
    automaticLifecycleState: automaticLifecycle?.state,
    automaticLifecycleChangedAt: automaticLifecycle?.changedAt,
  };
  return { ...enriched, lifecycleState: resolveCommunicationLifecycleState(enriched) };
}

export async function setCommunicationLifecycleState(id: string, state: CommunicationLifecycleState) {
  const pool = getSqlPool();
  if (state === "CLOSED") {
    const currentAutomatic = await getAutomaticCommunicationLifecycles([id]);
    if (currentAutomatic.get(id)?.state !== "CLOSED") {
      throw new CommunicationLifecycleRuleError("Закрити звернення можна лише після видачі авто та повної оплати.");
    }
  }

  const result = await pool.query<InquiryLifecycleRow>(
    state === "CLOSED"
      ? `UPDATE "CommunicationInquiry"
            SET "state"='IN_WORK',
                "answered"=TRUE,
                "unread"=FALSE,
                "metadata"=((((COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt') - 'lifecycleNotOurClientAt') - 'lifecycleManualState') - 'lifecycleManualAt') || jsonb_build_object('lifecycleClosedAt', CURRENT_TIMESTAMP),
                "updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$1
          RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`
      : state === "NOT_OUR_CLIENT"
        ? `UPDATE "CommunicationInquiry"
              SET "state"='IN_WORK',
                  "answered"=TRUE,
                  "unread"=FALSE,
                  "metadata"=((((COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt') - 'lifecycleNotOurClientAt') - 'lifecycleManualState') - 'lifecycleManualAt') || jsonb_build_object('lifecycleNotOurClientAt', CURRENT_TIMESTAMP, 'lifecycleManualState', 'NOT_OUR_CLIENT', 'lifecycleManualAt', CURRENT_TIMESTAMP),
                  "updatedAt"=CURRENT_TIMESTAMP
            WHERE "id"=$1
            RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`
      : state === "WAITING_CLIENT"
        ? `UPDATE "CommunicationInquiry"
              SET "state"='IN_WORK',
                  "answered"=TRUE,
                  "unread"=FALSE,
                  "metadata"=((((COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt') - 'lifecycleNotOurClientAt') - 'lifecycleManualState') - 'lifecycleManualAt') || jsonb_build_object('lifecycleManualState', 'WAITING_CLIENT', 'lifecycleManualAt', CURRENT_TIMESTAMP),
                  "updatedAt"=CURRENT_TIMESTAMP
            WHERE "id"=$1
            RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`
        : state === "NEW"
          ? `UPDATE "CommunicationInquiry"
                SET "state"='NEW',
                    "answered"=FALSE,
                    "metadata"=((((COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt') - 'lifecycleNotOurClientAt') - 'lifecycleManualState') - 'lifecycleManualAt') || jsonb_build_object('lifecycleManualState', 'NEW', 'lifecycleManualAt', CURRENT_TIMESTAMP),
                    "updatedAt"=CURRENT_TIMESTAMP
              WHERE "id"=$1
              RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`
          : state === "SPAM"
            ? `UPDATE "CommunicationInquiry"
                  SET "state"='SPAM',
                      "answered"=TRUE,
                      "unread"=FALSE,
                      "metadata"=(((COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt') - 'lifecycleNotOurClientAt') - 'lifecycleManualState') - 'lifecycleManualAt',
                      "updatedAt"=CURRENT_TIMESTAMP
                WHERE "id"=$1
                RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`
            : `UPDATE "CommunicationInquiry"
                  SET "state"='IN_WORK',
                      "answered"=FALSE,
                      "metadata"=((((COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt') - 'lifecycleNotOurClientAt') - 'lifecycleManualState') - 'lifecycleManualAt') || jsonb_build_object('lifecycleManualState', 'IN_WORK', 'lifecycleManualAt', CURRENT_TIMESTAMP),
                      "updatedAt"=CURRENT_TIMESTAMP
                WHERE "id"=$1
                RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Inquiry not found");
  const automaticLifecycle = (await getAutomaticCommunicationLifecycles([id])).get(id);
  const enriched = {
    ...row,
    automaticLifecycleState: automaticLifecycle?.state,
    automaticLifecycleChangedAt: automaticLifecycle?.changedAt,
  };
  return { ...enriched, state: resolveCommunicationLifecycleState(enriched) };
}

export async function normalizeInquiryAfterLeadConversion(id: string) {
  const pool = getSqlPool();
  const result = await pool.query<InquiryLifecycleRow>(
    `UPDATE "CommunicationInquiry"
        SET "state"=CASE WHEN "state"='SPAM' THEN "state" ELSE 'IN_WORK'::"InquiryState" END,
            "metadata"=(((COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt') - 'lifecycleNotOurClientAt') - 'lifecycleManualState') - 'lifecycleManualAt',
            "updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"=$1
      RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Inquiry not found");
  const automaticLifecycle = (await getAutomaticCommunicationLifecycles([id])).get(id);
  const enriched = {
    ...row,
    automaticLifecycleState: automaticLifecycle?.state,
    automaticLifecycleChangedAt: automaticLifecycle?.changedAt,
  };
  return { ...enriched, state: resolveCommunicationLifecycleState(enriched) };
}
