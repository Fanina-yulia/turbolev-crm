import { WorkOrderCockpit, type AttentionCar } from "@/src/components/work-order-cockpit";
import { ThemeToggle } from "./theme-toggle";
import { NewRequestWizardV2 } from "./new-request-wizard-v2";
import { turboLevLogoDark, turboLevLogoLight } from "@/src/brand/logos";

const nav = [
  "Огляд станції",
  "Ліди",
  "Клієнти та авто",
  "Планувальник",
  "Діагностика",
  "Замовлення-наряди",
  "Підбір запчастин",
  "Закупівлі та склад",
  "Виробництво",
  "Контроль якості",
  "Оплати",
  "Гарантії",
  "Аналітика",
];

const pipeline = [
  ["Нові заявки", "7", "2 прострочені SLA"],
  ["Записані", "11", "4 сьогодні"],
  ["На діагностиці", "3", "1 очікує майстра"],
  ["Погодження", "5", "₴ 48 700"],
  ["Очікують деталі", "4", "2 ETA сьогодні"],
  ["В ремонті", "6", "2 пости зайняті"],
  ["QC / готові", "2", "1 до видачі"],
];

const cars: AttentionCar[] = [
  {
    plate: "AA 4271 KI",
    brand: "Mazda",
    model: "6",
    year: 2016,
    status: "Погодження",
    action: "Погодити КП ₴18 450",
    owner: "Продавник",
    tone: "warn",
  },
  {
    plate: "KA 9180 CT",
    brand: "Volkswagen",
    model: "Caddy",
    year: 2012,
    status: "Ремонт",
    action: "Завершити передню підвіску",
    owner: "Автомеханік",
    tone: "active",
  },
  {
    plate: "AI 5523 PM",
    brand: "Ford",
    model: "S-Max",
    year: 2014,
    status: "Очікування деталей",
    action: "Контроль ETA постачальника",
    owner: "Підборщик",
    tone: "waiting",
  },
  {
    plate: "CB 1038 EA",
    brand: "BMW",
    model: "3",
    year: 2018,
    status: "Контроль якості",
    action: "Провести фінальний QC",
    owner: "Завідуючий",
    tone: "good",
  },
];

export default function HomePage() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandLogoWrap" aria-label="Turbo LEV">
            <img className="brandLogo brandLogoDark" src={turboLevLogoDark} alt="Turbo LEV" />
            <img className="brandLogo brandLogoLight" src={turboLevLogoLight} alt="Turbo LEV" />
          </div>
          <div className="brandText">
            <strong>CRM</strong>
            <span>СТО · Глеваха</span>
          </div>
        </div>
        <nav>
          {nav.map((item, i) => (
            <button className={i === 0 ? "navActive" : ""} key={item}>
              <span className="navDot" />
              {item}
            </button>
          ))}
        </nav>
        <div className="sidebarFoot">
          <span className="liveDot" /> Станція онлайн
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">TURBO LEV · ОПЕРАЦІЙНИЙ ЦЕНТР</p>
            <h1>Огляд станції</h1>
          </div>
          <div className="topActions">
            <ThemeToggle />
            <button className="ghost">Пошук VIN / номер</button>
            <NewRequestWizardV2 />
          </div>
        </header>

        <div className="alert">
          <strong>3 авто потребують дії</strong>
          <span>CRM показує тільки те, що має відповідального, строк і наступний крок.</span>
          <button>Переглянути</button>
        </div>

        <section className="kpis">
          <article>
            <span>Авто сьогодні</span>
            <strong>14</strong>
            <small>+3 до вчора</small>
          </article>
          <article>
            <span>В роботі</span>
            <strong>6</strong>
            <small>2 / 2 постів зайнято</small>
          </article>
          <article>
            <span>Виручка сьогодні</span>
            <strong>₴ 42 680</strong>
            <small>роботи + деталі</small>
          </article>
          <article>
            <span>Валовий прибуток</span>
            <strong>₴ 17 240</strong>
            <small>40,4% від виручки</small>
          </article>
        </section>

        <section className="sectionBlock">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">ВІД ЗАЯВКИ ДО ГРОШЕЙ</p>
              <h2>Живий маршрут станції</h2>
            </div>
            <span className="muted">сьогодні · демо-дані</span>
          </div>
          <div className="pipeline">
            {pipeline.map(([name, value, sub]) => (
              <article key={name}>
                <span>{name}</span>
                <strong>{value}</strong>
                <small>{sub}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="gridTwo">
          <WorkOrderCockpit cars={cars} />

          <aside className="panel blockers">
            <div className="sectionHead">
              <div>
                <p className="eyebrow">БЛОКЕРИ</p>
                <h2>Що стопорить гроші</h2>
              </div>
            </div>
            <div className="blocker">
              <b>Погодження клієнта</b>
              <strong>₴ 48 700</strong>
              <span>5 замовлень</span>
            </div>
            <div className="blocker">
              <b>Оплата деталей</b>
              <strong>₴ 31 260</strong>
              <span>3 замовлення</span>
            </div>
            <div className="blocker">
              <b>Очікування постачальника</b>
              <strong>4 авто</strong>
              <span>2 ризики строку видачі</span>
            </div>
            <div className="rule">
              Hard Gate #1: після заїзду створюється заявка на діагностику. Замовлення-наряд — тільки після підтвердженої діагностики.
            </div>
          </aside>
        </section>
      </section>
    </main>
  );
}
