import { getAccessContext } from "@/src/security/access-context";
import { CrmShell } from "./crm-shell";
import { MechanicStandaloneCabinet } from "./mechanic-standalone-cabinet";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const section = Array.isArray(params.section) ? params.section[0] : params.section;
  const settingsTab = Array.isArray(params.settingsTab) ? params.settingsTab[0] : params.settingsTab;

  try {
    const access = await getAccessContext();
    const primaryRole = access.roles.find((role) => role.isPrimary) ?? access.roles[0] ?? null;
    if (access.provisioningState === "ACTIVE" && primaryRole?.code === "MECHANIC") {
      return <MechanicStandaloneCabinet userName={access.user?.employeeName || access.user?.name} />;
    }
  } catch (error) {
    console.error("Unable to resolve standalone cabinet", error instanceof Error ? error.message : "unknown");
  }

  return <CrmShell initialSection={section} initialSettingsTab={settingsTab} />;
}
