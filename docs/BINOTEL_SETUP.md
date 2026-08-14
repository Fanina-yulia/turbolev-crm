# Turbo LEV CRM — Binotel + PostgreSQL setup

## 1. Database

For new Vercel projects use a PostgreSQL provider from Vercel Marketplace. Turbo LEV uses Neon.

Required Vercel environment variables:

- `DATABASE_URL` — pooled runtime connection.
- `DATABASE_URL_UNPOOLED` — direct connection for Prisma migrations (when provided by Neon).

After the variables are connected, apply the migration already committed in `prisma/migrations`:

```bash
npm run db:migrate:deploy
```

Development-only workflow against a disposable development database:

```bash
npm run db:migrate:dev -- --name your_change_name
```

Do not use `migrate dev` against production.

## 2. Binotel webhook

Endpoint:

```text
POST https://YOUR_DOMAIN/api/telephony/binotel-webhook
```

Supported CRM events:

- `incomingCall`
- `answeredTheCall`
- `hangupTheCall`

The route accepts JSON, `application/x-www-form-urlencoded`, and multipart form data.

If Binotel does not include the event name in the callback body, configure an explicit event query parameter:

```text
https://YOUR_DOMAIN/api/telephony/binotel-webhook?event=incomingCall
https://YOUR_DOMAIN/api/telephony/binotel-webhook?event=answeredTheCall
https://YOUR_DOMAIN/api/telephony/binotel-webhook?event=hangupTheCall
```

For additional webhook protection set `BINOTEL_WEBHOOK_TOKEN` in Vercel and append the same secret token to the configured callback URL:

```text
https://YOUR_DOMAIN/api/telephony/binotel-webhook?event=incomingCall&token=YOUR_SECRET_TOKEN
```

Do not commit the token or any Binotel credentials to Git.

## 3. Webhook behavior

For every supported event CRM:

1. Normalizes the external phone number.
2. Searches `Client` first.
3. If no Client is found, searches `Lead`.
4. If neither exists, creates `Lead(status=NEW_REQUEST, source=BINOTEL)`.
5. Upserts `CallHistory` by unique `binotelCallId`.
6. Links the call to the matched Client/Lead and to the User found by `internalNumber`.
7. On answer, sets `ANSWERED` and `answeredAt`.
8. On hangup, calculates duration and final status (`ANSWERED`, `MISSED`, or `BUSY`).
9. For answered completed calls, attempts to fetch and save `recordingUrl` without failing the webhook if Binotel has not prepared the recording yet.

## 4. Health check

```text
GET https://YOUR_DOMAIN/api/telephony/binotel-health
```

The response reports whether DB/Binotel variables are configured, but never returns secret values.

## 5. First live test

After database migration and Binotel callback configuration:

1. Make one inbound call from a phone number that does not exist in CRM.
2. Confirm that a new `Lead` with source `BINOTEL` appears.
3. Answer and hang up.
4. Confirm that the same `CallHistory` row is updated instead of duplicated.
5. Inspect the Vercel function logs only if the payload format differs. The webhook logs field names, not the full payload, for unsupported/malformed events.
