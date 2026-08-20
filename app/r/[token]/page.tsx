import type { Metadata } from "next";
import { ClientPortal } from "./client-portal";
import styles from "./client-portal.module.css";
import {
  ClientPortalError,
  getClientPortalSnapshot,
} from "@/src/services/client-portal.service";
import { DiagnosticReportError } from "@/src/services/diagnostic-report.service";
import { writeAuditEvent } from "@/src/services/audit.service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Особистий кабінет · Turbo LEV",
  description: "Статус ремонту, діагностика, кошторис і чат із сервіс-менеджером Turbo LEV",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ClientPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const snapshot = await getClientPortalSnapshot(token);
    await writeAuditEvent({
      entityType: "DiagnosticRequest",
      entityId: snapshot.share.diagnosticRequestId,
      action: "CLIENT_PORTAL_OPENED",
      actorName: "Клієнт / public link",
      metadata: { shareId: snapshot.share.id, clientId: snapshot.client.id, vehicleId: snapshot.vehicle.id, source: "PUBLIC_CLIENT_PORTAL" },
    }).catch(() => undefined);
    return <ClientPortal token={token} initialSnapshot={snapshot} />;
  } catch (error) {
    const message = error instanceof ClientPortalError || error instanceof DiagnosticReportError
      ? error.message
      : "Не вдалося відкрити особистий кабінет.";
    return <main className={styles.page}>
      <div className={styles.shell}>
        <div style={{ maxWidth: 520, margin: "18dvh auto 0", padding: 28, border: "1px solid #283440", borderRadius: 22, background: "#121820", textAlign: "center" }}>
          <div className={styles.logo} style={{ margin: "0 auto 16px" }}>TL</div>
          <h1 style={{ margin: 0, fontSize: 25 }}>Кабінет недоступний</h1>
          <p style={{ color: "#9ca8b5", lineHeight: 1.5 }}>{message}</p>
          <small style={{ color: "#73808e" }}>Зверніться до сервіс-менеджера Turbo LEV, щоб отримати актуальне посилання.</small>
        </div>
      </div>
    </main>;
  }
}
