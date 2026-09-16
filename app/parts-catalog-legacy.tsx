"use client";

import { useEffect, useState } from "react";
import { readCrmRoute } from "./crm-route";
import { PartsCatalog as PartsCatalogV3 } from "./parts-catalog-legacy-v3";
import { PartsSelectionWorkspaceV4 } from "./parts-selection-workspace-v4";

export function PartsCatalog() {
  const [diagnosticId, setDiagnosticId] = useState(() => readCrmRoute().diagnosticId || "");

  useEffect(() => {
    const sync = () => setDiagnosticId(readCrmRoute().diagnosticId || "");
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return diagnosticId ? <PartsSelectionWorkspaceV4/> : <PartsCatalogV3/>;
}
