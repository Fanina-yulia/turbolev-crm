export type LeadStatus =
  | "NEW"
  | "CONTACTED"
  | "QUALIFIED"
  | "ESTIMATE"
  | "WAITING"
  | "NO_ANSWER"
  | "BOOKED"
  | "ARRIVED"
  | "LOST"
  | "SPAM_WRONG"
  | "SUPPLIER_PARTNER";

export type LeadBusinessStatus = "NEW" | "BOOKED" | "CANCELLED";
export type RejectReasonCode =
  | "TOO_EXPENSIVE"
  | "NO_CAPACITY_NO_TIME"
  | "SERVICE_NOT_PROVIDED"
  | "WRONG_NUMBER"
  | "SPAM_ADS"
  | "OTHER";

export type KpiKey = "new" | "overdue" | "booked" | "cancelled" | "conversion";

export type UserOption = {
  id: string;
  name: string;
  internalNumber?: string | null;
};

export type Lead = {
  id: string;
  name: string | null;
  phone: string;
  phoneNormalized: string;
  status: LeadStatus;
  rejectReason: RejectReasonCode | null;
  source: string;
  carBrand: string | null;
  carModel: string | null;
  carYear: number | null;
  plateNumber: string | null;
  vin: string | null;
  need: string | null;
  comment: string | null;
  nextAction: string | null;
  nextContactAt: string | null;
  contactAttempts: number;
  lastActivityAt: string;
  preliminaryAmount: string | number | null;
  assignedUserId: string | null;
  createdAt: string;
  updatedAt: string;
  assignedUser?: UserOption | null;
  _count?: { calls: number };
};

export type PlannerResource = { id: string; name: string };

export type PlannerLocation = {
  id: string;
  name: string;
  timezone: string;
  posts: PlannerResource[];
  mechanics: PlannerResource[];
};

export type BookingState = {
  lead: Lead;
  locationId: string;
  postId: string;
  mechanicId: string;
  mechanicParallelCount: number;
  parallelConfirmed: boolean;
  parallelConfirmationRequired: boolean;
  date: string;
  time: string;
  duration: string;
};

export type LeadPatch = {
  status?: LeadStatus;
  rejectReason?: RejectReasonCode | null;
  assignedUserId?: string | null;
  comment?: string | null;
  nextAction?: string | null;
  nextContactAt?: string | null;
};
