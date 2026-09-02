"use client";

import { useMemo, useState } from "react";
import styles from "./parts-catalog-diagram.module.css";

export type PartsDiagramRecommendation = {
  findingId: string;
  name: string;
  position: string;
  quantity: number;
  action: string;
  urgency: string;
};

type PartsCatalogDiagramProps = {
  vehicleLabel: string;
  vin: string | null;
  recommendations: PartsDiagramRecommendation[];
  activeFindingId: string;
  onSelect: (findingId: string) => void;
};

const GROUPS = [
  "Фільтр повітряний",
  "Фільтр паливний",
  "Фільтр салонний",
  "Свічки запалювання",
  "Додаткове обладнання",
  "Двигун",
  "Паливна система",
  "Паливний інжектор",
  "Прокладка",
];

const HOTSPOTS = [
  { x: 202, y: 112 },
  { x: 292, y: 142 },
  { x: 382, y: 112 },
  { x: 476, y: 144 },
  { x: 565, y: 112 },
  { x: 650, y: 144 },
  { x: 735, y: 112 },
  { x: 820, y: 144 },
];

function displayAction(action: string) {
  if (action === "REPLACE") return "Заміна";
  if (action === "REPAIR") return "Ремонт";
  return action || "Перевірити";
}

export function PartsCatalogDiagram({ vehicleLabel, vin, recommendations, activeFindingId, onSelect }: PartsCatalogDiagramProps) {
  const [zoom, setZoom] = useState(100);
  const visibleRecommendations = useMemo(() => recommendations.slice(0, HOTSPOTS.length), [recommendations]);
  const vinLabel = vin ? `VIN ${vin}` : "VIN не вказаний";

  function choose(findingId: string) {
    if (findingId) onSelect(findingId);
  }

  function handleHotspotKeyDown(event: React.KeyboardEvent<SVGGElement>, findingId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(findingId);
    }
  }

  return (
    <section className={styles.panel} aria-label="Графічний каталог запчастин">
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <span className={styles.eyebrow}>ГРАФІЧНИЙ КАТАЛОГ</span>
          <h2>{vehicleLabel}</h2>
          <p>{vinLabel} · схема вузла та позиції з Діагностичної карти</p>
        </div>
        <div className={styles.headerNote}>
          <b>Попередній макет</b>
          <span>Точна OE-схема підставляється з API каталогу постачальника</span>
        </div>
      </header>

      <div className={styles.workspace}>
        <nav className={styles.groups} aria-label="Групи деталей">
          <div className={styles.groupTabs}><b>☷</b><span className={styles.groupTabActive}>Швидкі групи</span><span>Категорії</span></div>
          <div className={styles.groupList}>
            {GROUPS.map((group) => (
              <button type="button" className={`${styles.groupItem} ${group === "Паливна система" ? styles.groupItemActive : ""}`} key={group}>
                <span>{group}</span>
                {group === "Додаткове обладнання" || group === "Двигун" || group === "Паливна система" || group === "Паливний інжектор" ? <b>⌄</b> : null}
              </button>
            ))}
          </div>
        </nav>

        <div className={styles.diagramColumn}>
          <div className={styles.diagramToolbar}>
            <span>ПАЛИВНА СИСТЕМА · ФОРСУНКИ, РОЗПОДІЛЮВАЧ, ПАЛИВО</span>
            <div className={styles.zoomControls}>
              <button type="button" onClick={() => setZoom((value) => Math.max(80, value - 20))} aria-label="Зменшити схему">−</button>
              <span>{zoom}%</span>
              <button type="button" onClick={() => setZoom((value) => Math.min(160, value + 20))} aria-label="Збільшити схему">+</button>
            </div>
          </div>
          <div className={styles.diagramViewport}>
            <div className={styles.diagramCanvas} style={{ transform: `scale(${zoom / 100})` }}>
              <svg viewBox="0 0 1024 330" role="img" aria-label="Попередня схема паливної системи">
                <defs>
                  <linearGradient id="rail" x1="0" x2="1">
                    <stop offset="0" stopColor="#526873" />
                    <stop offset="0.5" stopColor="#d2d9dc" />
                    <stop offset="1" stopColor="#435761" />
                  </linearGradient>
                  <linearGradient id="darkMetal" x1="0" x2="1">
                    <stop offset="0" stopColor="#1e3039" />
                    <stop offset="0.45" stopColor="#8398a1" />
                    <stop offset="1" stopColor="#18272f" />
                  </linearGradient>
                </defs>
                <rect x="48" y="28" width="928" height="274" rx="4" fill="#f8f9f9" stroke="#9ca9ad" />
                <g stroke="#546a73" strokeWidth="8" strokeLinecap="round" fill="none">
                  <path d="M136 104 C226 70 286 80 338 112 S458 150 510 111 S634 72 704 111 S826 150 898 92" />
                  <path d="M138 225 C208 178 280 200 338 222 S452 251 515 215 S633 177 708 216 S824 248 894 205" />
                </g>
                <g stroke="#263b44" strokeWidth="4" fill="url(#darkMetal)">
                  <rect x="150" y="91" width="116" height="28" rx="8" />
                  <rect x="278" y="98" width="116" height="28" rx="8" />
                  <rect x="406" y="96" width="116" height="28" rx="8" />
                  <rect x="534" y="95" width="116" height="28" rx="8" />
                  <rect x="662" y="91" width="116" height="28" rx="8" />
                  <rect x="790" y="86" width="116" height="28" rx="8" />
                  <path d="M250 207 L302 184 L344 197 L300 233 Z" />
                  <path d="M432 205 L482 179 L532 195 L482 232 Z" />
                  <path d="M626 202 L674 180 L726 198 L677 233 Z" />
                </g>
                <g stroke="#afbdc2" strokeWidth="3" fill="url(#rail)">
                  <path d="M120 156 H902" />
                  <path d="M120 166 H902" />
                  <path d="M120 176 H902" />
                </g>
                <g fill="#d7dfe2" stroke="#263b44" strokeWidth="4">
                  <circle cx="158" cy="156" r="13" /><circle cx="222" cy="156" r="13" /><circle cx="286" cy="156" r="13" /><circle cx="350" cy="156" r="13" />
                  <circle cx="414" cy="156" r="13" /><circle cx="478" cy="156" r="13" /><circle cx="542" cy="156" r="13" /><circle cx="606" cy="156" r="13" />
                  <circle cx="670" cy="156" r="13" /><circle cx="734" cy="156" r="13" /><circle cx="798" cy="156" r="13" /><circle cx="862" cy="156" r="13" />
                </g>
                <g fill="none" stroke="#536b75" strokeWidth="6" strokeLinecap="round">
                  <path d="M112 82 H88 V240 H160" /><path d="M912 82 H936 V240 H864" /><path d="M390 250 H632" />
                </g>
                {visibleRecommendations.map((item, index) => {
                  const hotspot = HOTSPOTS[index];
                  const active = item.findingId === activeFindingId;
                  return (
                    <g
                      key={item.findingId}
                      className={`${styles.hotspot} ${active ? styles.hotspotActive : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Позиція ${index + 1}: ${item.name}`}
                      onClick={() => choose(item.findingId)}
                      onKeyDown={(event) => handleHotspotKeyDown(event, item.findingId)}
                    >
                      <circle cx={hotspot.x} cy={hotspot.y} r="16" />
                      <text x={hotspot.x} y={hotspot.y + 5} textAnchor="middle">{index + 1}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
            {!recommendations.length ? <div className={styles.noRecommendations}>Оберіть позицію в Діагностичній карті, щоб з’явилися клікабельні номери.</div> : null}
          </div>
          <div className={styles.diagramCaption}><span>ⓘ</span><span>Макет не підтверджує сумісність OE. Для точного зображення потрібен графічний payload Inter Cars або іншого підключеного каталогу.</span></div>
        </div>

        <aside className={styles.positions} aria-label="Позиції схеми">
          <div className={styles.positionHead}><span>#</span><span>Назва / примітка</span><span>OE</span><span>К-ть</span></div>
          {recommendations.length ? recommendations.map((item, index) => (
            <button type="button" className={`${styles.positionRow} ${item.findingId === activeFindingId ? styles.positionRowActive : ""}`} key={item.findingId} onClick={() => choose(item.findingId)}>
              <strong>{index + 1}</strong>
              <span><b>{item.name}</b><small>{item.position} · {displayAction(item.action)} · {item.urgency || "INFO"}</small></span>
              <em>Очікує<br />каталог</em>
              <small>{item.quantity} шт</small>
            </button>
          )) : <div className={styles.positionEmpty}>Позиції з Діагностичної карти з’являться тут.</div>}
        </aside>
      </div>
    </section>
  );
}
