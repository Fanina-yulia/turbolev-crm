import type { CrmDateTime } from "./crm-core";
import type { PlannerStatusContract } from "./planner";

export type CabinetStationReference = {
  id: string;
  name: string;
};

export type MechanicHomeTaskContract = {
  id: string;
  workOrderId: string;
  description: string;
  status: string;
  type: string;
  laborHours: string | null;
  plate: string;
  vehicle: string;
  workOrderStatus: string;
  updatedAt: CrmDateTime;
};

export type MechanicHomeAppointmentContract = {
  id: string;
  workOrderId: string | null;
  status: PlannerStatusContract;
  workOrderStatus: string | null;
  plannedStartAt: CrmDateTime;
  plannedEndAt: CrmDateTime;
  plate: string;
  vehicle: string;
  problem: string | null;
  post: string | null;
};

export type MechanicHomeKpisContract = {
  assigned: number;
  scheduledToday: number;
  inProgress: number;
  completedToday: number;
  waitingParts: number;
};

export type MechanicCabinetLinkedPayload = {
  ok: true;
  cabinet: "MECHANIC";
  linked: true;
  mechanic: {
    id: string;
    name: string;
    station: CabinetStationReference;
  };
  kpis: MechanicHomeKpisContract;
  tasks: MechanicHomeTaskContract[];
  appointments: MechanicHomeAppointmentContract[];
};

export type MechanicCabinetUnlinkedPayload = {
  ok: true;
  cabinet: "MECHANIC";
  linked: false;
  reason?: string;
};

export type MechanicCabinetPayload = MechanicCabinetLinkedPayload | MechanicCabinetUnlinkedPayload;

export type StationManagerKpisContract = {
  carsToday: number;
  carsOnStation: number;
  inRepair: number;
  postsOccupied: number;
  postsTotal: number;
  mechanicsTotal: number;
  noShow: number;
  needsAction: number;
  overdue: number;
  unassigned: number;
  missedCalls: number;
  newInquiries: number;
  stuckCars: number;
  proposalsNotSent: number;
  waitingCustomerDecision: number;
  partsBlocking: number;
  unpaidWorks: number;
};

export type StationManagerFlowContract = {
  booked: number;
  diagnostics: number;
  approval: number;
  waitingParts: number;
  readyForRepair: number;
  inRepair: number;
  qc: number;
  ready: number;
};

export type StationManagerAttentionPriority = "CRITICAL" | "HIGH" | "NORMAL";
export type StationManagerAttentionSourceType = "INQUIRY" | "APPOINTMENT" | "ESTIMATE";

export type StationManagerAttentionActionContract = {
  label: string;
  section: string;
  params?: Record<string, string>;
};

export type StationManagerAttentionContract = {
  id: string;
  sourceType: StationManagerAttentionSourceType;
  sourceId: string;
  code: string;
  title: string;
  description: string | null;
  priority: StationManagerAttentionPriority;
  reason: string;
  overdue: boolean;
  waitingMinutes: number;
  plate: string | null;
  vehicle: string | null;
  customer: string | null;
  action: StationManagerAttentionActionContract;
};

export type StationManagerPostLoadContract = {
  id: string;
  name: string;
  occupied: boolean;
  plate: string | null;
  vehicle: string | null;
  mechanic: string | null;
  plannedEndAt: CrmDateTime | null;
};

export type StationManagerMechanicLoadContract = {
  id: string;
  name: string;
  activeCars: number;
  inRepair: number;
  waiting: number;
  available: boolean;
};

export type StationManagerCabinetLinkedPayload = {
  ok: true;
  cabinet: "STATION_MANAGER";
  linked: true;
  station: CabinetStationReference;
  kpis: StationManagerKpisContract;
  flow: StationManagerFlowContract;
  attention: StationManagerAttentionContract[];
  posts: StationManagerPostLoadContract[];
  mechanics: StationManagerMechanicLoadContract[];
};

export type StationManagerCabinetUnlinkedPayload = {
  ok: true;
  cabinet: "STATION_MANAGER";
  linked: false;
  reason?: string;
};

export type StationManagerCabinetPayload = StationManagerCabinetLinkedPayload | StationManagerCabinetUnlinkedPayload;

export type CabinetHomePayload = MechanicCabinetPayload | StationManagerCabinetPayload;
