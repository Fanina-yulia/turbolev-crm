# Turbo LEV CRM — Binotel telephony

## Phase 1: database + server client

Implemented:

- `prisma/schema.prisma` — `CallHistory`, `Lead`, `Client`, `User` and telephony enums.
- `src/lib/prisma.ts` — singleton Prisma client for Next.js/Vercel.
- `src/services/binotel.service.ts` — server-only REST client with Click-to-Call and call-record media lookup.
- `app/api/telephony/binotel-health/route.ts` — safe configuration health check; never exposes secrets.
- `.env.example` and `.gitignore` — environment contract and secret protection.

## CallHistory lifecycle

A call can be created while ringing with `status = null`. The final status is written only when Binotel reports the completed state: `ANSWERED`, `MISSED` or `BUSY`.

`binotelCallId` is unique, which allows webhook processing to be idempotent and prevents duplicate call history rows when Binotel retries an event.

## Relations

`CallHistory` can be linked independently to:

- `Lead` — when the caller is still a sales lead;
- `Client` — when the phone number already belongs to a customer;
- `User` — the responsible/connected manager, resolved by Binotel internal number.

All relations use `onDelete: SetNull` so historical telephony records are not deleted when a CRM entity is removed.

## Required production configuration

The repository must never contain real secrets. Production values belong in Vercel Environment Variables.

In addition to Binotel credentials, the next database step requires a PostgreSQL `DATABASE_URL`.

## Next phase

1. Apply the Prisma schema to PostgreSQL.
2. Implement `POST /api/telephony/binotel-webhook` with idempotent upsert by `binotelCallId`.
3. Resolve caller by normalized phone across `Client` and `Lead`.
4. Auto-create `Lead(source=BINOTEL, status=NEW_REQUEST)` for unknown inbound numbers.
5. Create missed-call alerts.
6. Add realtime WebSocket event delivery to the frontend.
7. Add `/telephony`, incoming-call popup and Click-to-Call actions.
