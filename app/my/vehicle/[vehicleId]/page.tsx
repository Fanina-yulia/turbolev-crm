import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  CLIENT_PORTAL_SESSION_COOKIE,
  ClientPortalSessionError,
  resolveClientPortalSession,
} from "@/src/services/client-portal-session.service";
import { getClientVehiclePortalDetail } from "@/src/services/client-portal-vehicle.service";
import { VehicleDetailClient } from "./vehicle-detail-client";
import styles from "./vehicle-detail.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Моє авто · Turbo LEV",
  description: "Поточний ремонт, погодження, документи та чат по автомобілю Turbo LEV",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ClientVehiclePage({ params }: { params: Promise<{ vehicleId: string }> }) {
  const store = await cookies();
  const session = await resolveClientPortalSession(store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value || null);
  if (!session) redirect("/my");
  const { vehicleId } = await params;

  try {
    const detail = await getClientVehiclePortalDetail(session.clientId, vehicleId);
    return <VehicleDetailClient initialDetail={detail} />;
  } catch (error) {
    const message = error instanceof ClientPortalSessionError ? error.message : "Не вдалося відкрити автомобіль.";
    return <main className={styles.page} data-crm-surface="public">
      <section className={styles.errorCard}>
        <img className={styles.logo} data-crm-logo-slot="public" data-crm-default-src="/brand/turbolev-logo.png" src="/brand/turbolev-logo.png" alt="Turbo LEV" />
        <h1>Автомобіль недоступний</h1>
        <p>{message}</p>
        <a href="/my">Повернутися в «Мій гараж»</a>
      </section>
    </main>;
  }
}
