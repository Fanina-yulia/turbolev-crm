import type {
  CrmClientCore,
  CrmVehicleCore,
  EntityCounts,
  WorkOrderReference,
} from "./crm-core";

export type ClientVehiclesVehicleContract = CrmVehicleCore & {
  _count: EntityCounts;
};

export type ClientVehiclesClientContract = CrmClientCore & {
  _count: {
    vehicles: number;
    workOrders: number;
    diagnosticRequests: number;
  };
  workOrders: WorkOrderReference[];
  vehicles: ClientVehiclesVehicleContract[];
};

export type ClientsVehiclesPayload = {
  ok: true;
  total: number;
  offset: number;
  limit: number;
  clients: ClientVehiclesClientContract[];
};
