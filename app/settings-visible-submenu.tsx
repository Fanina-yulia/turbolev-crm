"use client";

import { PERMISSIONS } from "@/src/security/permissions";
import { navigateCrm } from "./crm-route";
import type { SettingsTab } from "./settings-tabs";
import { useCrmAccess } from "./use-crm-access";
import styles from "./settings-visible-submenu.module.css";

const ITEMS: readonly { id: SettingsTab; label: string }[] = [
  { id: "schedule", label: "Графік" },
  { id: "personnel", label: "Персонал" },
  { id: "suppliers", label: "Постачальники" },
  { id: "warehouse", label: "Склад" },
  { id: "workPrices", label: "Прайс робіт" },
  { id: "posts", label: "Пости" },
  { id: "markup", label: "Націнка" },
  { id: "cash", label: "Каса" },
  { id: "integrations", label: "Інтеграції" },
  { id: "cameras", label: "Камери" },
  { id: "diagnosticTemplates", label: "Шаблони діагностики" },
  { id: "appearance", label: "Оформлення" },
  { id: "workflow", label: "Процеси та статуси" },
  { id: "security", label: "Ролі та доступи" },
  { id: "partsCatalog", label: "Каталог запчастин" },
] as const;

export function SettingsVisibleSubmenu({ tab }: { tab: SettingsTab }) {
  const access = useCrmAccess();
  const visible = ITEMS.filter((item) => {
    if (!access.enforced) return true;
    if (item.id === "personnel") return access.can(PERMISSIONS.PERSONNEL_READ);
    if (item.id === "cash") return access.can(PERMISSIONS.FINANCE_READ);
    if (item.id === "integrations") return access.can(PERMISSIONS.SETTINGS_INTEGRATIONS);
    if (item.id === "security") return access.can(PERMISSIONS.SECURITY_ACCESS_MANAGE);
    return access.can(PERMISSIONS.SETTINGS_READ);
  });

  return <aside className={styles.root} aria-label="Підрозділи налаштувань" data-settings-visible-submenu>
    <div className={styles.title}>Налаштування</div>
    <nav className={styles.list}>
      {visible.map((item) => <button
        key={item.id}
        type="button"
        className={item.id === tab ? styles.active : ""}
        aria-current={item.id === tab ? "page" : undefined}
        onClick={() => navigateCrm("Налаштування", { settingsTab: item.id })}
      >{item.label}</button>)}
    </nav>
  </aside>;
}
