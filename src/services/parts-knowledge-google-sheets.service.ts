import "server-only";

import { createSign } from "node:crypto";

export const PARTS_KNOWLEDGE_SHEET_TABS = [
  "Parts",
  "Aliases",
  "Provider Terms",
  "Relations",
  "Operations",
  "Photos",
  "Unrecognized Terms",
  "Diagnostic Mappings",
  "Canonical Parts",
  "OEM Crosses",
  "Vehicle Fitment",
  "Related Parts",
  "Repair Kits",
  "Part Operations",
  "Rejected Matches",
  "Change Log",
  "Search Feedback",
] as const;

export type PartsKnowledgeSheetTab = (typeof PARTS_KNOWLEDGE_SHEET_TABS)[number];
export type PartsKnowledgeSheetRow = Record<string, string>;

export type GoogleSheetsKnowledgeConfig = {
  spreadsheetId: string | null;
  configured: boolean;
  mode: "SERVICE_ACCOUNT" | "ACCESS_TOKEN" | "NOT_CONFIGURED";
  reason: string | null;
};

export type PartsKnowledgeSheetTables = {
  spreadsheetId: string;
  tables: Partial<Record<PartsKnowledgeSheetTab, PartsKnowledgeSheetRow[]>>;
  missingTabs: string[];
  errors: Array<{ tab: string; message: string }>;
};

type GoogleServiceAccount = {
  client_email?: unknown;
  private_key?: unknown;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function spreadsheetIdFromEnv() {
  const raw = text(process.env.GOOGLE_SHEETS_PARTS_KNOWLEDGE_SPREADSHEET_ID, 300);
  if (!raw) return "";
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/u);
  return match?.[1] || raw;
}

export function getGoogleSheetsKnowledgeConfig(): GoogleSheetsKnowledgeConfig {
  const spreadsheetId = spreadsheetIdFromEnv();
  if (!spreadsheetId) {
    return {
      spreadsheetId: null,
      configured: false,
      mode: "NOT_CONFIGURED",
      reason: "Не задано GOOGLE_SHEETS_PARTS_KNOWLEDGE_SPREADSHEET_ID.",
    };
  }
  if (text(process.env.GOOGLE_SHEETS_ACCESS_TOKEN, 4000)) {
    return { spreadsheetId, configured: true, mode: "ACCESS_TOKEN", reason: null };
  }
  if (text(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON, 12000)) {
    return { spreadsheetId, configured: true, mode: "SERVICE_ACCOUNT", reason: null };
  }
  return {
    spreadsheetId,
    configured: false,
    mode: "NOT_CONFIGURED",
    reason: "Потрібен GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON або тимчасовий GOOGLE_SHEETS_ACCESS_TOKEN.",
  };
}

function base64Url(value: string | Uint8Array) {
  const encoded = typeof value === "string"
    ? Buffer.from(value, "utf8").toString("base64")
    : Buffer.from(value).toString("base64");
  return encoded.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function getGoogleSheetsAccessToken() {
  const config = getGoogleSheetsKnowledgeConfig();
  if (!config.configured || !config.spreadsheetId) throw new Error(config.reason || "Google Sheets не налаштований.");

  const explicitToken = text(process.env.GOOGLE_SHEETS_ACCESS_TOKEN, 4000);
  if (explicitToken) return explicitToken;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  let credentials: GoogleServiceAccount;
  try {
    credentials = JSON.parse(text(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON, 12000)) as GoogleServiceAccount;
  } catch {
    throw new Error("GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON має бути коректним JSON.");
  }
  const email = text(credentials.client_email, 320);
  const privateKey = text(credentials.private_key, 12000).replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("У service account відсутні client_email або private_key.");

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + claim;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = unsigned + "." + base64Url(signer.sign(privateKey));

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Google OAuth token HTTP " + response.status);
  const payload = await response.json() as { access_token?: unknown; expires_in?: unknown };
  const token = text(payload.access_token, 4000);
  if (!token) throw new Error("Google OAuth не повернув access_token.");
  const expiresIn = Number(payload.expires_in);
  cachedToken = {
    value: token,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 3_000_000),
  };
  return token;
}

function sheetRange(tab: string) {
  const escaped = tab.replace(/'/g, "''");
  return "'" + escaped + "'!A1:Z10000";
}

function normalizeHeader(value: unknown) {
  return text(value, 120)
    .replace(/^\uFEFF/u, "")
    .toLocaleLowerCase("uk-UA")
    .replace(/[^a-zа-яіїєґ0-9]+/giu, "_")
    .replace(/^_+|_+$/g, "");
}

function stringifyCell(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

async function readTab(tab: PartsKnowledgeSheetTab, accessToken: string, spreadsheetId: string): Promise<PartsKnowledgeSheetRow[]> {
  const url = "https://sheets.googleapis.com/v4/spreadsheets/"
    + encodeURIComponent(spreadsheetId)
    + "/values/"
    + encodeURIComponent(sheetRange(tab))
    + "?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE";
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: "Bearer " + accessToken },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Google Sheets tab «" + tab + "» HTTP " + response.status + (detail ? ": " + detail.slice(0, 180) : ""));
  }
  const payload = await response.json() as { values?: unknown };
  const values = Array.isArray(payload.values) ? payload.values : [];
  const headerRow = Array.isArray(values[0]) ? values[0].map(normalizeHeader) : [];
  if (!headerRow.some(Boolean)) return [];

  return values.slice(1).flatMap((rawRow) => {
    if (!Array.isArray(rawRow)) return [];
    const row: PartsKnowledgeSheetRow = {};
    headerRow.forEach((header, index) => {
      if (header) row[header] = stringifyCell(rawRow[index]);
    });
    return Object.values(row).some(Boolean) ? [row] : [];
  });
}

export async function readPartsKnowledgeSheets(): Promise<PartsKnowledgeSheetTables> {
  const config = getGoogleSheetsKnowledgeConfig();
  if (!config.configured || !config.spreadsheetId) throw new Error(config.reason || "Google Sheets не налаштований.");
  const token = await getGoogleSheetsAccessToken();
  const results = await Promise.all(PARTS_KNOWLEDGE_SHEET_TABS.map(async (tab) => {
    try {
      return { tab, rows: await readTab(tab, token, config.spreadsheetId!), error: null };
    } catch (error) {
      return {
        tab,
        rows: [] as PartsKnowledgeSheetRow[],
        error: error instanceof Error ? error.message : "Невідома помилка читання вкладки.",
      };
    }
  }));

  return {
    spreadsheetId: config.spreadsheetId,
    tables: Object.fromEntries(results.filter((result) => !result.error).map((result) => [result.tab, result.rows])) as Partial<Record<PartsKnowledgeSheetTab, PartsKnowledgeSheetRow[]>>,
    missingTabs: results.filter((result) => result.error).map((result) => result.tab),
    errors: results.filter((result) => result.error).map((result) => ({ tab: result.tab, message: result.error! })),
  };
}
