import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSqlPool } from "@/src/lib/sql";
import { normalizePhone } from "@/src/services/communications-server.service";

export const runtime = "nodejs";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

function providerFor(channel: string) {
  if (channel === "FACEBOOK" || channel === "INSTAGRAM") return `META:${channel}`;
  if (channel === "OLX") return "OLX";
  return null;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const pool = getSqlPool();
  const client = await pool.connect();
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { clientId?: string; phone?: string };
    const inquiryResult = await client.query<{
      id: string;
      channel: string;
      externalParticipantId: string | null;
      handle: string | null;
    }>(
      `SELECT "id","channel","externalParticipantId","handle" FROM "CommunicationInquiry" WHERE "id"=$1 LIMIT 1`,
      [id],
    );
    const inquiry = inquiryResult.rows[0];
    if (!inquiry) return NextResponse.json({ ok: false, error: "Звернення не знайдено" }, { status: 404 });
    const provider = providerFor(inquiry.channel);
    if (!provider || !inquiry.externalParticipantId) {
      return NextResponse.json({ ok: false, error: "Цей контакт не має зовнішнього ID для прив'язки" }, { status: 422 });
    }

    let clientRow: { id: string; name: string | null; phone: string; phoneNormalized: string } | undefined;
    if (body.clientId?.trim()) {
      const result = await client.query<{ id: string; name: string | null; phone: string; phoneNormalized: string }>(
        `SELECT "id","name","phone","phoneNormalized" FROM "Client" WHERE "id"=$1 LIMIT 1`,
        [body.clientId.trim()],
      );
      clientRow = result.rows[0];
    } else if (body.phone?.trim()) {
      const normalized = normalizePhone(body.phone);
      const result = await client.query<{ id: string; name: string | null; phone: string; phoneNormalized: string }>(
        `SELECT DISTINCT ON (c."id") c."id",c."name",c."phone",c."phoneNormalized"
         FROM "Client" c
         LEFT JOIN "ClientPhone" cp ON cp."clientId"=c."id"
         WHERE c."phoneNormalized"=$1 OR cp."phoneNormalized"=$1
         ORDER BY c."id",c."updatedAt" DESC LIMIT 1`,
        [normalized],
      );
      clientRow = result.rows[0];
    }
    if (!clientRow) return NextResponse.json({ ok: false, error: "Клієнта з таким телефоном не знайдено" }, { status: 404 });

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "ExternalContactIdentity"
       ("id","provider","channel","externalUserId","handle","displayName","clientId","metadata")
       VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb)
       ON CONFLICT ("provider","externalUserId") DO UPDATE SET
         "clientId"=EXCLUDED."clientId",
         "handle"=COALESCE(EXCLUDED."handle","ExternalContactIdentity"."handle"),
         "displayName"=COALESCE(EXCLUDED."displayName","ExternalContactIdentity"."displayName"),
         "updatedAt"=CURRENT_TIMESTAMP`,
      [
        `ext_${randomUUID().replace(/-/g, "")}`,
        provider,
        inquiry.channel,
        inquiry.externalParticipantId,
        inquiry.handle,
        clientRow.name,
        clientRow.id,
      ],
    );
    await client.query(
      `UPDATE "CommunicationInquiry"
       SET "name"=COALESCE($1,"name"),"phone"=$2,"phoneNormalized"=$3,"updatedAt"=CURRENT_TIMESTAMP
       WHERE "channel"=$4 AND "externalParticipantId"=$5`,
      [clientRow.name, clientRow.phone, clientRow.phoneNormalized, inquiry.channel, inquiry.externalParticipantId],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, client: clientRow });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("POST link communication client failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося прив'язати клієнта" }, { status: 500 });
  } finally {
    client.release();
  }
}
