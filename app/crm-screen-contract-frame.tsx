"use client";

import { useEffect, useMemo, useState } from "react";
import type { CrmSectionLabel } from "./crm-navigation";
import { resolveCrmScreenContract, resolveCrmScreenId, type CrmScreenRouteShape } from "./crm-screen-contracts";
import type { SettingsTab } from "./settings-tabs";

const LOCAL_SCROLL_SCREENS = new Set([
  "tasks",
  "communications",
  "clients",
  "vehicles",
  "planner",
  "diagnostics",
  "work-journal",
  "work-orders",
  "warranties",
  "procurement",
  "payments",
  "settings-personnel",
  "settings-workPrices",
  "settings-diagnosticTemplates",
  "settings-suppliers",
  "settings-warehouse",
  "settings-posts",
  "settings-cash",
  "settings-integrations",
  "settings-cameras",
  "settings-appearance",
  "settings-workflow",
  "settings-security",
  "settings-partsCatalog",
]);

function readRoute(): CrmScreenRouteShape {
  if (typeof window === "undefined") return {};
  const params = new URL(window.location.href).searchParams;
  return {
    vehicleId: params.get("vehicleId"),
    vehiclePage: params.get("vehiclePage"),
    diagnosticId: params.get("diagnosticId"),
    workOrderId: params.get("workOrderId"),
  };
}

export function CrmScreenContractFrame({
  section,
  settingsTab,
  children,
}: {
  section: CrmSectionLabel;
  settingsTab: SettingsTab;
  children: React.ReactNode;
}) {
  const [route, setRoute] = useState<CrmScreenRouteShape>({});

  useEffect(() => {
    const sync = () => setRoute(readRoute());
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("turbolev:screen-contract-sync", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("turbolev:screen-contract-sync", sync);
    };
  }, []);

  const contract = useMemo(
    () => resolveCrmScreenContract(section, settingsTab, route),
    [section, settingsTab, route],
  );
  const screen = useMemo(
    () => resolveCrmScreenId(section, settingsTab, route),
    [section, settingsTab, route],
  );
  const scrollOwner = contract === "one-scroll" && LOCAL_SCROLL_SCREENS.has(screen) ? "page" : "frame";

  return <div
    data-crm-screen-frame="true"
    data-crm-screen={screen}
    data-screen-contract={contract}
    data-crm-scroll-owner={scrollOwner}
  ><div
    data-crm-scroll-region={contract === "one" ? undefined : "main"}
    data-crm-scroll-mode={contract}
  >{children}</div></div>;
}
