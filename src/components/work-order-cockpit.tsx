import { VehicleRender } from "@/app/vehicle-render";
import { VehiclePlate } from "@/app/vehicle-plate";
import styles from "./work-order-cockpit.module.css";

export type AttentionCar = {
  id: string;
  vehicleId?: string | null;
  plate: string;
  brand: string;
  model: string;
  year: number;
  status: string;
  action: string;
  owner: string;
  problem?: string | null;
  plannedStartAt?: string | null;
  tone: "warn" | "active" | "waiting" | "good";
  section: string;
  routeParams?: Record<string, string>;
};

function attentionTimeText(value?: string | null){
  if(!value)return "потребує дії";
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return "потребує дії";
  const delta=Date.now()-d.getTime();
  if(delta<=0)return `до ${new Intl.DateTimeFormat("uk-UA",{hour:"2-digit",minute:"2-digit"}).format(d)}`;
  const minutes=Math.max(1,Math.floor(delta/60_000));
  if(minutes<60)return `прострочено ${minutes} хв`;
  const hours=Math.floor(minutes/60);
  if(hours<24)return `прострочено ${hours} год`;
  const days=Math.floor(hours/24);
  return `прострочено ${days} д`;
}

function VehicleVisual({ item }: { item: AttentionCar }) {
  if (!item.vehicleId) {
    return <span className={styles.noImage} aria-label="Зображення авто недоступне">Фото авто</span>;
  }
  return <VehicleRender
    id={item.vehicleId}
    brand={item.brand}
    model={item.model}
    year={item.year}
    size="mini"
    className={styles.vehicleRender}
  />;
}

export function WorkOrderCockpit({ cars,onOpen,onAll }: { cars: AttentionCar[]; onOpen:(car:AttentionCar)=>void; onAll:()=>void }) {
  return (
    <div className="panel attentionPanel">
      <div className="sectionHead">
        <div><p className="eyebrow">WORKORDER COCKPIT</p><h2>Авто, що потребують уваги</h2></div>
        <button className="linkButton" onClick={onAll}>Всі авто →</button>
      </div>
      {!cars.length?<div className="attentionEmpty"><strong>Зараз немає авто, де потрібне втручання</strong><span>Система контролює всі незакриті авто: запізнення на запис, завислі етапи, відсутнього механіка або поста, деталі й ETA, ремонт, QC, оплату, видачу, паузи та гарантійні кейси.</span></div>:<div className={styles.list}>
        {cars.map((item) => (
          <button type="button" className={styles.row} key={item.id||item.plate} onClick={()=>onOpen(item)}>
            <div className={styles.visual}><VehicleVisual item={item}/></div>
            <div className={styles.identity}>
              <strong className={styles.title}>{item.brand} {item.model} · {item.year}</strong>
              <div className={styles.meta}>
                <VehiclePlate value={item.plate} size="sm" />
                <span className={`badge ${item.tone}`}>{item.status}</span>
              </div>
              {item.problem&&<small className={styles.problem}>{item.problem}</small>}
            </div>
            <div className={styles.next}><small>Потрібна дія</small><strong>{item.action}</strong><span>{item.owner} · {attentionTimeText(item.plannedStartAt)}</span></div>
            <span className={styles.arrow} aria-hidden="true">→</span>
          </button>
        ))}
      </div>}
    </div>
  );
}
