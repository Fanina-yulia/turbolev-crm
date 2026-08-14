import { getCarLogo } from "@/src/ui/car-logo";

export type AttentionCar = {
  plate: string;
  brand: string;
  model: string;
  year: number;
  status: string;
  action: string;
  owner: string;
  tone: "warn" | "active" | "waiting" | "good";
};

function UkrainianPlate({ plate }: { plate: string }) {
  return (
    <div className="uaPlate" aria-label={`Державний номер ${plate}`}>
      <span className="uaPlateCountry" aria-hidden="true">
        <span className="uaFlag">
          <span className="uaFlagBlue" />
          <span className="uaFlagYellow" />
        </span>
        <small>UA</small>
      </span>
      <span
        className="uaPlateText"
        style={{
          fontFamily: '"Bahnschrift Condensed", "Arial Narrow", "Roboto Condensed", Arial, sans-serif',
          fontSize: "24px",
          fontWeight: 700,
          letterSpacing: ".06em",
          lineHeight: 1,
          transform: "scaleX(.68) scaleY(1.08)",
          transformOrigin: "center",
        }}
      >
        {plate}
      </span>
    </div>
  );
}

export function WorkOrderCockpit({ cars }: { cars: AttentionCar[] }) {
  return (
    <div className="panel">
      <div className="sectionHead">
        <div>
          <p className="eyebrow">WORKORDER COCKPIT</p>
          <h2>Авто, що потребують уваги</h2>
        </div>
        <button className="linkButton">Всі авто →</button>
      </div>

      <div className="carList">
        {cars.map((item) => (
          <article className="carRow" key={item.plate}>
            <UkrainianPlate plate={item.plate} />

            <div className="carInfo">
              <strong>
                {item.brand} {item.model} · {item.year}
              </strong>
              <span className={`badge ${item.tone}`}>{item.status}</span>
            </div>

            <div className="carBrandLogo" title={item.brand}>
              {getCarLogo(item.brand)}
            </div>

            <div className="next">
              <small>Наступна дія</small>
              <strong>{item.action}</strong>
              <span>{item.owner}</span>
            </div>

            <button className="rowArrow" aria-label={`Відкрити ${item.brand} ${item.model}`}>
              →
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
