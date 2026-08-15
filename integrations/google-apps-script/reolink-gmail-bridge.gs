/*
 * Turbo LEV — Reolink Gmail Bridge
 *
 * Runs inside the EXISTING Google account. No server, VM, Railway, Oracle,
 * Google Cloud project, or additional account is required.
 *
 * Setup:
 * 1. Replace CAMERA_UID and INGEST_TOKEN below with values shown by CRM.
 * 2. Run setupTurboLevReolink() once and approve Gmail + UrlFetch permissions.
 * 3. In Reolink Email Alerts, use the +reolink alias printed by setup.
 */

const TURBOLEV_REOLINK = Object.freeze({
  CRM_BASE_URL: "https://turbolev-crm.vercel.app",
  CAMERA_UID: "PASTE_CAMERA_UID_HERE",
  INGEST_TOKEN: "PASTE_ONE_TIME_INGEST_TOKEN_HERE",
  MAX_MESSAGES_PER_RUN: 40,
  MAX_PROCESSED_IDS: 250,
});

function setupTurboLevReolink() {
  validateConfig_();

  const existing = ScriptApp.getProjectTriggers();
  existing
    .filter((trigger) => trigger.getHandlerFunction() === "syncReolinkAlerts")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("syncReolinkAlerts")
    .timeBased()
    .everyMinutes(1)
    .create();

  const email = Session.getEffectiveUser().getEmail();
  const alias = reolinkAlias_(email);
  Logger.log("Turbo LEV Reolink bridge enabled.");
  Logger.log("Set this as the Reolink Email Alert recipient: %s", alias);
  Logger.log("The same Gmail inbox will receive the messages.");
}

function syncReolinkAlerts() {
  validateConfig_();

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) return;

  try {
    const email = Session.getEffectiveUser().getEmail();
    const alias = reolinkAlias_(email);
    const query = `to:${alias} has:attachment newer_than:2d -in:trash -in:spam`;
    const threads = GmailApp.search(query, 0, TURBOLEV_REOLINK.MAX_MESSAGES_PER_RUN);
    const processed = loadProcessedIds_();

    const messages = [];
    threads.forEach((thread) => {
      thread.getMessages().forEach((message) => messages.push(message));
    });
    messages.sort((a, b) => a.getDate().getTime() - b.getDate().getTime());

    for (const message of messages) {
      const messageId = message.getId();
      if (processed.has(messageId)) continue;

      const attachment = firstImageAttachment_(message);
      if (!attachment) {
        rememberProcessed_(processed, messageId);
        continue;
      }

      const bytes = attachment.getBytes();
      if (!bytes || bytes.length === 0) {
        rememberProcessed_(processed, messageId);
        continue;
      }

      const payload = {
        cameraUid: TURBOLEV_REOLINK.CAMERA_UID.trim().toUpperCase(),
        token: TURBOLEV_REOLINK.INGEST_TOKEN.trim(),
        gmailMessageId: messageId,
        subject: message.getSubject() || "",
        from: message.getFrom() || "",
        to: message.getTo() || "",
        receivedAt: message.getDate().toISOString(),
        attachmentName: attachment.getName() || "reolink.jpg",
        attachmentContentType: attachment.getContentType() || "image/jpeg",
        attachmentBase64: Utilities.base64Encode(bytes),
      };

      const response = UrlFetchApp.fetch(
        `${TURBOLEV_REOLINK.CRM_BASE_URL.replace(/\/$/, "")}/api/camera-events/email`,
        {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        },
      );

      const status = response.getResponseCode();
      if (status >= 200 && status < 300) {
        rememberProcessed_(processed, messageId);
      } else {
        console.error(
          "Turbo LEV camera ingest failed: HTTP %s %s",
          status,
          response.getContentText().slice(0, 500),
        );
      }
    }

    saveProcessedIds_(processed);
  } finally {
    lock.releaseLock();
  }
}

function testTurboLevReolinkBridge() {
  validateConfig_();
  syncReolinkAlerts();
  Logger.log("Manual sync finished. Open CRM → Налаштування → Камери to verify the last event.");
}

function firstImageAttachment_(message) {
  const attachments = message.getAttachments({
    includeInlineImages: false,
    includeAttachments: true,
  });

  return attachments.find((attachment) => {
    const type = (attachment.getContentType() || "").toLowerCase();
    const name = (attachment.getName() || "").toLowerCase();
    return type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(name);
  }) || null;
}

function reolinkAlias_(email) {
  if (!email) throw new Error("Google account email is unavailable.");
  const at = email.lastIndexOf("@");
  if (at < 1) throw new Error("Invalid Google account email.");
  return `${email.slice(0, at)}+reolink${email.slice(at)}`;
}

function validateConfig_() {
  if (!/^https:\/\//i.test(TURBOLEV_REOLINK.CRM_BASE_URL)) {
    throw new Error("CRM_BASE_URL must use HTTPS.");
  }
  if (!/^[A-Z0-9]{12,40}$/i.test(TURBOLEV_REOLINK.CAMERA_UID.trim())) {
    throw new Error("Replace CAMERA_UID with the Reolink UID from CRM.");
  }
  if (TURBOLEV_REOLINK.INGEST_TOKEN.includes("PASTE_") || TURBOLEV_REOLINK.INGEST_TOKEN.length < 24) {
    throw new Error("Replace INGEST_TOKEN with the one-time key generated by CRM.");
  }
}

function loadProcessedIds_() {
  const raw = PropertiesService.getScriptProperties().getProperty("TURBOLEV_REOLINK_PROCESSED_IDS");
  if (!raw) return new Set();
  try {
    const values = JSON.parse(raw);
    return new Set(Array.isArray(values) ? values.filter((value) => typeof value === "string") : []);
  } catch (_error) {
    return new Set();
  }
}

function rememberProcessed_(set, messageId) {
  set.add(messageId);
  while (set.size > TURBOLEV_REOLINK.MAX_PROCESSED_IDS) {
    const first = set.values().next().value;
    if (!first) break;
    set.delete(first);
  }
}

function saveProcessedIds_(set) {
  const values = Array.from(set).slice(-TURBOLEV_REOLINK.MAX_PROCESSED_IDS);
  PropertiesService.getScriptProperties().setProperty(
    "TURBOLEV_REOLINK_PROCESSED_IDS",
    JSON.stringify(values),
  );
}
