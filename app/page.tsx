import { redirect } from "next/navigation";
import { getAccessContext } from "@/src/security/access-context";
import { CrmShell } from "./crm-shell";
import { CrmAccessProvider } from "./crm-access-provider";
import type { CrmAccessSnapshot } from "./use-crm-access";
import { MechanicLiveCabinet } from "./mechanic-live-cabinet";
import { MechanicRequestCoordinator } from "./mechanic-request-coordinator";
import { OwnerViewAsControl } from "./personnel-owner-view-as-control";
import { SidebarRail } from "./auth/sidebar-rail";
import { SidebarRailIcons } from "./auth/sidebar-rail-icons";
import { BinotelRecordingProvider } from "./binotel-recordings";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ROLE_START_SECTION: Partial<Record<string, string>> = {
  HEAD_OF_SALES: "leads",
  SALES: "leads",
  ACCOUNTANT: "finance",
  MARKETING_DIRECTOR: "analytics",
  MARKETER: "analytics",
  HR_MANAGER: "settings",
  ADMINISTRATOR: "planner",
  CRM_ADMIN: "settings",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const access = await getAccessContext();

  if (access.provisioningState === "ANONYMOUS") {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const selected = first(value);
      if (selected) query.set(key, selected);
    }
    const nextPath = query.size ? `/?${query.toString()}` : "/";
    redirect(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`);
  }

  const primaryRole = access.roles.find((role) => role.isPrimary) ?? access.roles[0] ?? null;
  if (access.provisioningState === "ACTIVE" && primaryRole?.code === "MECHANIC") {
    return <>
      <OwnerViewAsControl/>
      <MechanicRequestCoordinator><MechanicLiveCabinet userName={access.user?.employeeName || access.user?.name} /></MechanicRequestCoordinator>
    </>;
  }

  const requestedSection = first(params.section);
  const roleStartSection = access.provisioningState === "ACTIVE" && primaryRole?.code
    ? ROLE_START_SECTION[primaryRole.code]
    : undefined;
  const section = requestedSection ?? roleStartSection;
  const settingsTab = first(params.settingsTab);
  const clientAccess: CrmAccessSnapshot = {
    authConfigured: access.authConfigured,
    authenticated: access.authenticated,
    provisioningState: access.provisioningState,
    enforcementMode: access.enforcementMode,
    user: access.user ? {
      id: access.user.id,
      name: access.user.employeeName || access.user.name,
      employeeId: access.user.employeeId,
    } : null,
    roles: access.roles,
    permissions: access.permissions,
    locations: access.locationIds,
  };

  return <>
    <OwnerViewAsControl/>
    <CrmAccessProvider snapshot={clientAccess}>
      <BinotelRecordingProvider><SidebarRail/><SidebarRailIcons/><CrmShell initialSection={section} initialSettingsTab={settingsTab} /></BinotelRecordingProvider>
    </CrmAccessProvider>
  </>;
}