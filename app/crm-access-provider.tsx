"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CrmAccessSnapshot } from "./use-crm-access";

const CrmAccessInitialContext = createContext<CrmAccessSnapshot | null>(null);

export function CrmAccessProvider({ snapshot, children }: { snapshot: CrmAccessSnapshot; children: ReactNode }) {
  return <CrmAccessInitialContext.Provider value={snapshot}>{children}</CrmAccessInitialContext.Provider>;
}

export function useInitialCrmAccess() {
  return useContext(CrmAccessInitialContext);
}
