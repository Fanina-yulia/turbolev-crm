import { getDocumentTemplates } from "@/src/services/document-template.service";
import { getWorkOrderDocumentPackage } from "@/src/services/work-order-document-package.service";
import { buildWorkOrderInvoicePdfData } from "@/src/services/work-order-invoice-pdf.service";
import { renderWorkOrderInvoicePdf } from "@/src/services/work-order-invoice-pdf-renderer";

function safeFileName(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9а-яА-ЯіІїЇєЄґҐ._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${normalized || "commercial-proposal"}.pdf`;
}

export async function renderCommercialProposalPdfForWorkOrder(workOrderId: string) {
  const [packageData, documentTemplates] = await Promise.all([
    getWorkOrderDocumentPackage(workOrderId),
    getDocumentTemplates(),
  ]);
  const template = documentTemplates.templates.find((item) => item.type === "COMMERCIAL_PROPOSAL" && item.status === "PUBLISHED");
  const data = buildWorkOrderInvoicePdfData(packageData);
  const bytes = await renderWorkOrderInvoicePdf({
    ...data,
    documentKind: "COMMERCIAL_PROPOSAL",
    maskArticles: true,
    template,
    warning: "Ціни наведені для погодження ремонту. Остаточна сумісність кожної деталі перевіряється за VIN автомобіля перед установленням.",
  });

  return {
    bytes,
    fileName: safeFileName(`komertsiyna-propozytsiya-${packageData.workOrder.displayNumber}-${data.vehicleLabel}`),
  };
}
