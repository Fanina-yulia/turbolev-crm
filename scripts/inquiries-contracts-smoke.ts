import {
  parseInquiriesPayload,
  parseInquiryMutationPayload,
} from "../src/lib/contracts/inquiries-payload.parsers";
import type { InquiriesPayloadContract } from "../src/lib/contracts/inquiries";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const valid = parseInquiriesPayload({
  ok: true,
  items: [
    {
      id: "inq_1",
      channel: "BINOTEL",
      state: "NEW",
      name: "Марія",
      phone: "+380671112233",
      handle: null,
      subject: "Потрібна діагностика",
      preview: "Стук спереду",
      vehicle: "Volvo XC90",
      plate: "AA1234BB",
      receivedAt: "2026-08-20T18:00:00.000Z",
      sourceDetail: "missed-call",
      campaign: null,
      assignedUser: { id: "user_1", name: "Менеджер" },
      priority: "CRITICAL",
      existingClient: { id: "client_1", name: "Марія" },
      vehicles: [
        {
          id: "vehicle_1",
          brand: "Volvo",
          model: "XC90",
          year: 2020,
          plateNumber: "AA1234BB",
          vin: "YV1LFA2BC12345678",
        },
      ],
      existingLead: { id: "lead_1", name: "Марія", status: "NEW", assignedUserId: "user_1" },
    },
  ],
  stats: { total: 1, critical: 1, high: 0, existingClients: 1, withActiveLead: 1 },
});

assert(valid !== null, "valid inquiries payload should parse");
const typed: InquiriesPayloadContract = valid;
assert(typed.items[0].vehicles[0].brand === "Volvo", "canonical vehicle projection should be preserved");
assert(typed.stats.critical === 1, "stats should be preserved");

assert(
  parseInquiriesPayload({
    ok: true,
    items: [{ ...valid.items[0], priority: "URGENT" }],
    stats: valid.stats,
  }) === null,
  "unknown inquiry priority should be rejected",
);

assert(
  parseInquiriesPayload({
    ok: true,
    items: [{ ...valid.items[0], receivedAt: "not-a-date" }],
    stats: valid.stats,
  }) === null,
  "invalid inquiry date should be rejected",
);

assert(parseInquiryMutationPayload({ ok: true, leadId: "lead_2" })?.ok === true, "successful mutation should parse");
assert(parseInquiryMutationPayload({ ok: false, error: "denied" }) === null, "failed mutation should not parse as success");

console.log("Inquiries contracts smoke: OK");
