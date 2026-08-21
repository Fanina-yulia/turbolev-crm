"use client";

import { useCallback, useEffect, useState } from "react";
import { MechanicDiagnosticMatrix } from "./mechanic-diagnostic-matrix";
import { MechanicDiagnosticWorkspace as LegacyMechanicDiagnosticWorkspace } from "./mechanic-diagnostic-workspace-legacy";
import { MechanicWalkInSettlement, type WalkInSettlementPayload } from "./mechanic-walk-in-settlement";

type Mode = "MATRIX" | "LEGACY" | null;

type DiagnosticModePayload = {
  ok?: boolean;
  mode?: "MATRIX" | "LEGACY";
};

export function MechanicDiagnosticWorkspace({ diagnosticId, onBack, onChanged }: { diagnosticId: string; onBack: () => void; onChanged?: () => void }) {
  const [mode, setMode] = useState<Mode>(null);
  const [settlement, setSettlement] = useState<WalkInSettlementPayload | null>(null);

  const loadSettlement = useCallback(async () => {
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/walk-in`, {
        credentials: "include",
        cache: "no-store",
      });
      const body = await response.json().catch(() => null) as WalkInSettlementPayload | null;
      if (!response.ok || !body?.ok) {
        setSettlement({ ok: true, walkIn: false });
        return;
      }
      setSettlement(body);
    } catch {
      setSettlement({ ok: true, walkIn: false });
    }
  }, [diagnosticId]);

  useEffect(() => {
    void loadSettlement();
  }, [loadSettlement]);

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

  function changed() {
    onChanged?.();
    void loadSettlement();
  }

  if (settlement?.walkIn && settlement.submitted) {
    return <MechanicWalkInSettlement diagnosticId={diagnosticId} data={settlement} onRefresh={loadSettlement} onBack={onBack} />;
  }
  if (mode === "MATRIX") return <MechanicDiagnosticMatrix diagnosticId={diagnosticId} onBack={onBack} onChanged={changed} />;
  if (mode === "LEGACY") return <LegacyMechanicDiagnosticWorkspace diagnosticId={diagnosticId} onBack={onBack} onChanged={changed} />;

  return <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24, color: "#a8b4c0", background: "#090f16" }}>Відкриваю діагностику…</div>;
}
