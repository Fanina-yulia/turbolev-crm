"use client";

import { CameraSettingsPanel } from "./camera-settings-panel";
import { PersonnelV2 } from "./personnel-v2";
import { SecurityEnforcementControl } from "./security-enforcement-control";
import { SecuritySettingsPanelV2 } from "./security-settings-panel-v2";
import { SettingsOperationsPage } from "./settings-operations-page";
import type { SettingsTab } from "./settings-tabs";
import { WorkflowSettingsPanel } from "./workflow-settings-panel";
import styles from "./settings-page.module.css";

export function SettingsPage({ tab }: { tab: SettingsTab }) {
  if (tab === "personnel") return <div className={styles.directPage}><PersonnelV2/></div>;
  if (tab === "workflow") return <div className={styles.directPage}><WorkflowSettingsPanel/></div>;
  if (tab === "security") return <div className={styles.directPage}><SecurityEnforcementControl/><SecuritySettingsPanelV2/></div>;
  if (tab === "cameras") return <div className={styles.directPage}><CameraSettingsPanel/></div>;
  return <SettingsOperationsPage tab={tab}/>;
}
