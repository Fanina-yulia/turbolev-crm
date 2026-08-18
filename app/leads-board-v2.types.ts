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

export type KpiKey = "new" | "unanswered" | "overdue" | "booked" | "conversion";

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
  posts: PlannerResource[];
  mechanics: PlannerResource[];
};

export type BookingState = {
  lead: Lead;
  locationId: string;
  postId: string;
  mechanicId: string;
  date: string;
  time: string;
  duration: string;
};

export type LeadPatch = {
  status?: LeadStatus;
  assignedUserId?: string | null;
  nextAction?: string | null;
  nextContactAt?: string | null;
};
