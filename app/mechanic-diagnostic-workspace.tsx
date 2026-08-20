"use client";

import { useEffect, useState } from "react";
import { MechanicDiagnosticMatrix } from "./mechanic-diagnostic-matrix";
import { MechanicDiagnosticWorkspace as LegacyMechanicDiagnosticWorkspace } from "./mechanic-diagnostic-workspace-legacy";

type Mode = "MATRIX" | "LEGACY" | null;

function hasChassisIntent(problem: string | null | undefined) {
  return /(ходов|підвіск|рульов|сайлент|кульов|стабіліз|амортиз|привід|шрус)/u.test((problem || "").toLocaleLowerCase("uk-UA"));
}

function diagnosticMode(problem: string | null | undefined, templateNames: string[]): Exclude<Mode, null> {
  if (templateNames.length > 0) {
    return templateNames.some((name) => /матриця ходової/iu.test(name)) ? "MATRIX" : "LEGACY";
  }
  return hasChassisIntent(problem) ? "MATRIX" : "LEGACY";
}

export function MechanicDiagnosticWorkspace({ diagnosticId, onBack, onChanged }: { diagnosticId: string; onBack: () => void; onChanged?: () => void }) {
  const [mode, setMode] = useState<Mode>(null);

  useEffect(() => {
    let cancelled = false;
    setMode(null);
    void fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured`, { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) throw new Error("LOAD_FAILED");
        const templateNames = Array.isArray(body.inspections) ? body.inspections.map((item: { templateName?: string }) => item.templateName || "") : [];
        if (!cancelled) setMode(diagnosticMode(body.diagnostic?.problem, templateNames));
      })
      .catch(() => { if (!cancelled) setMode("LEGACY"); });
    return () => { cancelled = true; };
  }, [diagnosticId]);

  if (mode === "MATRIX") return <MechanicDiagnosticMatrix diagnosticId={diagnosticId} onBack={onBack} onChanged={onChanged} />;
  if (mode === "LEGACY") return <LegacyMechanicDiagnosticWorkspace diagnosticId={diagnosticId} onBack={onBack} onChanged={onChanged} />;

  return <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24, color: "#a8b4c0", background: "#090f16" }}>Відкриваю діагностику…</div>;
}