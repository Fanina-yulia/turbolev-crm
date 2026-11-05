import { getPrisma } from "@/src/lib/prisma";

export const CRM_DICTIONARY_SETTING_KEY = "crm_dictionary";
export const CRM_DICTIONARY_UNKNOWN_TERMS_SETTING_KEY = "crm_dictionary_unknown_terms";

export type CrmDictionaryEntryType = "PART" | "SERVICE" | "SYMPTOM" | "PROCESS";

export type CrmDictionaryEntry = {
  id: string;
  type: CrmDictionaryEntryType;
  category: string;
  canonicalName: string;
  canonicalCode?: string;
  aliases: string[];
  notes?: string;
  requiresFitmentCheck?: boolean;
};

export type CrmDictionary = {
  version: 1;
  updatedBy: string;
  entries: CrmDictionaryEntry[];
};

export type CrmDictionaryMatch = {
  input: string;
  normalizedInput: string;
  entry: CrmDictionaryEntry;
  matchedAlias: string;
  matchType: "EXACT" | "CONTAINS";
  score: number;
};

export type CrmDictionaryUnknownTerm = {
  rawTerm: string;
  normalizedTerm: string;
  count: number;
  source: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type CrmDictionaryUnknownTerms = {
  version: 1;
  terms: CrmDictionaryUnknownTerm[];
};

const PARTS: CrmDictionaryEntry[] = [
  {
    id: "part-control-arm",
    type: "PART",
    category: "Ходова / підвіска",
    canonicalName: "Важіль підвіски",
    canonicalCode: "CONTROL_ARM",
    aliases: ["важіль", "важіль підвіски", "передній важіль", "задній важіль", "верхній важіль", "нижній важіль", "ричаг", "рычаг", "рьічаг", "ричяг", "річаг", "рычаг подвески", "передний рычаг", "задний рычаг", "верхний рычаг", "нижний рычаг", "control arm"],
    requiresFitmentCheck: true,
    notes: "Не підміняє сумісність: після збігу обов'язково потрібна перевірка авто/VIN/сторони/осі.",
  },
  {
    id: "part-control-arm-bushing",
    type: "PART",
    category: "Ходова / підвіска",
    canonicalName: "Сайлентблок важеля",
    canonicalCode: "CONTROL_ARM_BUSHING",
    aliases: ["сайлентблок", "сайлент блок", "сайленблок", "саленблок", "салєнтблок", "сайлент", "сайлентблок важеля", "сайлентблок рычага", "сайлентблок подвески", "control arm bushing"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-ball-joint",
    type: "PART",
    category: "Ходова / підвіска",
    canonicalName: "Шарова опора",
    canonicalCode: "BALL_JOINT",
    aliases: ["шарова", "шарова опора", "кульова опора", "шаровая", "шаровая опора", "шарова нижня", "шарова верхня", "ball joint"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-shock-absorber",
    type: "PART",
    category: "Ходова / підвіска",
    canonicalName: "Амортизатор",
    canonicalCode: "SHOCK_ABSORBER",
    aliases: ["амортизатор", "аморт", "амортизатор передній", "амортизатор задній", "стойка", "стойка амортизатора", "стійка", "стійка амортизатора", "shock absorber"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-coil-spring",
    type: "PART",
    category: "Ходова / підвіска",
    canonicalName: "Пружина підвіски",
    canonicalCode: "COIL_SPRING",
    aliases: ["пружина", "пружина підвіски", "пружини", "пружина передня", "пружина задня", "пружына", "coil spring"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-stabilizer-link",
    type: "PART",
    category: "Ходова / підвіска",
    canonicalName: "Стійка стабілізатора",
    canonicalCode: "STABILIZER_LINK",
    aliases: ["стійка стабілізатора", "стойка стабилизатора", "стійка стаба", "стойка стаба", "тяга стабілізатора", "тяга стабилизатора", "линк стабилизатора", "stabilizer link"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-stabilizer-bushing",
    type: "PART",
    category: "Ходова / підвіска",
    canonicalName: "Втулка стабілізатора",
    canonicalCode: "STABILIZER_BUSHING",
    aliases: ["втулка стабілізатора", "втулка стабилизатора", "втулка стаба", "резинка стабілізатора", "резинка стабилизатора", "stabilizer bushing"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-wheel-bearing",
    type: "PART",
    category: "Ходова / підвіска",
    canonicalName: "Підшипник ступиці",
    canonicalCode: "WHEEL_HUB_BEARING",
    aliases: ["підшипник ступиці", "ступичний підшипник", "ступічний підшипник", "подшипник ступицы", "ступичный подшипник", "подшибник ступицы", "підшипник маточини", "wheel bearing"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-wheel-hub",
    type: "PART",
    category: "Ходова / підвіска",
    canonicalName: "Ступиця в зборі",
    canonicalCode: "WHEEL_HUB_ASSEMBLY",
    aliases: ["ступиця", "ступиця в зборі", "маточина", "маточина в зборі", "ступица", "ступица в сборе", "wheel hub", "wheel hub assembly"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-tie-rod-end",
    type: "PART",
    category: "Рульове керування",
    canonicalName: "Наконечник рульової тяги",
    canonicalCode: "TIE_ROD_END",
    aliases: ["наконечник", "накінечник", "накінечнік", "рульовий наконечник", "наконечник рульової тяги", "наконечник тяги", "рулевой наконечник", "наконечник рулевой тяги", "tie rod end"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-tie-rod",
    type: "PART",
    category: "Рульове керування",
    canonicalName: "Рульова тяга",
    canonicalCode: "TIE_ROD",
    aliases: ["рульова тяга", "тяга рульова", "рулевая тяга", "тяга рулевая", "тяга", "рульова", "tie rod"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-steering-rack",
    type: "PART",
    category: "Рульове керування",
    canonicalName: "Рульова рейка",
    canonicalCode: "STEERING_RACK",
    aliases: ["рульова рейка", "рейка", "рулевая рейка", "рейка рулевая", "steering rack"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-cv-joint",
    type: "PART",
    category: "Привід",
    canonicalName: "ШРУС",
    canonicalCode: "CV_JOINT",
    aliases: ["шрус", "граната", "наружный шрус", "внутренний шрус", "зовнішній шрус", "внутрішній шрус", "cv joint"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-axle-shaft",
    type: "PART",
    category: "Привід",
    canonicalName: "Піввісь",
    canonicalCode: "AXLE_SHAFT",
    aliases: ["піввісь", "полуось", "привід", "привод", "вал приводу", "приводной вал", "axle shaft"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-cv-boot",
    type: "PART",
    category: "Привід",
    canonicalName: "Пильник ШРУСа",
    canonicalCode: "CV_BOOT",
    aliases: ["пильник", "пильник шруса", "пыльник", "пыльник шруса", "пильник гранати", "пыльник гранаты", "cv boot"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-brake-pads",
    type: "PART",
    category: "Гальмівна система",
    canonicalName: "Гальмівні колодки",
    canonicalCode: "BRAKE_PAD",
    aliases: ["гальмівні колодки", "гальмівна колодка", "колодки", "передні колодки", "задні колодки", "тормозні колодки", "тормозные колодки", "тормозна колодка", "brake pads"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-brake-disc",
    type: "PART",
    category: "Гальмівна система",
    canonicalName: "Гальмівний диск",
    canonicalCode: "BRAKE_DISC",
    aliases: ["гальмівний диск", "гальмівні диски", "диск гальмівний", "тормозной диск", "тормозные диски", "диски тормозные", "brake disc", "brake rotor"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-brake-caliper",
    type: "PART",
    category: "Гальмівна система",
    canonicalName: "Гальмівний супорт",
    canonicalCode: "BRAKE_CALIPER",
    aliases: ["супорт", "суппорт", "гальмівний супорт", "тормозной суппорт", "супорта", "суппорта", "brake caliper"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-brake-hose",
    type: "PART",
    category: "Гальмівна система",
    canonicalName: "Гальмівний шланг",
    canonicalCode: "BRAKE_HOSE",
    aliases: ["гальмівний шланг", "тормозной шланг", "шланг гальмівний", "шланг тормозной", "brake hose"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-engine-oil",
    type: "PART",
    category: "ТО / рідини",
    canonicalName: "Мастило двигуна",
    canonicalCode: "ENGINE_OIL",
    aliases: ["мастило", "масло", "масло двигуна", "моторне масло", "моторное масло", "олива", "олива двигуна", "engine oil"],
  },
  {
    id: "part-oil-filter",
    type: "PART",
    category: "ТО / фільтри",
    canonicalName: "Масляний фільтр",
    canonicalCode: "OIL_FILTER",
    aliases: ["масляний фільтр", "фільтр масла", "масляный фильтр", "фильтр масла", "oil filter"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-air-filter",
    type: "PART",
    category: "ТО / фільтри",
    canonicalName: "Повітряний фільтр",
    canonicalCode: "AIR_FILTER",
    aliases: ["повітряний фільтр", "фільтр повітря", "воздушный фильтр", "фильтр воздуха", "air filter"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-cabin-filter",
    type: "PART",
    category: "ТО / фільтри",
    canonicalName: "Салонний фільтр",
    canonicalCode: "CABIN_FILTER",
    aliases: ["салонний фільтр", "фільтр салону", "салонный фильтр", "фильтр салона", "cabin filter"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-fuel-filter",
    type: "PART",
    category: "ТО / фільтри",
    canonicalName: "Паливний фільтр",
    canonicalCode: "FUEL_FILTER",
    aliases: ["паливний фільтр", "фільтр палива", "топливный фильтр", "фильтр топлива", "fuel filter"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-spark-plugs",
    type: "PART",
    category: "Двигун / запалювання",
    canonicalName: "Свічки запалювання",
    canonicalCode: "SPARK_PLUG",
    aliases: ["свічки", "свічки запалювання", "свечи", "свечи зажигания", "свічка", "свеча", "spark plugs"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-timing-belt",
    type: "PART",
    category: "Двигун / ГРМ",
    canonicalName: "Ремінь ГРМ",
    canonicalCode: "TIMING_BELT",
    aliases: ["ремінь грм", "ремень грм", "грм", "timing belt"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-water-pump",
    type: "PART",
    category: "Система охолодження",
    canonicalName: "Помпа охолодження",
    canonicalCode: "WATER_PUMP",
    aliases: ["помпа", "водяна помпа", "насос охолодження", "водяной насос", "помпа охлаждения", "water pump"],
    requiresFitmentCheck: true,
  },
  {
    id: "part-coolant",
    type: "PART",
    category: "ТО / рідини",
    canonicalName: "Охолоджувальна рідина",
    canonicalCode: "COOLANT",
    aliases: ["антифриз", "охолоджувальна рідина", "охолоджуюча рідина", "тосол", "coolant"],
  },
];

const SERVICES: CrmDictionaryEntry[] = [
  { id: "service-suspension-diagnostic", type: "SERVICE", category: "Діагностика", canonicalName: "Діагностика ходової", aliases: ["діагностика ходової", "діагностика підвіски", "ходовка діагностика", "диагностика ходовой", "диагностика подвески", "перевірка ходової"] },
  { id: "service-computer-diagnostic", type: "SERVICE", category: "Діагностика", canonicalName: "Комп'ютерна діагностика", aliases: ["комп'ютерна діагностика", "компютерна діагностика", "комп діагностика", "компьютерная диагностика", "діагностика помилок", "ошибки", "check engine"] },
  { id: "service-brake-diagnostic", type: "SERVICE", category: "Діагностика", canonicalName: "Діагностика гальмівної системи", aliases: ["діагностика гальм", "гальма діагностика", "тормоза диагностика", "діагностика тормозів", "перевірка гальм"] },
  { id: "service-maintenance", type: "SERVICE", category: "ТО", canonicalName: "Планове ТО", aliases: ["то", "планове то", "технічне обслуговування", "техническое обслуживание", "обслуживание", "регламентне то"] },
  { id: "service-oil-change", type: "SERVICE", category: "ТО", canonicalName: "Заміна мастила та фільтрів", aliases: ["заміна мастила", "заміна масла", "масло поміняти", "поміняти масло", "замена масла", "замена масла и фильтров", "масло фільтр"] },
  { id: "service-suspension-repair", type: "SERVICE", category: "Ремонт", canonicalName: "Ремонт ходової", aliases: ["ремонт ходової", "ремонт підвіски", "ходова ремонт", "ремонт ходовки", "ремонт подвески", "ходовка"] },
  { id: "service-brake-repair", type: "SERVICE", category: "Ремонт", canonicalName: "Ремонт гальмівної системи", aliases: ["ремонт гальм", "ремонт тормозів", "ремонт тормозов", "гальма", "тормоза", "торможа", "тормоз"] },
  { id: "service-pad-replacement", type: "SERVICE", category: "Ремонт", canonicalName: "Заміна гальмівних колодок", aliases: ["заміна колодок", "замена колодок", "поміняти колодки", "колодки заміна", "колодки"] },
  { id: "service-disc-replacement", type: "SERVICE", category: "Ремонт", canonicalName: "Заміна гальмівних дисків", aliases: ["заміна дисків", "замена дисков", "гальмівні диски заміна", "тормозные диски замена"] },
  { id: "service-caliper-service", type: "SERVICE", category: "Ремонт", canonicalName: "Обслуговування гальмівних супортів", aliases: ["ремонт супортів", "обслуговування супортів", "ремонт суппортов", "обслуживание суппортов", "супорта обслужити"] },
  { id: "service-timing-belt", type: "SERVICE", category: "Двигун", canonicalName: "Заміна комплекту ГРМ", aliases: ["заміна грм", "грм заміна", "замена грм", "ремінь грм заміна", "ремень грм замена"] },
  { id: "service-pre-purchase", type: "SERVICE", category: "Діагностика", canonicalName: "Огляд авто перед купівлею", aliases: ["огляд перед купівлею", "перевірка перед покупкою", "проверка перед покупкой", "діагностика перед купівлею"] },
];

const SYMPTOMS: CrmDictionaryEntry[] = [
  { id: "symptom-knock", type: "SYMPTOM", category: "Симптоми", canonicalName: "Стук у ходовій", aliases: ["стук", "стукає", "стучит", "стук ходової", "стук подвески", "гримить", "гремит"] },
  { id: "symptom-squeak", type: "SYMPTOM", category: "Симптоми", canonicalName: "Скрип", aliases: ["скрип", "скрипить", "пищить", "пищать тормоза", "скрип гальм", "скрип тормозов"] },
  { id: "symptom-vibration", type: "SYMPTOM", category: "Симптоми", canonicalName: "Вібрація", aliases: ["вібрація", "вибрация", "трясе", "трусить", "дрожит", "вібрація керма"] },
  { id: "symptom-steering-shake", type: "SYMPTOM", category: "Симптоми", canonicalName: "Б'є кермо", aliases: ["б'є кермо", "бє кермо", "бьет руль", "б'є руль", "кермо б'є", "руль бьет"] },
  { id: "symptom-pulls-side", type: "SYMPTOM", category: "Симптоми", canonicalName: "Авто веде вбік", aliases: ["веде вбік", "веде вправо", "веде вліво", "тянет вправо", "тянет влево", "тягне в сторону"] },
  { id: "symptom-check-engine", type: "SYMPTOM", category: "Симптоми", canonicalName: "Горить Check Engine", aliases: ["чек", "check", "check engine", "горить чек", "горит чек", "помилка двигуна"] },
];

const PROCESSES: CrmDictionaryEntry[] = [
  { id: "process-diagnostic-card", type: "PROCESS", category: "CRM-процеси", canonicalName: "Діагностична карта", aliases: ["дк", "діагностична карта", "диагностическая карта", "карта діагностики"] },
  { id: "process-commercial-offer", type: "PROCESS", category: "CRM-процеси", canonicalName: "Комерційна пропозиція", aliases: ["кп", "комерційна пропозиція", "комерческое предложение", "прорахунок", "кошторис", "смета"] },
  { id: "process-work-order", type: "PROCESS", category: "CRM-процеси", canonicalName: "Наряд-замовлення", aliases: ["наряд", "наряд замовлення", "заказ наряд", "наряд-заказ", "робочий наряд"] },
  { id: "process-parts-selection", type: "PROCESS", category: "CRM-процеси", canonicalName: "Підбір запчастин", aliases: ["підбір", "підбір запчастин", "подбор запчастей", "запчастини", "деталі", "детали"] },
];

export const DEFAULT_CRM_DICTIONARY: CrmDictionary = {
  version: 1,
  updatedBy: "Turbo LEV base dictionary",
  entries: [...PARTS, ...SERVICES, ...SYMPTOMS, ...PROCESSES],
};

export function normalizeCrmDictionaryTerm(value: unknown) {
  return typeof value === "string"
    ? value
      .trim()
      .toLocaleLowerCase("uk-UA")
      .replace(/[ё]/gu, "е")
      .replace(/[’'`]/gu, "")
      .replace(/[_-]+/g, " ")
      .replace(/[^a-zа-яіїєґ0-9]+/giu, " ")
      .replace(/\s+/g, " ")
      .trim()
    : "";
}

function normalizeEntry(entry: CrmDictionaryEntry): CrmDictionaryEntry {
  const aliases = [...new Set([entry.canonicalName, ...(entry.aliases || [])].map((item) => item.trim()).filter(Boolean))];
  return { ...entry, aliases };
}

export function normalizeCrmDictionary(input: unknown): CrmDictionary {
  const source = input && typeof input === "object" ? input as Partial<CrmDictionary> : DEFAULT_CRM_DICTIONARY;
  const entries = Array.isArray(source.entries) ? source.entries : DEFAULT_CRM_DICTIONARY.entries;
  return {
    version: 1,
    updatedBy: typeof source.updatedBy === "string" ? source.updatedBy : "CRM",
    entries: entries
      .filter((entry): entry is CrmDictionaryEntry => Boolean(entry && typeof entry.id === "string" && typeof entry.canonicalName === "string" && Array.isArray(entry.aliases)))
      .map(normalizeEntry),
  };
}

export function findCrmDictionaryMatches(query: string, dictionary: CrmDictionary = DEFAULT_CRM_DICTIONARY, limit = 12): CrmDictionaryMatch[] {
  const normalizedInput = normalizeCrmDictionaryTerm(query);
  if (normalizedInput.length < 2) return [];
  const matches: CrmDictionaryMatch[] = [];
  for (const entry of dictionary.entries.map(normalizeEntry)) {
    const aliases = entry.aliases.map((alias) => ({ raw: alias, normalized: normalizeCrmDictionaryTerm(alias) })).filter((alias) => alias.normalized.length >= 2);
    for (const alias of aliases) {
      if (alias.normalized === normalizedInput) {
        matches.push({ input: query, normalizedInput, entry, matchedAlias: alias.raw, matchType: "EXACT", score: 1000 + alias.normalized.length });
        continue;
      }
      if (normalizedInput.includes(alias.normalized) && alias.normalized.length >= 4) {
        matches.push({ input: query, normalizedInput, entry, matchedAlias: alias.raw, matchType: "CONTAINS", score: 400 + alias.normalized.length });
      }
    }
  }
  const byEntry = new Map<string, CrmDictionaryMatch>();
  for (const match of matches.sort((a, b) => b.score - a.score || a.entry.canonicalName.localeCompare(b.entry.canonicalName, "uk"))) {
    if (!byEntry.has(match.entry.id)) byEntry.set(match.entry.id, match);
  }
  return [...byEntry.values()].slice(0, Math.max(1, Math.min(50, limit)));
}

export function resolveCrmDictionaryTerm(query: string, dictionary: CrmDictionary = DEFAULT_CRM_DICTIONARY) {
  return findCrmDictionaryMatches(query, dictionary, 1)[0] || null;
}

export function getCrmDictionaryStats(dictionary: CrmDictionary) {
  const entries = dictionary.entries.map(normalizeEntry);
  const aliases = entries.reduce((sum, entry) => sum + entry.aliases.length, 0);
  return {
    entries: entries.length,
    aliases,
    parts: entries.filter((entry) => entry.type === "PART").length,
    services: entries.filter((entry) => entry.type === "SERVICE").length,
    symptoms: entries.filter((entry) => entry.type === "SYMPTOM").length,
    processes: entries.filter((entry) => entry.type === "PROCESS").length,
    fitmentGuarded: entries.filter((entry) => entry.requiresFitmentCheck).length,
  };
}

export function normalizeUnknownTerms(input: unknown): CrmDictionaryUnknownTerms {
  const source = input && typeof input === "object" ? input as Partial<CrmDictionaryUnknownTerms> : {};
  const terms = Array.isArray(source.terms) ? source.terms : [];
  return {
    version: 1,
    terms: terms
      .filter((term): term is CrmDictionaryUnknownTerm => Boolean(
        term
        && typeof term.rawTerm === "string"
        && typeof term.normalizedTerm === "string"
        && typeof term.count === "number",
      ))
      .map((term) => ({
        rawTerm: term.rawTerm.slice(0, 240),
        normalizedTerm: term.normalizedTerm.slice(0, 240),
        count: Math.max(1, Math.floor(term.count)),
        source: typeof term.source === "string" ? term.source.slice(0, 64) : "CRM",
        firstSeenAt: typeof term.firstSeenAt === "string" ? term.firstSeenAt : new Date().toISOString(),
        lastSeenAt: typeof term.lastSeenAt === "string" ? term.lastSeenAt : new Date().toISOString(),
      }))
      .sort((a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 300),
  };
}

export async function loadCrmDictionary() {
  const prisma = getPrisma();
  const row = await prisma.crmSetting.findUnique({ where: { key: CRM_DICTIONARY_SETTING_KEY } });
  return normalizeCrmDictionary(row?.value || DEFAULT_CRM_DICTIONARY);
}

export async function saveCrmDictionary(dictionary: unknown, updatedBy = "CRM") {
  const normalized = normalizeCrmDictionary({ ...(dictionary as Record<string, unknown>), updatedBy });
  const prisma = getPrisma();
  await prisma.crmSetting.upsert({
    where: { key: CRM_DICTIONARY_SETTING_KEY },
    update: { value: normalized, updatedAt: new Date() },
    create: { key: CRM_DICTIONARY_SETTING_KEY, value: normalized },
  });
  return normalized;
}

export async function loadCrmDictionaryUnknownTerms() {
  const prisma = getPrisma();
  const row = await prisma.crmSetting.findUnique({ where: { key: CRM_DICTIONARY_UNKNOWN_TERMS_SETTING_KEY } });
  return normalizeUnknownTerms(row?.value);
}

export async function observeUnknownCrmDictionaryTerm(rawTerm: string, source = "GLOBAL_SEARCH") {
  const normalizedTerm = normalizeCrmDictionaryTerm(rawTerm);
  if (normalizedTerm.length < 2) return null;

  const prisma = getPrisma();
  const current = await loadCrmDictionaryUnknownTerms();
  const now = new Date().toISOString();
  const existing = current.terms.find((term) => term.normalizedTerm === normalizedTerm);
  const nextTerms = existing
    ? current.terms.map((term) => term.normalizedTerm === normalizedTerm
      ? { ...term, rawTerm: rawTerm.slice(0, 240), count: term.count + 1, source, lastSeenAt: now }
      : term)
    : [{ rawTerm: rawTerm.slice(0, 240), normalizedTerm, count: 1, source, firstSeenAt: now, lastSeenAt: now }, ...current.terms];
  const next = normalizeUnknownTerms({ version: 1, terms: nextTerms });

  await prisma.crmSetting.upsert({
    where: { key: CRM_DICTIONARY_UNKNOWN_TERMS_SETTING_KEY },
    update: { value: next, updatedAt: new Date() },
    create: { key: CRM_DICTIONARY_UNKNOWN_TERMS_SETTING_KEY, value: next },
  });

  return next.terms.find((term) => term.normalizedTerm === normalizedTerm) || null;
}