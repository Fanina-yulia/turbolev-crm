import type { CrmDateTime } from "./crm-core";
import type { PlannerStatusContract } from "./planner";

export type ServiceAdvisorStationReference = {
  id: string;
  name: string;
};

export type ServiceAdvisorKpisContract = {
  today: number;
  arrived: number;
  approval: number;
  waitingParts: number;
  inRepair: number;
  mechanicFindings: number;
};

export type ServiceAdvisorAppointmentContract = {
  id: string;
  status: PlannerStatusContract;
  start: CrmDateTime;
  plate: string;
  vehicle: string;
  problem: string | null;
  post: string | null;
  mechanic: string | null;
};

export type ServiceAdvisorDiagnosticContract = {
  id: string;
  status: "PENDING" | "IN_PROGRESS";
  plate: string;
  vehicle: string;
  client: string;
};

export type ServiceAdvisorFindingUrgency = "INFO" | "SOON" | "CRITICAL";

export type ServiceAdvisorFindingMediaContract = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  url: string;
};

export type ServiceAdvisorFindingContract = {
  id: string;
  workOrderId: string;
  workOrderLineId: string;
  status: string;
  resolutionCode: string | null;
  estimateLineId: string | null;
  urgency: ServiceAdvisorFindingUrgency;
  findingText: string;
  recommendation: string | null;
  managerComment: string | null;
  mechanicReply: string | null;
  mechanicRepliedAt: CrmDateTime | null;
  submittedAt: CrmDateTime;
  reviewedAt: CrmDateTime | null;
  mechanic: string;
  workDescription: string;
  plate: string;
  vehicle: string;
  media: ServiceAdvisorFindingMediaContract[];
};

export type ServiceAdvisorCabinetLinkedPayload = {
  ok: true;
  linked: true;
  station: ServiceAdvisorStationReference;
  kpis: ServiceAdvisorKpisContract;
  appointments: ServiceAdvisorAppointmentContract[];
  diagnostics: ServiceAdvisorDiagnosticContract[];
  mechanicFindings: ServiceAdvisorFindingContract[];
};

export type ServiceAdvisorCabinetUnlinkedPayload = {
  ok: true;
  linked: false;
  reason?: string;
};

export type ServiceAdvisorCabinetPayload = ServiceAdvisorCabinetLinkedPayload | ServiceAdvisorCabinetUnlinkedPayload;
