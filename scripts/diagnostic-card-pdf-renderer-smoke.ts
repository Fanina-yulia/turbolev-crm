import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { renderDiagnosticCardPdf } from "../src/services/diagnostic-card-pdf-renderer";
import { DIAGNOSTIC_CARD_PREVIEW_LAYOUT } from "../src/document-layout/diagnostic-card-reference";
import type { DiagnosticCardSnapshot } from "../src/services/diagnostic-card.service";

const snapshot: DiagnosticCardSnapshot = {
  version: 1,
  cardNumber: "ДК-2026-000001",
  diagnosticRequestId: "smoke-diagnostic",
  revisionKind: "REVIEW",
  generatedAt: "2026-09-05T12:00:00.000Z",
  vehicle: { id: "vehicle", label: "GEELY EMGRAND X7 2014", brand: "GEELY", model: "EMGRAND X7", year: 2014, plateNumber: "AE 0914 MH", vin: "Y7WNL1M18E0029926", mileageKm: 134000 },
  visit: { appointmentId: null, plannedStartAt: null, plannedEndAt: null, actualArrivalAt: null, actualStartAt: "2026-09-05T11:00:00.000Z", actualEndAt: "2026-09-05T12:00:00.000Z", locationId: "station", postId: "1", mechanicId: "mechanic", problem: "Перевірити ходову", source: "SMOKE" },
  client: { id: "client", name: "Юрій Власник", phone: "+380673292456" },
  problem: "Перевірити ходову",
  station: { id: "station", name: "Turbo LEV" },
  mechanic: { id: "mechanic", name: "Микола Карабан" },
  reviewer: { id: null, name: null },
  counts: { total: 119, checked: 107, ok: 95, attention: 0, defect: 12, critical: 0 },
  technicalConclusion: "Цей технічний текст не повинен потрапляти до клієнтської PDF-карти.",
  mechanicComment: "Внутрішній коментар механіка не повинен потрапляти до PDF.",
  managerComment: null,
  recommendations: {
    works: [{ findingId: "finding", name: "Заміна амортизатора", action: "REPLACE", urgency: "CRITICAL", section: "Підвіска", checkName: "Амортизатор" }],
    parts: [
      { findingId: "finding-1", name: "Передні гальмівні колодки", action: "REPLACE", urgency: "ATTENTION", section: "Передні гальма", checkName: "Колодки" },
      { findingId: "finding-2", name: "Передній гальмівний диск", action: "REPLACE", urgency: "ATTENTION", section: "Передні гальма", checkName: "Диск" },
      { findingId: "finding-3", name: "Супорт передній", action: "REPLACE", urgency: "ATTENTION", section: "Передні гальма", checkName: "Супорт" },
    ],
  },
  inspections: [{ name: "Базовий огляд", sections: [{ name: "Підвіска", items: [{ checkId: "check-ok", name: "Сайлентблок", position: "Передня вісь", state: "OK", measurementValue: null, measurementText: null, measurementUnit: null, note: null, finding: null }] }] }],
};

assert.equal(DIAGNOSTIC_CARD_PREVIEW_LAYOUT.width, 620, "Canonical layout must stay tied to the approved 620px Settings preview");
assert.equal(DIAGNOSTIC_CARD_PREVIEW_LAYOUT.header.height, 132, "Approved header geometry changed unexpectedly");
assert.deepEqual(
  [DIAGNOSTIC_CARD_PREVIEW_LAYOUT.table.numberWidth, DIAGNOSTIC_CARD_PREVIEW_LAYOUT.table.statusWidth],
  [38, 120],
  "Approved diagnostic table columns changed unexpectedly",
);

const bytes = await renderDiagnosticCardPdf(snapshot);
assert.equal(Buffer.from(bytes).subarray(0, 5).toString("ascii"), "%PDF-", "Renderer must produce a PDF binary");
assert.ok(bytes.byteLength > 60_000, "Diagnostic PDF must contain the approved brand imagery and embedded fonts");
const document = await PDFDocument.load(bytes);
assert.equal(document.getPageCount(), 1, "Compact client diagnostic card should stay on one A4 page for a normal parts list");
const size = document.getPage(0).getSize();
assert.ok(Math.abs(size.width - DIAGNOSTIC_CARD_PREVIEW_LAYOUT.page.pdfWidth) < 0.2, "Diagnostic card must stay A4 width");
assert.ok(Math.abs(size.height - DIAGNOSTIC_CARD_PREVIEW_LAYOUT.page.pdfHeight) < 0.2, "Diagnostic card must stay A4 height");
if (process.env.PDF_SMOKE_OUTPUT) await writeFile(process.env.PDF_SMOKE_OUTPUT, bytes);
console.log(`[diagnostic-card-pdf-renderer] OK — ${bytes.byteLength} bytes, ${document.getPageCount()} page(s), exact Settings-preview geometry.`);
