"use client";

import { useEffect, useState } from "react";

type LeadPreview = {
  id: string;
  name: string;
  phone: string;
  plate: string;
  car: string;
  need: string;
  source: string;
  responsible: string;
  nextAction: string;
  nextContact: string;
  attempts: string;
  status: string;
  overdue: boolean;
};

function text(el: Element | null) { return el?.textContent?.trim() || ""; }

function fromCard(card: Element): LeadPreview {
  const metas = [...card.querySelectorAll(".leadMeta span")].map((x) => text(x));
  return {
    id: text(card.querySelector(".leadId")),
    name: text(card.querySelector(".leadName")),
    phone: text(card.querySelector(".leadPhone")),
    plate: text(card.querySelector(".leadVehicle b")),
    car: text(card.querySelector(".leadVehicle span")),
    need: text(card.querySelector(".leadNeed")),
    source: metas[0] || "—",
    responsible: metas[1] || "—",
    nextAction: (card.querySelector(".leadNextLabel input") as HTMLInputElement | null)?.value || "—",
    nextContact: text(card.querySelector(".leadNextTime")).replace(/^до\s*/, ""),
    attempts: text(card.querySelector(".attempts span")).replace("Спроби контакту:", "").trim(),
    status: (card.querySelector(".leadStatusSelect option:checked") as HTMLOptionElement | null)?.text || "—",
    overdue: card.classList.contains("leadCardOverdue"),
  };
}

function fromKpiRow(row: Element): LeadPreview {
  const cells = row.querySelectorAll(":scope > div");
  const person = cells[0];
  return {
    id: text(person?.querySelector("small")),
    name: text(person?.querySelector("strong")),
    phone: text(person?.querySelector("a")),
    plate: text(cells[1]?.querySelector("strong")),
    car: text(cells[1]?.querySelector("span")),
    need: text(cells[2]?.querySelector("strong")),
    source: text(cells[2]?.querySelector("span")),
    responsible: text(cells[3]?.querySelector("strong")),
    attempts: text(cells[3]?.querySelector("span")),
    nextAction: text(cells[4]?.querySelector("strong")),
    nextContact: text(cells[4]?.querySelector("span")),
    status: text(cells[5]?.querySelector("span")),
    overdue: row.classList.contains("leadKpiRowOverdue"),
  };
}

function fromTableRow(row: Element): LeadPreview {
  const cells = row.querySelectorAll("td");
  return {
    id: "Лід",
    name: text(cells[0]?.querySelector("strong")),
    phone: text(cells[0]?.querySelector("small")),
    plate: text(cells[1]?.querySelector("strong")),
    car: text(cells[1]?.querySelector("small")),
    need: cells[2]?.childNodes?.[0]?.textContent?.trim() || "—",
    source: text(cells[2]?.querySelector("small")),
    responsible: text(cells[4]),
    attempts: "—",
    nextAction: cells[5]?.childNodes?.[0]?.textContent?.trim() || "—",
    nextContact: text(cells[5]?.querySelector("small")),
    status: (cells[3]?.querySelector("select option:checked") as HTMLOptionElement | null)?.text || "—",
    overdue: row.classList.contains("overdueRow"),
  };
}

export function LeadDetailsEnhancer() {
  const [lead, setLead] = useState<LeadPreview | null>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("a,button,input,select,textarea,label")) return;
      const card = target.closest(".leadCard");
      if (card) { setLead(fromCard(card)); return; }
      const kpi = target.closest(".leadKpiRow");
      if (kpi) { setLead(fromKpiRow(kpi)); return; }
      const row = target.closest(".leadTable tbody tr");
      if (row) setLead(fromTableRow(row));
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  if (!lead) return null;
  const tel = lead.phone.replace(/[^+\d]/g, "");

  return <div className="leadDetailsBackdrop" onMouseDown={() => setLead(null)}>
    <aside className="leadDetailsDrawer" onMouseDown={(e) => e.stopPropagation()}>
      <header>
        <div><p className="eyebrow">КАРТКА ЛІДА · {lead.id}</p><h2>{lead.name}</h2><a href={`tel:${tel}`}>{lead.phone}</a></div>
        <button onClick={() => setLead(null)} aria-label="Закрити">×</button>
      </header>

      <div className={`leadDetailsSla ${lead.overdue ? "late" : "ok"}`}>
        <strong>{lead.overdue ? "ПРОСТРОЧЕНО" : "SLA В НОРМІ"}</strong>
        <span>{lead.overdue ? "Потрібна дія менеджера зараз" : `Статус: ${lead.status}`}</span>
      </div>

      <section className="leadDetailsGrid">
        <article><small>Авто</small><strong>{lead.plate}</strong><span>{lead.car}</span></article>
        <article><small>Джерело</small><strong>{lead.source}</strong></article>
        <article className="wide"><small>Звернення</small><strong>{lead.need}</strong></article>
        <article><small>Відповідальний</small><strong>{lead.responsible}</strong></article>
        <article><small>Спроби контакту</small><strong>{lead.attempts}</strong></article>
        <article className="wide"><small>Наступна дія</small><strong>{lead.nextAction}</strong><span>{lead.nextContact}</span></article>
      </section>

      <div className="leadDetailsStatus"><span>Поточний статус</span><strong>{lead.status}</strong></div>

      <footer>
        <a className="leadCallButton" href={`tel:${tel}`}>Подзвонити</a>
        <button className="ghost" onClick={() => setLead(null)}>Закрити</button>
      </footer>
    </aside>
  </div>;
}
