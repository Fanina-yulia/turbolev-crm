"use client";

import type { ReactNode } from "react";
import styles from "./crm-page-header.module.css";

export function CrmPageHeader({
  eyebrow,
  title,
  description,
  actions,
  tabs,
  controls,
  className,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  controls?: ReactNode;
  className?: string;
}) {
  return <header className={[styles.root, className].filter(Boolean).join(" ")} data-crm-page-header="true">
    <div className={styles.topRow}>
      <div className={styles.copy}>
        <p className={styles.eyebrow} data-crm-page-eyebrow="true">{eyebrow}</p>
        <h1 className={styles.title} data-crm-page-title="true">{title}</h1>
        {description ? <p className={styles.description} data-crm-page-description="true">{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions} data-crm-page-actions="true">{actions}</div> : null}
    </div>
    {tabs ? <div className={styles.tabs} data-crm-page-tabs="true">{tabs}</div> : null}
    {controls ? <div className={styles.controls} data-crm-page-controls="true">{controls}</div> : null}
  </header>;
}
