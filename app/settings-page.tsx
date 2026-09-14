"use client";

import { CameraSettingsPanel } from "./camera-settings-panel";
import { DiagnosticTemplatesSettingsPanel } from "./diagnostic-templates-settings-panel";
import { IntegrationsSettingsHub } from "./integrations-settings-hub";
import { MetaAccountSelectionPrompt } from "./meta-account-selection-prompt";
import { PersonnelAccessGate } from "./personnel-access-gate";
import { PersonnelRegistryShell } from "./personnel-registry-shell";
import { PriceCatalogSettingsPanel } from "./price-catalog-settings-panel";
import { SecurityEnforcementControl } from "./security-enforcement-control";
import { SecuritySettingsPanelV2 } from "./security-settings-panel-v2";
import { SettingsOperationsPage } from "./settings-operations-page";
import { SettingsRouteFocusBridge } from "./settings-route-focus-bridge";
import type { SettingsTab } from "./settings-tabs";
import { SettingsVisibleSubmenu } from "./settings-visible-submenu";
import { WorkflowSettingsPanel } from "./workflow-settings-panel";
import { PartsCatalogSettingsPanel } from "./parts-catalog-settings-panel";
import styles from "./settings-page.module.css";
import workspaceStyles from "./settings-workspace-shell.module.css";

export function SettingsPage({ tab }: { tab: SettingsTab }) {
  let content;

  if (tab === "personnel") content = <div className={styles.directPage}><PersonnelAccessGate><PersonnelRegistryShell/></PersonnelAccessGate></div>;
  else if (tab === "workflow") content = <div className={styles.directPage}><WorkflowSettingsPanel/></div>;
  else if (tab === "security") content = <div className={styles.directPage}><SecurityEnforcementControl/><SecuritySettingsPanelV2/></div>;
  else if (tab === "cameras") content = <div className={styles.directPage}><CameraSettingsPanel/></div>;
  else if (tab === "diagnosticTemplates") content = <div className={styles.directPage}><DiagnosticTemplatesSettingsPanel/></div>;
  else if (tab === "workPrices") content = <div className={styles.directPage}><PriceCatalogSettingsPanel/></div>;
  else if (tab === "integrations") content = <div className={styles.directPage}><SettingsRouteFocusBridge tab={tab}/><IntegrationsSettingsHub/><MetaAccountSelectionPrompt/></div>;
  else if (tab === "partsCatalog") content = <div className={styles.directPage}><PartsCatalogSettingsPanel/></div>;
  else content = <><SettingsRouteFocusBridge tab={tab}/><SettingsOperationsPage tab={tab}/></>;

  return <div className={workspaceStyles.workspace} data-settings-workspace>
    <SettingsVisibleSubmenu tab={tab}/>
    <div className={workspaceStyles.content}>{content}</div>
  </div>;
}
