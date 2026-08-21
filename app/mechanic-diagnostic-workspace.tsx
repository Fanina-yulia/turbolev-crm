"use client";

import dynamic from "next/dynamic";

type MechanicDiagnosticWorkspaceProps = {
  diagnosticId: string;
  onBack: () => void;
  onChanged?: () => void;
};

const LazyMechanicDiagnosticWorkspace = dynamic<MechanicDiagnosticWorkspaceProps>(
  () => import("./mechanic-diagnostic-workspace-impl").then((module) => module.MechanicDiagnosticWorkspace),
  {
    ssr: false,
    loading: () => <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24, color: "#a8b4c0", background: "#090f16" }}>Відкриваю діагностику…</div>,
  },
);

export function MechanicDiagnosticWorkspace(props: MechanicDiagnosticWorkspaceProps) {
  return <LazyMechanicDiagnosticWorkspace {...props} />;
}
