"use client";

import { NewRequestPricingBridge } from "./new-request-pricing-bridge";
import { NewRequestStep3Enhancer } from "./new-request-step3-enhancer";
import { NewRequestWizardV5 } from "./new-request-wizard-v5";

export function NewRequestLauncher({ showButton = true, onOpenChange }: { showButton?: boolean; onOpenChange?: (open: boolean) => void }) {
  return <><NewRequestWizardV5 showButton={showButton} onOpenChange={onOpenChange}/><NewRequestPricingBridge/><NewRequestStep3Enhancer/></>;
}
