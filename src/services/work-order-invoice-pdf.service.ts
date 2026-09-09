import { getWorkOrderDocumentPackage } from "@/src/services/work-order-document-package.service";
import { renderWorkOrderInvoicePdf, type WorkOrderInvoicePdfData } from "@/src/services/work-order-invoice-pdf-renderer";

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function safeFileName(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9а-яА-ЯіІїЇєЄґҐ._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${normalized || "nakladna"}.pdf`;
}

export async function renderWorkOrderInvoicePdfForWorkOrder(workOrderId: string) {
  const packageData = await getWorkOrderDocumentPackage(workOrderId);
  const data = buildWorkOrderInvoicePdfData(packageData);
  const bytes = await renderWorkOrderInvoicePdf(data);
  return {
    bytes,
    fileName: safeFileName(`nakladna-${packageData.workOrder.displayNumber}-${data.vehicleLabel}`),
  };
}

export function buildWorkOrderInvoicePdfData(packageData: Awaited<ReturnType<typeof getWorkOrderDocumentPackage>>) {
  const lines = packageData.documents.invoice.lines;
  return {
    vehicleId: packageData.workOrder.vehicle.id,
    vehicleLabel: vehicleLabel(packageData.workOrder.vehicle),
    vin: packageData.workOrder.vehicle.vin,
    date: packageData.generatedAt,
    parts: lines.filter((line) => line.type === "PART"),
    works: lines.filter((line) => line.type !== "PART"),
    stationName: packageData.workOrder.station?.id || null,
    warning: "Увага: накладну сформовано за наданим кошиком. Перед установленням необхідно окремо перевірити сумісність кожної деталі з VIN автомобіля.",
  } satisfies WorkOrderInvoicePdfData;
}
