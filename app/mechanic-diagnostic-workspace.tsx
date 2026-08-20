"use client";

import { useEffect, useState } from "react";
import { MechanicDiagnosticMatrix } from "./mechanic-diagnostic-matrix";
import { MechanicDiagnosticWorkspace as LegacyMechanicDiagnosticWorkspace } from "./mechanic-diagnostic-workspace-legacy";

type Mode = "MATRIX" | "LEGACY" | null;

type HomeAppointment = {
  plate?: string | null;
  problem?: string | null;
  plannedStartAt?: string | null;
};

function normalizedPlate(value?: string | null) {
  const chars: Record<string, string> = { А: "A", В: "B", Е: "E", І: "I", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y" };
  const source = (value || "").normalize("NFKC").toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "");
  return [...source].map((char) => chars[char] || char).join("");
}

function hasChassisIntent(problem: string | null | undefined) {
  return /(ходов|підвіск|рульов|сайлент|кульов|стабіліз|амортиз|привід|шрус)/u.test((problem || "").toLocaleLowerCase("uk-UA"));
}

function diagnosticMode(problem: string | null | undefined, templateNames: string[]): Exclude<Mode, null> {
  if (templateNames.length > 0) {
    return templateNames.some((name) => /матриця ходової/iu.test(name)) ? "MATRIX" : "LEGACY";
  }
  return hasChassisIntent(problem) ? "MATRIX" : "LEGACY";
}

async function appointmentProblemForPlate(plate: string | null | undefined) {
  const normalized = normalizedPlate(plate);
  if (!normalized) return null;
  const response = await fetch("/api/cabinet/home", { cache: "no-store", credentials: "include" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok || !Array.isArray(body.appointments)) return null;
  const matches = (body.appointments as HomeAppointment[])
    .filter((item) => normalizedPlate(item.plate) === normalized)
    .sort((a, b) => new Date(b.plannedStartAt || 0).getTime() - new Date(a.plannedStartAt || 0).getTime());
  return matches.find((item) => item.problem)?.problem || null;
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
        let problem = body.diagnostic?.problem as string | null | undefined;
        if (!problem && templateNames.length === 0) {
          problem = await appointmentProblemForPlate(body.diagnostic?.vehicle?.plateNumber);
        }
        if (!cancelled) setMode(diagnosticMode(problem, templateNames));
      })
      .catch(() => { if (!cancelled) setMode("LEGACY"); });
    return () => { cancelled = true; };
  }, [diagnosticId]);

  if (mode === "MATRIX") return <MechanicDiagnosticMatrix diagnosticId={diagnosticId} onBack={onBack} onChanged={onChanged} />;
  if (mode === "LEGACY") return <LegacyMechanicDiagnosticWorkspace diagnosticId={diagnosticId} onBack={onBack} onChanged={onChanged} />;

  return <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24, color: "#a8b4c0", background: "#090f16" }}>Відкриваю діагностику…</div>;
}
