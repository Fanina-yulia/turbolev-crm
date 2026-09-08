import "server-only";

import {
  getGoogleSheetsAccessToken,
  getGoogleSheetsKnowledgeConfig,
  type PartsKnowledgeSheetRow,
  type PartsKnowledgeSheetTab,
} from "@/src/services/parts-knowledge-google-sheets.service";
import { normalizePartTerminology } from "@/src/services/parts-terminology.service";

export type PartsKnowledgeSheetWrite = {
  tab: PartsKnowledgeSheetTab;
  matchBy: string[];
  row: PartsKnowledgeSheetRow;
};

export type PartsKnowledgeGoogleSheetsWriteResult = {
  spreadsheetId: string;
  updated: number;
  appended: number;
  tabs: Array<{ tab: PartsKnowledgeSheetTab; updated: number; appended: number }>;
};

const TAB_HEADERS: Record<PartsKnowledgeSheetTab, string[]> = {
  Parts: ["code", "name", "slug", "status", "category", "source", "source_version"],
  Aliases: ["generic_code", "alias", "alias_type", "language", "provider", "axis", "side", "sub_position", "confidence", "status", "source", "source_version"],
  "Provider Terms": ["generic_code", "provider", "term", "language", "axis", "side", "sub_position", "confidence", "status", "source", "source_version"],
  Relations: ["from_code", "to_code", "relation_type", "confidence", "status", "source", "source_version", "notes"],
  Operations: ["generic_code", "operation_code", "operation_name", "service_code", "position_rule", "norm_minutes", "default_quantity", "status", "source", "source_version", "notes"],
  Photos: ["generic_code", "media_type", "url", "storage_key", "rights", "status", "alt_text", "sort_order", "content_hash", "source"],
  "Unrecognized Terms": ["raw_term", "normalized_term", "suggested_code", "status", "source", "diagnostic_finding_id", "metadata_json"],
};

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeTab(tab: string) {
  return "'" + tab.replace(/'/g, "''") + "'";
}

function columnLetter(columnNumber: number) {
  let number = Math.max(1, Math.floor(columnNumber));
  let result = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function cellValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return text(value, 1000);
}

function normalizeHeader(value: unknown) {
  return text(value, 120)
    .replace(/^\uFEFF/u, "")
    .toLocaleLowerCase("uk-UA")
    .replace(/[^a-zа-яіїєґ0-9]+/giu, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeMatchValue(key: string, value: unknown) {
  const raw = cellValue(value);
  if (!raw) return "";
  if (key === "alias" || key === "term" || key === "name") {
    return normalizePartTerminology(raw);
  }
  return raw.toLocaleLowerCase("uk-UA").replace(/\s+/g, " ").trim();
}

function sheetRange(tab: PartsKnowledgeSheetTab) {
  return escapeTab(tab) + "!A1:Z10000";
}

function valuesRange(tab: PartsKnowledgeSheetTab, rowNumber: number, columnCount: number) {
  return escapeTab(tab) + "!A" + rowNumber + ":" + columnLetter(columnCount) + rowNumber;
}

async function googleFetch(
  spreadsheetId: string,
  accessToken: string,
  urlPath: string,
  init: RequestInit,
) {
  const response = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(spreadsheetId) + urlPath,
    {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + accessToken,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      "Google Sheets API HTTP " + response.status + (detail ? ": " + detail.slice(0, 240) : ""),
    );
  }
  return response;
}

async function readTabValues(
  tab: PartsKnowledgeSheetTab,
  spreadsheetId: string,
  accessToken: string,
) {
  const response = await googleFetch(
    spreadsheetId,
    accessToken,
    "/values/" + encodeURIComponent(sheetRange(tab))
      + "?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE",
    { method: "GET" },
  );
  const payload = await response.json() as { values?: unknown };
  return Array.isArray(payload.values) ? payload.values.filter(Array.isArray) as unknown[][] : [];
}

function rowMatches(
  row: PartsKnowledgeSheetRow,
  candidate: PartsKnowledgeSheetRow,
  matchBy: string[],
) {
  return matchBy.every((key) => normalizeMatchValue(key, row[key]) === normalizeMatchValue(key, candidate[key]));
}

function outputValues(tab: PartsKnowledgeSheetTab, row: PartsKnowledgeSheetRow) {
  return TAB_HEADERS[tab].map((header) => cellValue(row[header]));
}

async function writeTab(
  tab: PartsKnowledgeSheetTab,
  writes: PartsKnowledgeSheetWrite[],
  spreadsheetId: string,
  accessToken: string,
) {
  const headers = TAB_HEADERS[tab];
  const values = await readTabValues(tab, spreadsheetId, accessToken);
  const headerRow = Array.isArray(values[0]) ? values[0].map(normalizeHeader) : [];
  const existingRows: PartsKnowledgeSheetRow[] = values.slice(1).map((rawRow) => {
    const row: PartsKnowledgeSheetRow = {};
    headerRow.forEach((header, index) => {
      if (header) row[header] = cellValue(rawRow[index]);
    });
    return row;
  });

  const updates: Array<{ range: string; majorDimension: "ROWS"; values: string[][] }> = [];
  const appendRows: string[][] = [];
  let updated = 0;
  let appended = 0;

  for (const write of writes) {
    const existingIndex = existingRows.findIndex((row) => rowMatches(row, write.row, write.matchBy));
    const rowValues = outputValues(tab, write.row);
    if (existingIndex >= 0) {
      const sheetRow = existingIndex + 2;
      updates.push({
        range: valuesRange(tab, sheetRow, headers.length),
        majorDimension: "ROWS",
        values: [rowValues],
      });
      existingRows[existingIndex] = write.row;
      updated += 1;
    } else {
      appendRows.push(rowValues);
      existingRows.push(write.row);
      appended += 1;
    }
  }

  if (updates.length) {
    await googleFetch(
      spreadsheetId,
      accessToken,
      "/values:batchUpdate",
      {
        method: "POST",
        body: JSON.stringify({
          valueInputOption: "RAW",
          data: updates,
        }),
      },
    );
  }

  if (appendRows.length) {
    await googleFetch(
      spreadsheetId,
      accessToken,
      "/values/" + encodeURIComponent(escapeTab(tab) + "!A:" + columnLetter(headers.length))
        + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=false",
      {
        method: "POST",
        body: JSON.stringify({
          majorDimension: "ROWS",
          values: appendRows,
        }),
      },
    );
  }

  return { tab, updated, appended };
}

export async function writePartsKnowledgeToGoogleSheets(
  writes: PartsKnowledgeSheetWrite[],
): Promise<PartsKnowledgeGoogleSheetsWriteResult> {
  const config = getGoogleSheetsKnowledgeConfig();
  if (!config.configured || !config.spreadsheetId) {
    throw new Error(config.reason || "Google Sheets не налаштований.");
  }
  if (!writes.length) {
    return { spreadsheetId: config.spreadsheetId, updated: 0, appended: 0, tabs: [] };
  }

  const accessToken = await getGoogleSheetsAccessToken();
  const grouped = new Map<PartsKnowledgeSheetTab, PartsKnowledgeSheetWrite[]>();
  for (const write of writes) {
    const current = grouped.get(write.tab) || [];
    current.push(write);
    grouped.set(write.tab, current);
  }

  const tabResults = await Promise.all(
    [...grouped.entries()].map(([tab, tabWrites]) => writeTab(tab, tabWrites, config.spreadsheetId!, accessToken)),
  );

  return {
    spreadsheetId: config.spreadsheetId,
    updated: tabResults.reduce((sum, item) => sum + item.updated, 0),
    appended: tabResults.reduce((sum, item) => sum + item.appended, 0),
    tabs: tabResults,
  };
}
