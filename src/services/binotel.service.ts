import { PRIMARY_BINOTEL_PBX_NUMBER } from "@/src/domain/binotel-config";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";

export type BinotelJson = Record<string, unknown>;

export interface BinotelApiResponse extends BinotelJson {
  status?: string;
  code?: string | number;
  message?: string;
}

export interface SendCallInput {
  internalNumber: string;
  externalNumber: string;
  async?: boolean;
}

export interface HistoryPeriodInput {
  startTime: number;
  stopTime: number;
}

export interface MediaFileLinkResult {
  url: string | null;
  raw: BinotelApiResponse;
}

export type BinotelServiceConfig = {
  apiKey: string;
  apiSecret: string;
  companyId?: string;
  apiBaseUrl?: string;
  apiVersion?: string;
  requestTimeoutMs?: number;
  wsKey?: string;
  wsSecret?: string;
  wsUrl?: string;
};

export class BinotelConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinotelConfigurationError";
  }
}

export class BinotelApiError extends Error {
  readonly statusCode: number;
  readonly response: unknown;

  constructor(message: string, statusCode: number, response: unknown) {
    super(message);
    this.name = "BinotelApiError";
    this.statusCode = statusCode;
    this.response = response;
  }
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new BinotelConfigurationError(`Missing Binotel setting: ${name}`);
  return normalized;
}

function normalizePhone(value: string): string {
  return value.trim().replace(/[^\d+]/g, "");
}

function positiveUnix(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be a unix timestamp`);
  return Math.floor(value);
}

function findFirstHttpUrl(value: unknown): string | null {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findFirstHttpUrl(item);
      if (url) return url;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const url = findFirstHttpUrl(nested);
      if (url) return url;
    }
  }
  return null;
}

export class BinotelService {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;
  private readonly requestTimeoutMs: number;
  private readonly wsKey?: string;
  private readonly wsSecret?: string;
  private readonly wsUrl: string;

  readonly companyId: string | undefined;

  constructor(config: BinotelServiceConfig) {
    this.apiKey = required(config.apiKey, "API key");
    this.apiSecret = required(config.apiSecret, "API secret");
    this.companyId = config.companyId?.trim() || undefined;
    this.apiBaseUrl = (config.apiBaseUrl || process.env.BINOTEL_API_BASE_URL || "https://api.binotel.com/api").replace(/\/$/, "");
    this.apiVersion = config.apiVersion?.trim() || process.env.BINOTEL_API_VERSION?.trim() || "4.0";
    this.requestTimeoutMs = config.requestTimeoutMs || Number(process.env.BINOTEL_API_TIMEOUT_MS || 10_000);
    this.wsKey = config.wsKey?.trim() || undefined;
    this.wsSecret = config.wsSecret?.trim() || undefined;
    this.wsUrl = config.wsUrl?.trim() || process.env.BINOTEL_WS_URL?.trim() || "wss://ws.binotel.com:9002";
  }

  private async request<T extends BinotelApiResponse>(method: string, params: BinotelJson = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const payload = { ...params, key: this.apiKey, secret: this.apiSecret };
    const url = `${this.apiBaseUrl}/${this.apiVersion}/${method}.json`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await response.text();
      let parsed: T;
      try { parsed = JSON.parse(text) as T; }
      catch { throw new BinotelApiError("Binotel returned a non-JSON response", response.status, text.slice(0, 500)); }
      if (!response.ok || parsed.status === "error") {
        throw new BinotelApiError(parsed.message || `Binotel request failed with HTTP ${response.status}`, response.status, parsed);
      }
      return parsed;
    } catch (error) {
      if (error instanceof BinotelApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new BinotelApiError("Binotel request timed out", 504, null);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendCall({ internalNumber, externalNumber, async = true }: SendCallInput) {
    if (!internalNumber.trim()) throw new TypeError("internalNumber is required");
    const normalizedExternalNumber = normalizePhone(externalNumber);
    if (!normalizedExternalNumber) throw new TypeError("externalNumber is required");
    return this.request<BinotelApiResponse>("calls/internal-number-to-external-number", {
      internalNumber: internalNumber.trim(),
      externalNumber: normalizedExternalNumber,
      pbxNumber: PRIMARY_BINOTEL_PBX_NUMBER,
      async,
    });
  }

  async hangupCall(generalCallId: string) {
    const callId = generalCallId.trim();
    if (!callId) throw new TypeError("generalCallId is required");
    return this.request<BinotelApiResponse>("calls/hangup-call", { generalCallID: callId });
  }

  async transferCall(generalCallId: string, targetNumber: string) {
    const callId = generalCallId.trim();
    const target = targetNumber.trim().replace(/\D/g, "");
    if (!callId) throw new TypeError("generalCallId is required");
    if (!target) throw new TypeError("targetNumber is required");
    return this.request<BinotelApiResponse>("calls/attended-call-transfer", {
      generalCallID: callId,
      externalNumber: target,
    });
  }

  async getIncomingCallsForPeriod({ startTime, stopTime }: HistoryPeriodInput) {
    const start = positiveUnix(startTime, "startTime");
    const stop = positiveUnix(stopTime, "stopTime");
    if (stop < start) throw new TypeError("stopTime must be greater than startTime");
    return this.request<BinotelApiResponse>("stats/incoming-calls-for-period", { startTime: start, stopTime: stop });
  }

  async getOutgoingCallsForPeriod({ startTime, stopTime }: HistoryPeriodInput) {
    const start = positiveUnix(startTime, "startTime");
    const stop = positiveUnix(stopTime, "stopTime");
    if (stop < start) throw new TypeError("stopTime must be greater than startTime");
    return this.request<BinotelApiResponse>("stats/outgoing-calls-for-period", { startTime: start, stopTime: stop });
  }

  async getCallDetails(generalCallIds: string[]) {
    const ids = [...new Set(generalCallIds.map((item) => item.trim()).filter(Boolean))];
    if (!ids.length) throw new TypeError("generalCallIds are required");
    return this.request<BinotelApiResponse>("stats/call-details", { generalCallID: ids });
  }

  async getHistoryByExternalNumber(externalNumbers: string[]) {
    const numbers = [...new Set(externalNumbers.map(normalizePhone).filter(Boolean))];
    if (!numbers.length) throw new TypeError("externalNumbers are required");
    return this.request<BinotelApiResponse>("stats/history-by-external-number", { externalNumbers: numbers });
  }

  async getOnlineCalls() {
    return this.request<BinotelApiResponse>("stats/online-calls", {});
  }

  async getMediaFileLink(generalCallId: string): Promise<MediaFileLinkResult> {
    if (!generalCallId.trim()) throw new TypeError("generalCallId is required");
    const raw = await this.request<BinotelApiResponse>("stats/call-record", { generalCallID: generalCallId.trim() });
    return { url: findFirstHttpUrl(raw), raw };
  }

  async testConnection() {
    return this.request<BinotelApiResponse>("settings/list-of-employees", {});
  }

  getWebSocketCredentials() {
    return {
      key: required(this.wsKey, "WebSocket key"),
      secret: required(this.wsSecret, "WebSocket secret"),
      url: this.wsUrl,
    };
  }
}

async function configuredService() {
  const stored = await getIntegrationCredential("BINOTEL");
  return new BinotelService({
    apiKey: stored?.apiKey || process.env.BINOTEL_API_KEY || "",
    apiSecret: stored?.apiSecret || process.env.BINOTEL_API_SECRET || "",
    companyId: stored?.companyId || process.env.BINOTEL_COMPANY_ID,
    apiBaseUrl: process.env.BINOTEL_API_BASE_URL,
    apiVersion: process.env.BINOTEL_API_VERSION,
    requestTimeoutMs: Number(process.env.BINOTEL_API_TIMEOUT_MS || 10_000),
    wsKey: stored?.wsKey || process.env.BINOTEL_WS_KEY,
    wsSecret: stored?.wsSecret || process.env.BINOTEL_WS_SECRET,
    wsUrl: process.env.BINOTEL_WS_URL,
  });
}

const lazyBinotelService = {
  async sendCall(input: SendCallInput) {
    return (await configuredService()).sendCall(input);
  },
  async hangupCall(generalCallId: string) {
    return (await configuredService()).hangupCall(generalCallId);
  },
  async transferCall(generalCallId: string, targetNumber: string) {
    return (await configuredService()).transferCall(generalCallId, targetNumber);
  },
  async getIncomingCallsForPeriod(input: HistoryPeriodInput) {
    return (await configuredService()).getIncomingCallsForPeriod(input);
  },
  async getOutgoingCallsForPeriod(input: HistoryPeriodInput) {
    return (await configuredService()).getOutgoingCallsForPeriod(input);
  },
  async getCallDetails(generalCallIds: string[]) {
    return (await configuredService()).getCallDetails(generalCallIds);
  },
  async getHistoryByExternalNumber(externalNumbers: string[]) {
    return (await configuredService()).getHistoryByExternalNumber(externalNumbers);
  },
  async getOnlineCalls() {
    return (await configuredService()).getOnlineCalls();
  },
  async getMediaFileLink(generalCallId: string) {
    return (await configuredService()).getMediaFileLink(generalCallId);
  },
  async testConnection() {
    return (await configuredService()).testConnection();
  },
  async getWebSocketCredentials() {
    return (await configuredService()).getWebSocketCredentials();
  },
};

export function getBinotelService() {
  return lazyBinotelService;
}
