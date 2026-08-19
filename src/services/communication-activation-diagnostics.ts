export type CommunicationActivationState = "OK" | "WAITING" | "ERROR";

export type CommunicationActivationStep = {
  key: "credentials" | "api" | "transport" | "inbound" | "outbound" | "delivery";
  label: string;
  state: CommunicationActivationState;
  detail: string;
  at: string | null;
};

export type CommunicationActivationChannel = {
  key: "FACEBOOK" | "INSTAGRAM" | "OLX";
  label: string;
  provider: "META" | "OLX";
  ready: boolean;
  nextAction: string | null;
  steps: CommunicationActivationStep[];
};

export type CommunicationActivationSignals = {
  key: CommunicationActivationChannel["key"];
  label: string;
  provider: CommunicationActivationChannel["provider"];
  configured: boolean;
  apiConnected: boolean;
  apiAt?: string | null;
  apiError?: string | null;
  transportLabel: "Webhook" | "OAuth";
  transportReady: boolean;
  transportAt?: string | null;
  transportError?: string | null;
  inboundAt?: string | null;
  outboundAcceptedAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  failedAt?: string | null;
};

function time(value?: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function step(
  key: CommunicationActivationStep["key"],
  label: string,
  state: CommunicationActivationState,
  detail: string,
  at?: string | null,
): CommunicationActivationStep {
  return { key, label, state, detail, at: at || null };
}

export function buildCommunicationActivationDiagnostic(signals: CommunicationActivationSignals): CommunicationActivationChannel {
  const credentials = signals.configured
    ? step("credentials", "Доступи", "OK", "Доступи збережені в CRM.")
    : step("credentials", "Доступи", "WAITING", "Внесіть доступи інтеграції у Налаштуваннях.");

  const api = !signals.configured
    ? step("api", "API", "WAITING", "Спочатку потрібні доступи.")
    : signals.apiConnected
      ? step("api", "API", "OK", "API-з'єднання підтверджено.", signals.apiAt)
      : signals.apiError
        ? step("api", "API", "ERROR", signals.apiError, signals.apiAt)
        : step("api", "API", "WAITING", "Запустіть перевірку з'єднання після збереження доступів.", signals.apiAt);

  const transport = !signals.configured
    ? step("transport", signals.transportLabel, "WAITING", `Спочатку потрібні доступи для ${signals.transportLabel}.`)
    : signals.transportReady
      ? step("transport", signals.transportLabel, "OK", `${signals.transportLabel} активний.`, signals.transportAt)
      : signals.transportError
        ? step("transport", signals.transportLabel, "ERROR", signals.transportError, signals.transportAt)
        : step(
            "transport",
            signals.transportLabel,
            "WAITING",
            signals.transportLabel === "Webhook"
              ? "Webhook налаштований; очікуємо першу реальну подію провайдера."
              : "Завершіть OAuth-авторизацію та першу успішну синхронізацію.",
            signals.transportAt,
          );

  const inbound = signals.inboundAt
    ? step("inbound", "Вхідне", "OK", "CRM отримала реальне вхідне повідомлення.", signals.inboundAt)
    : step(
        "inbound",
        "Вхідне",
        "WAITING",
        signals.transportReady ? "Надішліть тестове повідомлення у цей канал." : "Буде перевірено після активації каналу.",
      );

  const latestFailed = time(signals.failedAt);
  const latestAccepted = time(signals.outboundAcceptedAt);
  const outboundFailureIsLatest = latestFailed > 0 && latestFailed >= latestAccepted;
  const outbound = outboundFailureIsLatest
    ? step("outbound", "Вихідне", "ERROR", "Остання спроба відправлення завершилась помилкою.", signals.failedAt)
    : signals.outboundAcceptedAt
      ? step("outbound", "Вихідне", "OK", "Провайдер прийняв вихідне повідомлення.", signals.outboundAcceptedAt)
      : step("outbound", "Вихідне", "WAITING", signals.inboundAt ? "Відправте тестову відповідь із CRM." : "Буде перевірено після першого вхідного повідомлення.");

  const delivery = signals.readAt
    ? step("delivery", "Delivered / Read", "OK", "Одержувач прочитав повідомлення.", signals.readAt)
    : signals.deliveredAt
      ? step("delivery", "Delivered / Read", "OK", "Повідомлення доставлено одержувачу.", signals.deliveredAt)
      : outboundFailureIsLatest
        ? step("delivery", "Delivered / Read", "ERROR", "Доставку неможливо підтвердити: вихідне повідомлення не відправлено.", signals.failedAt)
        : signals.outboundAcceptedAt
          ? step("delivery", "Delivered / Read", "WAITING", "Повідомлення надіслано; очікуємо delivery/read event.", signals.outboundAcceptedAt)
          : step("delivery", "Delivered / Read", "WAITING", "Буде перевірено після вихідного повідомлення.");

  const steps = [credentials, api, transport, inbound, outbound, delivery];
  const blocker = steps.find((item) => item.state !== "OK") || null;
  return {
    key: signals.key,
    label: signals.label,
    provider: signals.provider,
    ready: !blocker,
    nextAction: blocker?.detail || null,
    steps,
  };
}

export function buildCommunicationActivationDiagnostics(signals: CommunicationActivationSignals[]) {
  return signals.map(buildCommunicationActivationDiagnostic);
}
