import { CrmShell } from "./crm-shell";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const section = Array.isArray(params.section) ? params.section[0] : params.section;

  return <CrmShell initialSection={section} />;
}
