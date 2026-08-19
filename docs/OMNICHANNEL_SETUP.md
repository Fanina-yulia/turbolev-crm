# Turbo LEV CRM — live communications activation

This guide activates the existing **Клієнти → Комунікації** inbox for Facebook Messenger, Instagram Direct and OLX.

## What the CRM already does

- Meta webhook endpoint: `/api/webhooks/meta`
- Meta signature validation with `X-Hub-Signature-256`
- Facebook/Instagram inbound message ingestion into Neon
- Facebook/Instagram outbound text delivery through Meta Send API
- Meta delivery/read events persisted in message status
- 24-hour standard Meta reply-window enforcement for conversations that arrived through the live webhook
- OLX OAuth callback and encrypted token storage
- OLX thread/message synchronization
- OLX outbound text replies from CRM
- OLX automatic access-token refresh with one retry after HTTP 401
- OLX mark-as-read when the CRM conversation is opened
- Inbox refresh every few seconds and throttled OLX polling while the communications screen is open
- Social identity records that can be linked to an existing CRM client

Secrets are stored through `IntegrationCredential` and encrypted server-side. Do not commit provider secrets to GitHub.

---

## Meta: Facebook Messenger + Instagram Direct

### 1. Create/configure the Meta app

Use a Meta Business app that has access to the Turbo LEV Facebook Page and its linked Instagram Professional account.

Required access depends on the selected Meta login model. For the current CRM configuration, use a Facebook Page access token and the Facebook Login for Business model for the linked Instagram Professional account.

### 2. Save credentials in CRM

Open:

`Налаштування → Інтеграції → Комунікації → Facebook + Instagram`

Save:

- Meta App ID
- Page access token
- App secret
- Webhook verify token (CRM can generate one if left blank)

Then press **Перевірити з'єднання**.

### 3. Configure Meta webhook

In Meta App Dashboard configure the callback URL:

`https://<CRM-DOMAIN>/api/webhooks/meta`

Use the exact verify token saved/generated in CRM.

Subscribe the messaging products to the fields needed for the app, at minimum inbound messages and postbacks. Add read/delivery fields where available for the selected Messenger/Instagram configuration.

### 4. Subscribe/install the app on the business account

The app must be connected to the Facebook Page / Instagram Professional account in Meta. A valid token alone is not sufficient if the app is not subscribed to messaging events.

### 5. End-to-end test

1. From a different personal Facebook account, send a Messenger message to the Turbo LEV Page.
2. Confirm it appears in `Комунікації → Facebook`.
3. Reply from CRM and confirm the reply arrives in Messenger.
4. Repeat from a different Instagram account to the Turbo LEV Instagram Professional account.
5. Confirm the reply is delivered back to Instagram Direct.

Do not consider Meta live until both inbound and outbound tests pass with real external accounts.

---

## OLX

### 1. Obtain Partner API access

Create/approve the OLX API application and obtain:

- Client ID
- Client secret

Register the production callback URL used by the CRM:

`https://<CRM-DOMAIN>/api/integrations/olx/callback`

The callback registered at OLX must match the domain from which the authorization flow is started.

### 2. Save app credentials

Open:

`Налаштування → Інтеграції → Комунікації → OLX`

Save Client ID and Client secret.

### 3. Authorize the OLX account

Open `Комунікації → Інтеграції` and press **Підключити OLX**.

The CRM redirects to OLX OAuth. After consent, OLX redirects to the callback route, and the CRM stores access/refresh tokens in encrypted `IntegrationCredential` storage.

### 4. Synchronize

Use **Синхронізувати зараз** for the first import.

While the communications screen is open, the CRM also uses a throttled polling endpoint. The server prevents a full OLX sync from being executed more frequently than the configured minimum interval.

### 5. End-to-end test

1. Send a real OLX message to one of the Turbo LEV adverts from another OLX account.
2. Run sync / wait for background polling.
3. Confirm the thread appears under `Комунікації → OLX`.
4. Reply from CRM.
5. Confirm the answer arrives in the OLX conversation.
6. Open the conversation in CRM and verify the OLX thread becomes read after the next sync.

---

## Delivery states

External outgoing messages use these states:

- `PENDING` — CRM saved the message and external delivery has started
- `SENT` — provider accepted the message
- `DELIVERED` — provider delivery event received when supported
- `READ` — provider read/seen event received when supported
- `FAILED` — provider rejected the request or delivery call failed
- `CRM_ONLY` — channel does not currently have a live outbound adapter

The CRM does **not** set `answered=true` for Facebook, Instagram or OLX until the external provider has accepted the outgoing message.

---

## Database migration

Production deployment runs Prisma migrations before the Next.js build. The omnichannel migration extends the communications core with provider IDs, delivery state, external identities, account records and synchronization state.

Preview builds intentionally skip production migrations, so provider runtime endpoints that depend on the new columns should be end-to-end tested after the migration is applied to the target database.

---

## Acceptance checklist

- [ ] Facebook inbound works from a real external account
- [ ] Facebook reply from CRM arrives to the sender
- [ ] Instagram inbound works from a real external account
- [ ] Instagram reply from CRM arrives to the sender
- [ ] Duplicate Meta webhook delivery does not duplicate a message
- [ ] Meta invalid signature is rejected
- [ ] Meta expired standard reply window is blocked in backend
- [ ] OLX OAuth succeeds
- [ ] OLX first sync imports real threads/messages
- [ ] Repeated OLX sync does not duplicate messages
- [ ] OLX CRM reply arrives in OLX
- [ ] OLX token refresh works after an expired access token
- [ ] OLX HTTP 429 is surfaced without marking the message as answered
- [ ] Failed external send is shown as failed in CRM
- [ ] Binotel remains functional
- [ ] Production Vercel build is READY
