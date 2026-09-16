"use client";

import { useEffect, useState } from "react";
import { navigateCrm, readCrmRoute, type CrmRouteParams } from "./crm-route";
import { PartsCatalog as LegacyPartsCatalog } from "./parts-catalog-legacy";
import styles from "./parts-work-center.module.css";

export function PartsCatalog() {
  const [route, setRoute] = useState<CrmRouteParams>(() => readCrmRoute());
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const sync = () => setRoute(readCrmRoute());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  function refreshCatalog() {
    setRefreshKey((current) => current + 1);
  }

  if (route.diagnosticId) {
    return <div className={styles.focusPage}>
      <div className={styles.focusHeading}>
        <button type="button" className={styles.backToCenter} onClick={() => navigateCrm("Підбір запчастин", {})}>← Центр запчастин</button>
        <div className={styles.focusHeadingCopy}>
          <span>ПІДБІР ЗАПЧАСТИН</span>
          <b>VIN → OE/OEM → аналоги → постачальник → вибір</b>
        </div>
        <span className={styles.focusBadge}>Дані з Діагностичної карти</span>
      </div>
      <div className={styles.legacyFocus}><LegacyPartsCatalog key={refreshKey}/></div>
    </div>;
  }

  return <div className={styles.page}>
    <header className={styles.workCenterHeader}>
      <div className={styles.headerTop}>
        <div className={styles.headerTitle}>
          <p className={styles.eyebrow}>СЕРВІС · ЗАПЧАСТИНИ</p>
          <h1>Підбір запчастин</h1>
          <span>Робочий центр: ДК → OE/OEM → аналоги → постачальник → погодження → закупівля → встановлення.</span>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.secondaryButton} onClick={refreshCatalog}>↻ Оновити</button>
          <button type="button" className={styles.primaryButton} onClick={() => navigateCrm("Закупівлі та склад", {})}>Закупівлі та склад →</button>
        </div>
      </div>
      <div className={styles.sourceRow}>
        <span className={styles.sourceChip}>Живі дані CRM</span>
      </div>
    </header>

    <nav className={styles.tabs} style={{ gridTemplateColumns: "1fr" }} aria-label="Режим підбору запчастин">
      <div className={styles.tabActive} aria-current="page"><b>Каталог</b><span>VIN / OE / аналоги</span></div>
    </nav>

    <section className={styles.catalogMode}>
      <div className={styles.modeIntro}>
        <div><b>Робочий підбір із Діагностичної карти</b><span>Оберіть замовлення. Система передасть авто/VIN, позиції до заміни та відкриє живі пропозиції постачальників.</span></div>
        <span>Базова націнка 40% · фактичний % береться з налаштувань постачальника</span>
      </div>
      <div className={styles.legacyCatalog}><LegacyPartsCatalog key={refreshKey}/></div>
    </section>
  </div>;
}
