"use client";

import { NewRequestPricingBridge } from "./new-request-pricing-bridge";
import { NewRequestWizardV5 } from "./new-request-wizard-v5";

export function NewRequestLauncher({ showButton = true }: { showButton?: boolean }) {
  return <><NewRequestWizardV5 showButton={showButton}/><NewRequestPricingBridge/></>;
}
