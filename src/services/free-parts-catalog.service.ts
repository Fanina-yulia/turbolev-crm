export type ReferencePart = {
  slug: string;
  name: string;
  category?: string;
  aliases?: string[];
};

export const FREE_PARTS_SOURCE = {
  id: "LIFEOFCAPO_CAR_API_PINNED",
  license: "MIT",
  repository: "lifeofcapo/car-api",
  commit: "0a7092f9a37b179115bcc034d526155688ba9405",
  url: "https://raw.githubusercontent.com/lifeofcapo/car-api/0a7092f9a37b179115bcc034d526155688ba9405/car-parts.json",
} as const;

const FALLBACK_PARTS: ReferencePart[] = [
  { slug: "front-shock-absorber", name: "Амортизатор передній", category: "Підвіска", aliases: ["амортизатор", "стойка", "shock absorber"] },
  { slug: "rear-shock-absorber", name: "Амортизатор задній", category: "Підвіска", aliases: ["амортизатор", "shock absorber"] },
  { slug: "front-sway-bar-link", name: "Стійка стабілізатора передня", category: "Підвіска", aliases: ["стойка стабилизатора", "тяга стабілізатора", "stabilizer link"] },
  { slug: "rear-sway-bar-link", name: "Стійка стабілізатора задня", category: "Підвіска", aliases: ["стойка стабилизатора", "тяга стабілізатора", "stabilizer link"] },
  { slug: "sway-bar-bushing", name: "Втулка стабілізатора", category: "Підвіска", aliases: ["втулка стабилизатора", "stabilizer bushing"] },
  { slug: "front-control-arm", name: "Важіль передній", category: "Підвіска", aliases: ["рычаг", "control arm"] },
  { slug: "rear-control-arm", name: "Важіль задній", category: "Підвіска", aliases: ["рычаг", "control arm"] },
  { slug: "rubber-bushing", name: "Сайлентблок", category: "Підвіска", aliases: ["сайлентблок", "bushing"] },
  { slug: "ball-joint", name: "Кульова опора", category: "Підвіска", aliases: ["шаровая", "ball joint"] },
  { slug: "tie-rod-end", name: "Рульовий наконечник", category: "Кермове", aliases: ["наконечник рулевой", "tie rod end"] },
  { slug: "steering-tie-rod", name: "Рульова тяга", category: "Кермове", aliases: ["тяга рулевая", "tie rod"] },
  { slug: "steering-rack", name: "Рульова рейка", category: "Кермове", aliases: ["рулевая рейка", "steering rack"] },
  { slug: "wheel-hub-bearing", name: "Підшипник маточини", category: "Підвіска", aliases: ["ступичный подшипник", "wheel bearing"] },
  { slug: "front-wheel-hub", name: "Маточина передня", category: "Підвіска", aliases: ["ступица", "wheel hub"] },
  { slug: "rear-wheel-hub", name: "Маточина задня", category: "Підвіска", aliases: ["ступица", "wheel hub"] },
  { slug: "brake-pad-set-front", name: "Колодки гальмівні передні", category: "Гальма", aliases: ["колодки передние", "brake pads"] },
  { slug: "brake-pad-set-rear", name: "Колодки гальмівні задні", category: "Гальма", aliases: ["колодки задние", "brake pads"] },
  { slug: "front-brake-disc", name: "Диск гальмівний передній", category: "Гальма", aliases: ["тормозной диск", "brake disc", "rotor"] },
  { slug: "rear-brake-disc", name: "Диск гальмівний задній", category: "Гальма", aliases: ["тормозной диск", "brake disc", "rotor"] },
  { slug: "front-brake-caliper", name: "Супорт передній", category: "Гальма", aliases: ["суппорт", "brake caliper"] },
  { slug: "rear-brake-caliper", name: "Супорт задній", category: "Гальма", aliases: ["суппорт", "brake caliper"] },
  { slug: "brake-fluid", name: "Гальмівна рідина", category: "Гальма", aliases: ["тормозная жидкость", "brake fluid"] },
  { slug: "abs-sensor", name: "Датчик ABS", category: "Електрика", aliases: ["датчик абс", "wheel speed sensor"] },
  { slug: "air-filter", name: "Фільтр повітряний", category: "ТО", aliases: ["воздушный фильтр", "air filter"] },
  { slug: "oil-filter", name: "Фільтр масляний", category: "ТО", aliases: ["масляный фильтр", "oil filter"] },
  { slug: "fuel-filter", name: "Фільтр паливний", category: "ТО", aliases: ["топливный фильтр", "fuel filter"] },
  { slug: "cabin-air-filter", name: "Фільтр салону", category: "ТО", aliases: ["салонный фильтр", "cabin filter"] },
  { slug: "engine-oil", name: "Моторна олива", category: "ТО", aliases: ["моторное масло", "engine oil"] },
  { slug: "spark-plug", name: "Свічка запалювання", category: "Двигун", aliases: ["свеча зажигания", "spark plug"] },
  { slug: "glow-plug", name: "Свічка розжарювання", category: "Двигун", aliases: ["свеча накала", "glow plug"] },
  { slug: "ignition-coil", name: "Котушка запалювання", category: "Двигун", aliases: ["катушка зажигания", "ignition coil"] },
  { slug: "timing-belt-kit", name: "Комплект ременя ГРМ", category: "Двигун", aliases: ["грм", "timing belt kit"] },
  { slug: "timing-chain-kit", name: "Комплект ланцюга ГРМ", category: "Двигун", aliases: ["цепь грм", "timing chain"] },
  { slug: "water-pump", name: "Водяний насос (помпа)", category: "Охолодження", aliases: ["помпа", "water pump"] },
  { slug: "thermostat", name: "Термостат", category: "Охолодження", aliases: ["thermostat"] },
  { slug: "main-radiator", name: "Радіатор основний", category: "Охолодження", aliases: ["радиатор", "radiator"] },
  { slug: "coolant", name: "Охолоджувальна рідина", category: "Охолодження", aliases: ["антифриз", "coolant"] },
  { slug: "turbocharger", name: "Турбіна", category: "Двигун", aliases: ["турбина", "турбокомпрессор", "turbocharger"] },
  { slug: "egr-valve", name: "Клапан EGR", category: "Двигун", aliases: ["егр", "egr valve"] },
  { slug: "oxygen-sensor-lambda", name: "Лямбда-зонд", category: "Двигун", aliases: ["лямбда", "oxygen sensor"] },
  { slug: "mass-airflow-sensor", name: "ДМРВ / витратомір повітря", category: "Двигун", aliases: ["расходомер", "maf", "mass airflow"] },
  { slug: "fuel-injector", name: "Паливна форсунка", category: "Паливна", aliases: ["форсунка", "injector"] },
  { slug: "high-pressure-fuel-pump", name: "ПНВТ / ТНВД", category: "Паливна", aliases: ["тнвд", "high pressure fuel pump"] },
  { slug: "fuel-pump", name: "Паливний насос", category: "Паливна", aliases: ["топливный насос", "fuel pump"] },
  { slug: "battery", name: "Акумулятор", category: "Електрика", aliases: ["акб", "battery"] },
  { slug: "alternator", name: "Генератор", category: "Електрика", aliases: ["alternator"] },
  { slug: "starter-motor", name: "Стартер", category: "Електрика", aliases: ["starter"] },
  { slug: "ac-compressor", name: "Компресор кондиціонера", category: "Кондиціонер", aliases: ["компрессор кондиционера", "ac compressor"] },
  { slug: "ac-condenser-radiator", name: "Радіатор кондиціонера", category: "Кондиціонер", aliases: ["конденсер", "конденсор", "ac condenser"] },
  { slug: "clutch-kit", name: "Комплект зчеплення", category: "Трансмісія", aliases: ["сцепление", "clutch kit"] },
  { slug: "dual-mass-flywheel", name: "Двомасовий маховик", category: "Трансмісія", aliases: ["двухмассовый маховик", "flywheel"] },
  { slug: "inner-cv-joint", name: "ШРУС внутрішній", category: "Трансмісія", aliases: ["внутренний шрус", "inner cv joint"] },
  { slug: "outer-cv-joint", name: "ШРУС зовнішній", category: "Трансмісія", aliases: ["наружный шрус", "outer cv joint"] },
  { slug: "half-shaft-cv-axle", name: "Піввісь / привід", category: "Трансмісія", aliases: ["полуось", "привод", "cv axle"] },
  { slug: "engine-mount", name: "Подушка двигуна", category: "Двигун", aliases: ["опора двигателя", "engine mount"] },
  { slug: "gearbox-mount", name: "Подушка КПП", category: "Трансмісія", aliases: ["опора кпп", "transmission mount"] },
  { slug: "ride-height-sensor", name: "Датчик положення кузова", category: "Підвіска", aliases: ["датчик кузова", "датчик дорожного просвета", "ride height sensor"] },
  { slug: "ride-height-sensor-rod", name: "Тяга датчика положення кузова", category: "Підвіска", aliases: ["тяга датчика кузова", "height sensor link"] },
];

let memoryCache: { expires: number; parts: ReferencePart[]; remote: boolean } | null = null;

function normalize(value: string) {
  return value.toLocaleLowerCase("uk-UA").replace(/[’'`]/g, "").replace(/\s+/g, " ").trim();
}

async function loadRemote(): Promise<ReferencePart[]> {
  const response = await fetch(FREE_PARTS_SOURCE.url, {
    headers: { "User-Agent": "TurboLEV-CRM/2.0" },
    next: { revalidate: 7 * 24 * 60 * 60 },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`Reference catalog HTTP ${response.status}`);
  const raw = await response.json();
  if (!Array.isArray(raw)) throw new Error("Reference catalog payload is not an array");
  return raw
    .map((item) => ({ slug: String(item?.slug ?? "").trim(), name: String(item?.name ?? "").trim() }))
    .filter((item) => item.slug && item.name);
}

export async function getReferenceParts() {
  if (memoryCache && memoryCache.expires > Date.now()) return memoryCache;
  try {
    const parts = await loadRemote();
    memoryCache = { expires: Date.now() + 6 * 60 * 60 * 1000, parts, remote: true };
  } catch (error) {
    console.warn("Pinned free parts catalog unavailable; using Turbo LEV fallback", error);
    memoryCache = { expires: Date.now() + 10 * 60 * 1000, parts: FALLBACK_PARTS, remote: false };
  }
  return memoryCache;
}

export async function searchReferenceParts(query: string, limit = 50) {
  const q = normalize(query);
  if (q.length < 2) return { parts: [] as ReferencePart[], remote: false };
  const catalog = await getReferenceParts();
  const tokens = q.split(" ").filter(Boolean);
  const scored = catalog.parts
    .map((part) => {
      const haystack = normalize([part.name, part.slug, ...(part.aliases ?? [])].join(" "));
      const all = tokens.every((token) => haystack.includes(token));
      if (!all) return null;
      const exact = normalize(part.name) === q || normalize(part.slug) === q;
      const starts = normalize(part.name).startsWith(q) || normalize(part.slug).startsWith(q);
      return { part, score: exact ? 100 : starts ? 80 : 50 };
    })
    .filter((item): item is { part: ReferencePart; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score || a.part.name.localeCompare(b.part.name, "uk"))
    .slice(0, limit)
    .map((item) => item.part);
  return { parts: scored, remote: catalog.remote };
}
