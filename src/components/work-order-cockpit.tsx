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

function timeText(value?: string | null){
  if(!value)return "Без планового часу";
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return "Без планового часу";
  return new Intl.DateTimeFormat("uk-UA",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(d);
}

export function WorkOrderCockpit({ cars,onOpen,onAll }: { cars: AttentionCar[]; onOpen:(car:AttentionCar)=>void; onAll:()=>void }) {
  return (
    <div className="panel attentionPanel">
      <div className="sectionHead">
        <div><p className="eyebrow">WORKORDER COCKPIT</p><h2>Авто, що потребують уваги</h2></div>
        <button className="linkButton" onClick={onAll}>Всі авто →</button>
      </div>
      {!cars.length?<div className="attentionEmpty"><strong>Немає авто з критичною наступною дією</strong><span>Тут автоматично з’являться автомобілі з простроченим або блокуючим етапом: погодження, деталі, ремонт, QC чи no-show.</span></div>:<div className="carList">
        {cars.map((item) => (
          <button type="button" className="carRow attentionCarButton" key={item.id||item.plate} onClick={()=>onOpen(item)}>
            <UkrainianPlate plate={item.plate} />
            <div className="carInfo"><strong>{item.brand} {item.model} · {item.year}</strong><span className={`badge ${item.tone}`}>{item.status}</span>{item.problem&&<small className="attentionProblem">{item.problem}</small>}</div>
            <div className="carBrandLogo" title={item.brand}>{getCarLogo(item.brand)}</div>
            <div className="next"><small>Наступна дія</small><strong>{item.action}</strong><span>{item.owner} · {timeText(item.plannedStartAt)}</span></div>
            <span className="rowArrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>}
    </div>
  );
}
