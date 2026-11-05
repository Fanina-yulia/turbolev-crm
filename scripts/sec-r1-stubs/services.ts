import { state } from "./state";
const rec = (fn: string, ret: unknown = {}) => async (...args: unknown[]) => { state.__calls.push({ fn, args }); return typeof ret === "function" ? (ret as any)(...args) : ret; };
class Err extends Error { code = "X"; details: unknown; decision = { code: "X", missingGates: [] as string[] }; status = 409; }
export class WorkOrderFinanceValidationError extends Err {}
export class WorkOrderServiceWarrantyError extends Err {}
export class WorkOrderLineError extends Err {}
export class WorkOrderCommercialError extends Err {}
export class EstimateMarginGateError extends Err {}
export class WorkOrderQualityError extends Err {}
export class WorkOrderNotFoundError extends Err {}
export class WorkOrderTransitionError extends Err {}
export const getWorkOrderLines = rec("getWorkOrderLines", { lines: [] });
export const createWorkOrderLine = rec("createWorkOrderLine", { line: {} });
export const updateWorkOrderLine = rec("updateWorkOrderLine", { line: {} });
export const cancelWorkOrderLine = rec("cancelWorkOrderLine", { line: {} });
export const prepareCatalogWorkOrderLineInput = async (b: unknown) => b;
export const buildWorkOrderLineWarranty = () => null;
export const reconcileWorkOrderIssueLinks = rec("reconcileWorkOrderIssueLinks", {});
export const markWorkOrderIssues = rec("markWorkOrderIssues", { skippedIncomplete: 0 });
export const getWorkOrderCycleState = rec("getWorkOrderCycleState", { commercial: {} });
export const getWorkOrderCommercialState = rec("getWorkOrderCommercialState", { partsRequest: null });
export const sendEstimate = rec("sendEstimate", { estimate: { id: "e1" }, created: true });
export const decideEstimate = rec("decideEstimate", { id: "e1" });
export const openPartsRequest = rec("openPartsRequest", { id: "p1" });
export const assertEstimateMarginApprovedBeforeSend = rec("assertEstimateMarginApprovedBeforeSend", undefined);
export const normalizeApprovedEstimateFingerprint = rec("normalizeApprovedEstimateFingerprint", null);
export const getQualityControlState = rec("getQualityControlState", {});
export const ensureQualityControlTask = rec("ensureQualityControlTask", {});
export const updateQualityControl = rec("updateQualityControl", {});
export const transitionWorkOrder = rec("transitionWorkOrder", { id: "w", status: "READY_FOR_PICKUP" });
