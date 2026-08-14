import { createHash } from "node:crypto";

export type BinotelJson = Record<string, unknown>;

export interface BinotelApiResponse extends BinotelJson {
  status?: string;
  code?: string | number;
  message?: string;
}

export interface SendCallInput {
  internalNumber: string;
  externalNumber: string;
}

export interface MediaFileLinkResult {
  url: string | null;
  raw: BinotelApiResponse;
}

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

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new BinotelConfigurationError(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizePhone(value: string): string {
  return value.trim().replace(/[^\d+]/g, "");
}

function findFirstHttpUrl(value: unknown): string | null {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findFirstHttpUrl(item);
      if (url) return url;
    }
    return null;
  }

  if (value && typeof value === "object") {
    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      const url = findFirstHttpUrl(nestedValue);
      if (url) return url;
    }
  }

  return null;
}

/**
 * Server-side Binotel REST client.
 *
 * Secrets are read only from process.env and are never returned to the browser.
 * BINOTEL_API_VERSION can be overridden without changing application code.
 */
export class BinotelService {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;
  private readonly requestTimeoutMs: number;

  readonly companyId: string | undefined;

  constructor() {
    this.apiKey = requiredEnv("BINOTEL_API_KEY");
    this.apiSecret = requiredEnv("BINOTEL_API_SECRET");
    this.companyId = process.env.BINOTEL_COMPANY_ID?.trim() || undefined;
    this.apiBaseUrl = (process.env.BINOTEL_API_BASE_URL || "https://api.binotel.com/api").replace(/\/$/, "");
    this.apiVersion = process.env.BINOTEL_API_VERSION?.trim() || "4.0";
    this.requestTimeoutMs = Number(process.env.BINOTEL_API_TIMEOUT_MS || 10_000);
  }

  /**
   * Binotel REST signature: MD5(secret + compact JSON of method parameters).
   * `key` and `signature` are appended after the signature is calculated.
   */
  private createSignature(params: BinotelJson): string {
    const compactJson = JSON.stringify(params);
    return createHash("md5")
      .update(`${this.apiSecret}${compactJson}`, "utf8")
      .digest("hex");
  }

  private async request<T extends BinotelApiResponse>(
    method: string,
    params: BinotelJson = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    const payload = {
      ...params,
      signature: this.createSignature(params),
      key: this.apiKey,
    };

    const url = `${this.apiBaseUrl}/${this.apiVersion}/${method}.json`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
      });

      const text = await response.text();
      let parsed: T;

      try {
        parsed = JSON.parse(text) as T;
      } catch {
        throw new BinotelApiError(
          "Binotel returned a non-JSON response",
          response.status,
          text.slice(0, 500),
        );
      }

      if (!response.ok || parsed.status === "error") {
        throw new BinotelApiError(
          parsed.message || `Binotel request failed with HTTP ${response.status}`,
          response.status,
          parsed,
        );
      }

      return parsed;
    } catch (error) {
      if (error instanceof BinotelApiError) throw error;

      if (error instanceof Error && error.name === "AbortError") {
        throw new BinotelApiError("Binotel request timed out", 504, null);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Click-to-Call: first rings the employee's internal line, then connects
   * the employee to the external customer number.
   */
  async sendCall({ internalNumber, externalNumber }: SendCallInput) {
    if (!internalNumber.trim()) {
      throw new TypeError("internalNumber is required");
    }

    const normalizedExternalNumber = normalizePhone(externalNumber);
    if (!normalizedExternalNumber) {
      throw new TypeError("externalNumber is required");
    }

    return this.request<BinotelApiResponse>(
      "calls/internal-number-to-external-number",
      {
        internalNumber: internalNumber.trim(),
        externalNumber: normalizedExternalNumber,
      },
    );
  }

  /**
   * Requests the temporary media URL for a completed Binotel call recording.
   */
  async getMediaFileLink(generalCallId: string): Promise<MediaFileLinkResult> {
    if (!generalCallId.trim()) {
      throw new TypeError("generalCallId is required");
    }

    const raw = await this.request<BinotelApiResponse>("stats/call-record", {
      generalCallID: generalCallId.trim(),
    });

    return {
      url: findFirstHttpUrl(raw),
      raw,
    };
  }

  getWebSocketCredentials() {
    return {
      key: requiredEnv("BINOTEL_WS_KEY"),
      secret: requiredEnv("BINOTEL_WS_SECRET"),
      url: process.env.BINOTEL_WS_URL?.trim() || "wss://ws.binotel.com:9002",
    };
  }
}

let singleton: BinotelService | undefined;

export function getBinotelService(): BinotelService {
  singleton ??= new BinotelService();
  return singleton;
}
