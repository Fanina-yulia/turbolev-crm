import "server-only";
import type { QueryResultRow } from "pg";
import { getSqlPool } from "@/src/lib/sql";

export type CommunicationLifecycleState = "NEW" | "IN_WORK" | "WAITING_CLIENT" | "CLOSED" | "SPAM";

type LifecycleSource = {
  state?: unknown;
  answered?: unknown;
  metadata?: unknown;
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function resolveCommunicationLifecycleState(source: LifecycleSource): CommunicationLifecycleState {
  const stored = String(source.state || "IN_WORK").toUpperCase();
  const metadata = record(source.metadata);
  if (stored === "SPAM") return "SPAM";
  if (metadata?.lifecycleClosedAt) return "CLOSED";
  if (stored === "NEW") return "NEW";
  if (Boolean(source.answered)) return "WAITING_CLIENT";
  return "IN_WORK";
}

export function withCommunicationLifecycleState<T extends LifecycleSource>(source: T): T & { state: CommunicationLifecycleState } {
  return { ...source, state: resolveCommunicationLifecycleState(source) };
}

export async function getCommunicationLifecycleSnapshot(id: string) {
  const pool = getSqlPool();
  const result = await pool.query<InquiryLifecycleRow>(
    `SELECT "id","state","answered","unread","leadId","assignedUserId","metadata"
       FROM "CommunicationInquiry"
      WHERE "id"=$1
      LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  return row ? { ...row, lifecycleState: resolveCommunicationLifecycleState(row) } : null;
}

export async function setCommunicationLifecycleState(id: string, state: CommunicationLifecycleState) {
  const pool = getSqlPool();
  const result = await pool.query<InquiryLifecycleRow>(
    state === "CLOSED"
      ? `UPDATE "CommunicationInquiry"
            SET "state"='IN_WORK',
                "answered"=TRUE,
                "unread"=FALSE,
                "metadata"=(COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt') || jsonb_build_object('lifecycleClosedAt', CURRENT_TIMESTAMP),
                "updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$1
          RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`
      : state === "WAITING_CLIENT"
        ? `UPDATE "CommunicationInquiry"
              SET "state"='IN_WORK',
                  "answered"=TRUE,
                  "unread"=FALSE,
                  "metadata"=COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt',
                  "updatedAt"=CURRENT_TIMESTAMP
            WHERE "id"=$1
            RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`
        : state === "NEW"
          ? `UPDATE "CommunicationInquiry"
                SET "state"='NEW',
                    "answered"=FALSE,
                    "metadata"=COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt',
                    "updatedAt"=CURRENT_TIMESTAMP
              WHERE "id"=$1
              RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`
          : state === "SPAM"
            ? `UPDATE "CommunicationInquiry"
                  SET "state"='SPAM',
                      "answered"=TRUE,
                      "unread"=FALSE,
                      "metadata"=COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt',
                      "updatedAt"=CURRENT_TIMESTAMP
                WHERE "id"=$1
                RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`
            : `UPDATE "CommunicationInquiry"
                  SET "state"='IN_WORK',
                      "answered"=FALSE,
                      "metadata"=COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt',
                      "updatedAt"=CURRENT_TIMESTAMP
                WHERE "id"=$1
                RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Inquiry not found");
  return { ...row, state: resolveCommunicationLifecycleState(row) };
}

export async function normalizeInquiryAfterLeadConversion(id: string) {
  const pool = getSqlPool();
  const result = await pool.query<InquiryLifecycleRow>(
    `UPDATE "CommunicationInquiry"
        SET "state"=CASE WHEN "state"='SPAM' THEN "state" ELSE 'IN_WORK'::"InquiryState" END,
            "metadata"=COALESCE("metadata", '{}'::jsonb) - 'lifecycleClosedAt',
            "updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"=$1
      RETURNING "id","state","answered","unread","leadId","assignedUserId","metadata"`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Inquiry not found");
  return { ...row, state: resolveCommunicationLifecycleState(row) };
}
