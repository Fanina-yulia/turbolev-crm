import { redirect } from "next/navigation";
import { getAccessContext } from "@/src/security/access-context";
import { CrmShell } from "./crm-shell";
import { MechanicLiveCabinet } from "./mechanic-live-cabinet";
import { SidebarRail } from "./auth/sidebar-rail";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
    return <MechanicLiveCabinet userName={access.user?.employeeName || access.user?.name} />;
  }

  const section = first(params.section);
  const settingsTab = first(params.settingsTab);
  return <><SidebarRail/><CrmShell initialSection={section} initialSettingsTab={settingsTab} /></>;
}
