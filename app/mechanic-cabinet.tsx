"use client";

import { MechanicLiveCabinet } from "./mechanic-live-cabinet";
import { MechanicRequestCoordinator } from "./mechanic-request-coordinator";

/**
 * Canonical entry point for every mechanic cabinet route.
 *
 * The live cabinet owns the mechanic UX and the coordinator keeps all of its
 * read models and diagnostic mutations on the same data contract. Keeping the
 * composition here prevents route-specific versions from drifting apart.
 */
export function MechanicCabinet({ userName }: { userName?: string | null }) {
  return <MechanicRequestCoordinator>
    <MechanicLiveCabinet userName={userName} />
  </MechanicRequestCoordinator>;
}
