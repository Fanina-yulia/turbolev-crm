import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { renderWorkOrderInvoicePdf, type WorkOrderInvoicePdfData } from "../src/services/work-order-invoice-pdf-renderer";

const data: WorkOrderInvoicePdfData = {
  vehicleLabel: "Citroen C3",
  vin: "VF7SXHNVTKT682038",
  date: "2026-08-05T12:00:00.000Z",
  parts: [
    { type: "PART", article: "113-1451X", brand: "QUICK BRAKE", description: "Направляюча переднього супорта Opel Astra J/Chevrolet Aveo 09- (Brembo/Lucas)", quantity: 1, unitPrice: 523, total: 523 },
    { type: "PART", article: "181513", brand: "ICER", description: "Колодки гальмівні передні Toyota Corolla 2001-2014", quantity: 1, unitPrice: 786, total: 786 },
    { type: "PART", article: "818 0243 10", brand: "FAG", description: "Тяга переднього стабілізатора Citroen C4/C5/Berlingo/Peugeot 307", quantity: 1, unitPrice: 558, total: 558 },
    { type: "PART", article: "181233-701", brand: "ICER", description: "Колодки гальмівні передні Mercedes-Benz A-Class W168 1997-2004, з датчиками", quantity: 1, unitPrice: 1204, total: 1204 },
    { type: "PART", article: "738128", brand: "FRENKIT", description: "Ремкомплект заднього супорта Mercedes-Benz Vito W639, d=38 мм, Bosch", quantity: 2, unitPrice: 1041, total: 2082 },
    { type: "PART", article: "208024", brand: "SOLGY", description: "Диск гальмівний задній Citroen Berlingo/Peugeot Partner 2008-, 268x12, з ABS", quantity: 2, unitPrice: 2817, total: 5634 },
  ],
  works: [
    { type: "LABOR", description: "Обслуговування направляючих переднього супорта", quantity: 1, unitPrice: 600, total: 600 },
    { type: "LABOR", description: "Заміна передніх гальмівних колодок", quantity: 1, unitPrice: 1200, total: 1200 },
    { type: "LABOR", description: "Заміна передньої тяги стабілізатора", quantity: 1, unitPrice: 600, total: 600 },
    { type: "LABOR", description: "Ремонт задніх гальмівних супортів", quantity: 2, unitPrice: 1200, total: 2400 },
    { type: "LABOR", description: "Заміна задніх гальмівних дисків", quantity: 1, unitPrice: 1200, total: 1200 },
  ],
};

const bytes = await renderWorkOrderInvoicePdf(data);
assert.equal(Buffer.from(bytes).subarray(0, 5).toString("ascii"), "%PDF-", "Invoice renderer must produce a PDF binary");
const document = await PDFDocument.load(bytes);
assert.ok(document.getPageCount() >= 1, "Invoice PDF must contain at least one page");
assert.deepEqual(document.getPage(0).getSize(), { width: 595.28, height: 841.89 }, "Invoice PDF must be A4 portrait");
if (process.env.PDF_INVOICE_SMOKE_OUTPUT) await writeFile(process.env.PDF_INVOICE_SMOKE_OUTPUT, bytes);
console.log(`[work-order-invoice-pdf-renderer] OK — ${bytes.byteLength} bytes, ${document.getPageCount()} page(s).`);
