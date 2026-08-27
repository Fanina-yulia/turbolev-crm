import { createHash } from "node:crypto";
import {
  deriveLegacyInquiryAttributionFieldsV1,
  type PublicLeadAcceptanceDto,
  type PublicLeadRequestV1,
  type PublicLeadTypeV1,
} from "@/src/lib/contracts/integration/v1";
import { ingestCommunicationInquiry } from "@/src/services/communications-server.service";

function subjectForLeadType(type: PublicLeadTypeV1) {
  switch (type) {
    case "PART_SELECTION": return "Підбір запчастин із сайту";
    case "CALLBACK": return "Зворотний дзвінок із сайту";
    case "BOOKING": return "Запит на запис із сайту";
    case "PRODUCT": return "Запит щодо товару із сайту";
    case "SEARCH_NO_RESULT": return "Не знайдено запчастину на сайті";
    case "DIAGNOSTIC": return "Запит після діагностики із сайту";
    case "AI_HANDOFF": return "Передача від AI-помічника";
  }
}

function stableReceiptRef(externalId: string) {
  return `tl_${createHash("sha256").update(`WEBSITE:${externalId}`).digest("hex").slice(0, 24)}`;
}

function initialMessage(input: PublicLeadRequestV1) {
  return input.message || input.aiHandoff?.summary || input.context?.query || subjectForLeadType(input.leadType);
}

function vehicleLabel(input: PublicLeadRequestV1) {
  return input.vehicle?.label || input.vehicle?.plate || undefined;
}

export async function acceptPublicLeadV1(input: {
  request: PublicLeadRequestV1;
  idempotencyKey: string;
  correlationId: string;
}): Promise<PublicLeadAcceptanceDto> {
  const request = input.request;
  const attribution = deriveLegacyInquiryAttributionFieldsV1(request.attribution);
  const externalId = `public:${input.idempotencyKey}`;

  const inquiry = await ingestCommunicationInquiry({
    channel: "WEBSITE",
    externalId,
    externalMessageId: `${externalId}:initial`,
    name: request.contact.name,
    phone: request.contact.phone,
    subject: subjectForLeadType(request.leadType),
    preview: initialMessage(request).slice(0, 500),
    message: initialMessage(request),
    vehicle: vehicleLabel(request),
    plate: request.vehicle?.plate,
    sourceDetail: attribution.sourceDetail,
    campaign: attribution.campaign || undefined,
    utm: attribution.utm || undefined,
    metadata: {
      schemaVersion: "v1",
      publicLead: {
        leadType: request.leadType,
        context: request.context,
        privacy: request.privacy,
        attribution: request.attribution,
        aiHandoff: request.aiHandoff,
        vehicleIdentification: request.vehicle?.vin ? { vin: request.vehicle.vin } : undefined,
        correlationId: input.correlationId,
      },
    },
  });

  return {
    accepted: true,
    status: "ACCEPTED",
    receiptRef: stableReceiptRef(externalId),
    acceptedAt: new Date(inquiry.receivedAt).toISOString(),
  };
}
