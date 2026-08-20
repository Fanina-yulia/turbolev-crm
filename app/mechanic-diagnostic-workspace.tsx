"use client";

import { useEffect, useState } from "react";
import { MechanicDiagnosticMatrix } from "./mechanic-diagnostic-matrix";
import { MechanicDiagnosticWorkspace as LegacyMechanicDiagnosticWorkspace } from "./mechanic-diagnostic-workspace-legacy";

type Mode = "MATRIX" | "LEGACY" | null;

type DiagnosticModePayload = {
  ok?: boolean;
  mode?: "MATRIX" | "LEGACY";
};

export function MechanicDiagnosticWorkspace({ diagnosticId, onBack, onChanged }: { diagnosticId: string; onBack: () => void; onChanged?: () => void }) {
  const [mode, setMode] = useState<Mode>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setMode(null);

    void fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured?mode=1`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as DiagnosticModePayload | null;
        if (!response.ok || !body?.ok || !body.mode) throw new Error("LOAD_FAILED");
        if (!cancelled) setMode(body.mode);
      })
      .catch((cause) => {
        if (!cancelled && cause instanceof Error && cause.name !== "AbortError") setMode("LEGACY");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [diagnosticId]);

  if (mode === "MATRIX") return <MechanicDiagnosticMatrix diagnosticId={diagnosticId} onBack={onBack} onChanged={onChanged} />;
  if (mode === "LEGACY") return <LegacyMechanicDiagnosticWorkspace diagnosticId={diagnosticId} onBack={onBack} onChanged={onChanged} />;

  return <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24, color: "#a8b4c0", background: "#090f16" }}>Відкриваю діагностику…</div>;
}
