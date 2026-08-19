import { CrmShell } from "./crm-shell";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const section = Array.isArray(params.section) ? params.section[0] : params.section;
  const settingsTab = Array.isArray(params.settingsTab) ? params.settingsTab[0] : params.settingsTab;

  return <CrmShell initialSection={section} initialSettingsTab={settingsTab} />;
}