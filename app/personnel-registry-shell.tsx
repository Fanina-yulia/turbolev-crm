"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { PersonnelV2 } from "./personnel-v2";
import styles from "./personnel-registry-shell.module.css";

export function PersonnelRegistryShell() {
  function openEmployeeCard(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    const button = target?.closest("aside > button");
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.dataset.personnelOpening === "1") return;

    button.dataset.personnelOpening = "1";
    queueMicrotask(() => {
      button.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      delete button.dataset.personnelOpening;
    });
  }

  return (
    <div className={styles.registryShell} onClickCapture={openEmployeeCard}>
      <PersonnelV2 />
    </div>
  );
}
