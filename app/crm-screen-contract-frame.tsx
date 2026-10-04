"use client";

import { useEffect, useMemo, useState } from "react";
import type { CrmSectionLabel } from "./crm-navigation";
import { resolveCrmScreenContract, resolveCrmScreenId, type CrmScreenRouteShape } from "./crm-screen-contracts";
import type { SettingsTab } from "./settings-tabs";

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

  return <div
    data-crm-screen-frame="true"
    data-crm-screen={screen}
    data-screen-contract={contract}
  ><div
    data-crm-scroll-region={contract === "one" ? undefined : "main"}
    data-crm-scroll-mode={contract}
  >{children}</div></div>;
}
