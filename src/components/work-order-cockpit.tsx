import { getCarLogo } from "@/src/ui/car-logo";

export type AttentionCar = {
  id: string;
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

function UkrainianPlate({ plate }: { plate: string }) {
  return (
    <div className="uaPlate" aria-label={`Державний номер ${plate}`}>
      <span className="uaPlateCountry" aria-hidden="true">
        <span className="uaFlag"><span className="uaFlagBlue" /><span className="uaFlagYellow" /></span>
        <small>UA</small>
      </span>
      <span className="uaPlateText">{plate}</span>
    </div>
  );
}

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

export function WorkOrderCockpit({ cars,onOpen,onAll }: { cars: AttentionCar[]; onOpen:(car:AttentionCar)=>void; onAll:()=>void }) {
  return (
    <div className="panel attentionPanel">
      <div className="sectionHead">
        <div><p className="eyebrow">WORKORDER COCKPIT</p><h2>Авто, що потребують уваги</h2></div>
        <button className="linkButton" onClick={onAll}>Всі авто →</button>
      </div>
      {!cars.length?<div className="attentionEmpty"><strong>Зараз немає авто, де потрібне втручання</strong><span>Система контролює всі незакриті авто: запізнення на запис, завислі етапи, відсутнього механіка або поста, деталі й ETA, ремонт, QC, оплату, видачу, паузи та гарантійні кейси.</span></div>:<div className="carList">
        {cars.map((item) => (
          <button type="button" className="carRow attentionCarButton" key={item.id||item.plate} onClick={()=>onOpen(item)}>
            <UkrainianPlate plate={item.plate} />
            <div className="carInfo"><strong>{item.brand} {item.model} · {item.year}</strong><span className={`badge ${item.tone}`}>{item.status}</span>{item.problem&&<small className="attentionProblem">{item.problem}</small>}</div>
            <div className="carBrandLogo" title={item.brand}>{getCarLogo(item.brand)}</div>
            <div className="next"><small>Потрібна дія</small><strong>{item.action}</strong><span>{item.owner} · {attentionTimeText(item.plannedStartAt)}</span></div>
            <span className="rowArrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>}
    </div>
  );
}
