import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { renderDiagnosticCardPdf, type DiagnosticCardPdfMedia } from "../src/services/diagnostic-card-pdf-renderer";
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
  counts: { total: 2, checked: 2, ok: 1, attention: 0, defect: 1, critical: 1 },
  technicalConclusion: "Потрібна заміна переднього амортизатора.",
  mechanicComment: "Фото додано під час огляду.",
  managerComment: null,
  recommendations: { works: [{ findingId: "finding", name: "Заміна амортизатора", action: "REPLACE", urgency: "CRITICAL", section: "Підвіска", checkName: "Амортизатор" }], parts: [{ findingId: "finding", name: "Амортизатор передній", action: "REPLACE", urgency: "CRITICAL", section: "Підвіска", checkName: "Амортизатор" }] },
  inspections: [{ name: "Базовий огляд", sections: [{ name: "Підвіска", items: [{ checkId: "check-ok", name: "Сайлентблок", position: "Передня вісь", state: "OK", measurementValue: null, measurementText: null, measurementUnit: null, note: null, finding: null }, { checkId: "check-defect", name: "Амортизатор", position: "Передня вісь", state: "DEFECT", measurementValue: "25", measurementText: null, measurementUnit: "%", note: "Є підтікання", finding: { id: "finding", action: "REPLACE", urgency: "CRITICAL", text: "Підтікання корпусу", suggestedWorkName: "Заміна амортизатора", suggestedPartName: "Амортизатор передній", mediaIds: [] } }] }] }],
};

const media: DiagnosticCardPdfMedia[] = [
  { id: "smoke-media", fileName: "turbo-lev-plate-standard.jpg", mimeType: "image/jpeg", fileData: await readFile("public/brand/turbo-lev-plate-standard.jpg") },
  { id: "broken-media", fileName: "broken-photo.png", mimeType: "image/png", fileData: new Uint8Array([0, 1, 2, 3]) },
];
snapshot.inspections[0].sections[0].items[1].finding!.mediaIds = ["smoke-media"];
snapshot.inspections[0].sections[0].items[1].finding!.mediaIds.push("broken-media");
const bytes = await renderDiagnosticCardPdf(snapshot, media);
assert.equal(Buffer.from(bytes).subarray(0, 5).toString("ascii"), "%PDF-", "Renderer must produce a PDF binary");
const document = await PDFDocument.load(bytes);
assert.ok(document.getPageCount() >= 1, "PDF must contain at least one page");
if (process.env.PDF_SMOKE_OUTPUT) await writeFile(process.env.PDF_SMOKE_OUTPUT, bytes);
console.log(`[diagnostic-card-pdf-renderer] OK — ${bytes.byteLength} bytes, ${document.getPageCount()} page(s).`);
