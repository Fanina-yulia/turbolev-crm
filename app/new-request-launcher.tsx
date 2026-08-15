"use client";

import { NewRequestPricingBridge } from "./new-request-pricing-bridge";
import { NewRequestWizardV4 } from "./new-request-wizard-v4";

export function NewRequestLauncher({ showButton = true }: { showButton?: boolean }) {
  return <><NewRequestWizardV4 showButton={showButton}/><NewRequestPricingBridge/></>;
}
