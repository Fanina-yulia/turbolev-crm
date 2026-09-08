/**
 * The mechanic's vocabulary is deliberately kept separate from supplier
 * adapters.  A diagnostic checkbox produces one of these canonical codes;
 * supplier-specific terms are only aliases used when querying BM Parts and
 * Unitrade.
 */

export type MechanicPartAxis = "FRONT" | "REAR" | null;
export type MechanicPartSide = "LEFT" | "RIGHT" | null;
export type MechanicPartSubPosition = "FRONT" | "REAR" | "UPPER" | "LOWER" | null;

export type MechanicPartDefinition = {
  slug: string;
  code: string;
  canonicalName: string;
  category: string;
  aliases: readonly string[];
  providerTerms: {
    BM_PARTS: readonly string[];
    UNITRADE: readonly string[];
  };
  searchable?: boolean;
};

export type MechanicPartMapping = {
  code: string;
  slug: string;
  canonicalName: string;
  displayName: string;
  query: string;
  category: string;
  axis: MechanicPartAxis;
  side: MechanicPartSide;
  subPosition: MechanicPartSubPosition;
  position: string | null;
  itemCode: string;
  searchable: boolean;
};

/** Terms not present in the original small bootstrap vocabulary. */
export const MECHANIC_PART_DEFINITIONS: readonly MechanicPartDefinition[] = [
  {
    slug: "control-arm",
    code: "CONTROL_ARM",
    canonicalName: "Важіль підвіски",
    category: "suspension",
    aliases: ["важіль підвіски", "передній важіль", "важіль", "рычаг подвески", "рычаг", "control arm"],
    providerTerms: {
      BM_PARTS: ["рычаг подвески", "рычаг передний", "рычаг"],
      UNITRADE: ["важіль підвіски", "важіль передній", "важіль"],
    },
  },
  {
    slug: "front-arm-front-bushing",
    code: "FRONT_ARM_FRONT_BUSHING",
    canonicalName: "Передній сайлентблок переднього важеля",
    category: "suspension",
    aliases: [
      "передній сайлентблок переднього важеля",
      "передній сайлентблок важеля",
      "передний сайлентблок переднего рычага",
      "передний сайлентблок рычага",
    ],
    providerTerms: {
      BM_PARTS: ["сайлентблок переднего рычага передний", "передний сайлентблок рычага"],
      UNITRADE: ["передній сайлентблок переднього важеля", "передній сайлентблок важеля"],
    },
  },
  {
    slug: "front-arm-rear-bushing",
    code: "FRONT_ARM_REAR_BUSHING",
    canonicalName: "Задній сайлентблок переднього важеля",
    category: "suspension",
    aliases: [
      "задній сайлентблок переднього важеля",
      "задній сайлентблок важеля",
      "задний сайлентблок переднего рычага",
      "задний сайлентблок рычага",
    ],
    providerTerms: {
      BM_PARTS: ["сайлентблок переднего рычага задний", "задний сайлентблок рычага"],
      UNITRADE: ["задній сайлентблок переднього важеля", "задній сайлентблок важеля"],
    },
  },
  {
    slug: "stabilizer-link",
    code: "STABILIZER_LINK",
    canonicalName: "Стійка стабілізатора",
    category: "suspension",
    aliases: [
      "стійка стабілізатора",
      "тяга стабілізатора",
      "кісточка",
      "косточка",
      "стійка стабилизатора",
      "стойка стабилизатора",
      "тяга стабилизатора",
      "стойка стабилизатора",
      "stabilizer link",
      "sway bar link",
    ],
    providerTerms: {
      BM_PARTS: ["стойка стабилизатора", "тяга стабилизатора", "косточка стабилизатора"],
      UNITRADE: ["стійка стабілізатора", "тяга стабілізатора", "кісточка стабілізатора"],
    },
  },
  {
    slug: "stabilizer-bushing",
    code: "STABILIZER_BUSHING",
    canonicalName: "Втулка стабілізатора",
    category: "suspension",
    aliases: ["втулка стабілізатора", "втулки стабілізатора", "втулка стабилизатора", "втулки стабилизатора", "stabilizer bushing", "sway bar bushing"],
    providerTerms: {
      BM_PARTS: ["втулка стабилизатора", "втулки стабилизатора"],
      UNITRADE: ["втулка стабілізатора", "втулки стабілізатора"],
    },
  },
  {
    slug: "tie-rod",
    code: "TIE_ROD",
    canonicalName: "Рульова тяга",
    category: "steering",
    aliases: ["рульова тяга", "рулевая тяга", "тяга рульова", "тяга рулевая", "tie rod", "steering tie rod"],
    providerTerms: {
      BM_PARTS: ["рулевая тяга", "тяга рулевая"],
      UNITRADE: ["рульова тяга", "тяга рульова"],
    },
  },
  {
    slug: "steering-rack-boot",
    code: "STEERING_RACK_BOOT",
    canonicalName: "Пильник рульової рейки",
    category: "steering",
    aliases: ["пильник рульової рейки", "пильник рейки", "пыльник рулевой рейки", "пыльник рейки", "steering rack boot"],
    providerTerms: {
      BM_PARTS: ["пыльник рулевой рейки", "пыльник рейки"],
      UNITRADE: ["пильник рульової рейки", "пильник рейки"],
    },
  },
  {
    slug: "steering-rack",
    code: "STEERING_RACK",
    canonicalName: "Рульова рейка",
    category: "steering",
    aliases: ["рульова рейка", "рулевая рейка", "рейка рульова", "steering rack"],
    providerTerms: {
      BM_PARTS: ["рулевая рейка", "рейка рулевая"],
      UNITRADE: ["рульова рейка", "рейка рульова"],
    },
  },
  {
    slug: "brake-caliper",
    code: "BRAKE_CALIPER",
    canonicalName: "Гальмівний супорт",
    category: "brakes",
    aliases: ["гальмівний супорт", "передній супорт", "задній супорт", "супорт", "тормозной суппорт", "суппорт", "brake caliper"],
    providerTerms: {
      BM_PARTS: ["тормозной суппорт", "суппорт тормозной"],
      UNITRADE: ["гальмівний супорт", "супорт гальмівний"],
    },
  },
  {
    slug: "brake-hose",
    code: "BRAKE_HOSE",
    canonicalName: "Гальмівний шланг",
    category: "brakes",
    aliases: ["гальмівний шланг", "передній гальмівний шланг", "задній гальмівний шланг", "тормозной шланг", "brake hose"],
    providerTerms: {
      BM_PARTS: ["тормозной шланг", "шланг тормозной"],
      UNITRADE: ["гальмівний шланг", "шланг гальмівний"],
    },
  },
  {
    slug: "outer-cv-joint",
    code: "CV_OUTER_JOINT",
    canonicalName: "Зовнішній ШРУС",
    category: "drive",
    aliases: ["зовнішній шрус", "зовнішній ШРУС", "шрус зовнішній", "наружный шрус", "шрус наружный", "зовнішня граната", "наружная граната", "outer cv joint"],
    providerTerms: {
      BM_PARTS: ["шрус наружный", "граната наружная", "наружный шарнир"],
      UNITRADE: ["шрус зовнішній", "граната зовнішня", "зовнішній шарнір"],
    },
  },
  {
    slug: "inner-cv-joint",
    code: "CV_INNER_JOINT",
    canonicalName: "Внутрішній ШРУС",
    category: "drive",
    aliases: ["внутрішній шрус", "внутренний шрус", "шрус внутрішній", "шрус внутренний", "внутрішня граната", "внутренняя граната", "inner cv joint"],
    providerTerms: {
      BM_PARTS: ["шрус внутренний", "граната внутренняя", "внутренний шарнир"],
      UNITRADE: ["шрус внутрішній", "граната внутрішня", "внутрішній шарнір"],
    },
  },
  {
    slug: "outer-cv-boot",
    code: "CV_OUTER_BOOT",
    canonicalName: "Пильник зовнішнього ШРУСа",
    category: "drive",
    aliases: ["пильник зовнішнього шруса", "пильник зовнішній шрус", "пыльник наружного шруса", "пыльник шруса наружный", "outer cv boot"],
    providerTerms: {
      BM_PARTS: ["пыльник шруса наружный", "пыльник наружного шруса"],
      UNITRADE: ["пильник зовнішнього шруса", "пильник зовнішній шрус"],
    },
  },
  {
    slug: "inner-cv-boot",
    code: "CV_INNER_BOOT",
    canonicalName: "Пильник внутрішнього ШРУСа",
    category: "drive",
    aliases: ["пильник внутрішнього шруса", "пильник внутрішній шрус", "пыльник внутреннего шруса", "пыльник шруса внутренний", "inner cv boot"],
    providerTerms: {
      BM_PARTS: ["пыльник шруса внутренний", "пыльник внутреннего шруса"],
      UNITRADE: ["пильник внутрішнього шруса", "пильник внутрішній шрус"],
    },
  },
  {
    slug: "driveshaft",
    code: "DRIVESHAFT",
    canonicalName: "Піввісь",
    category: "drive",
    aliases: ["піввісь", "піввісь приводу", "полуось", "приводний вал", "drive shaft", "driveshaft"],
    providerTerms: {
      BM_PARTS: ["полуось", "приводной вал", "полуось приводная"],
      UNITRADE: ["піввісь", "приводний вал", "піввісь приводу"],
    },
  },
  {
    slug: "rear-upper-lateral-link",
    code: "REAR_UPPER_LATERAL_LINK",
    canonicalName: "Верхня поперечна тяга",
    category: "suspension",
    aliases: ["верхня поперечна тяга", "верхня поперечна", "верхний поперечный рычаг", "верхняя поперечная тяга", "upper lateral link"],
    providerTerms: {
      BM_PARTS: ["верхняя поперечная тяга", "верхний поперечный рычаг"],
      UNITRADE: ["верхня поперечна тяга", "верхній поперечний важіль"],
    },
  },
  {
    slug: "rear-upper-lateral-link-bushing",
    code: "REAR_UPPER_LATERAL_LINK_BUSHING",
    canonicalName: "Сайлентблок верхньої поперечної тяги",
    category: "suspension",
    aliases: ["сайлентблок верхньої поперечної тяги", "сайлентблок верхньої тяги", "сайлентблок верхнего поперечного рычага", "сайлентблок верхней поперечной тяги", "upper lateral link bushing"],
    providerTerms: {
      BM_PARTS: ["сайлентблок верхней поперечной тяги", "сайлентблок верхнего поперечного рычага"],
      UNITRADE: ["сайлентблок верхньої поперечної тяги", "сайлентблок верхньої тяги"],
    },
  },
  {
    slug: "rear-lower-lateral-link",
    code: "REAR_LOWER_LATERAL_LINK",
    canonicalName: "Нижня поперечна тяга",
    category: "suspension",
    aliases: ["нижня поперечна тяга", "нижня поперечна", "нижний поперечный рычаг", "нижняя поперечная тяга", "lower lateral link"],
    providerTerms: {
      BM_PARTS: ["нижняя поперечная тяга", "нижний поперечний рычаг"],
      UNITRADE: ["нижня поперечна тяга", "нижній поперечний важіль"],
    },
  },
  {
    slug: "rear-lower-lateral-link-bushing",
    code: "REAR_LOWER_LATERAL_LINK_BUSHING",
    canonicalName: "Сайлентблок нижньої поперечної тяги",
    category: "suspension",
    aliases: ["сайлентблок нижньої поперечної тяги", "сайлентблок нижньої тяги", "сайлентблок нижнего поперечного рычага", "сайлентблок нижней поперечной тяги", "lower lateral link bushing"],
    providerTerms: {
      BM_PARTS: ["сайлентблок нижней поперечной тяги", "сайлентблок нижнего поперечного рычага"],
      UNITRADE: ["сайлентблок нижньої поперечної тяги", "сайлентблок нижньої тяги"],
    },
  },
  {
    slug: "rear-trailing-link",
    code: "REAR_TRAILING_LINK",
    canonicalName: "Поздовжня тяга",
    category: "suspension",
    aliases: ["поздовжня тяга", "поздовжня тяга задньої підвіски", "продольная тяга", "продольный рычаг", "trailing link"],
    providerTerms: {
      BM_PARTS: ["продольная тяга", "продольный рычаг"],
      UNITRADE: ["поздовжня тяга", "поздовжній важіль"],
    },
  },
  {
    slug: "rear-trailing-link-bushing",
    code: "REAR_TRAILING_LINK_BUSHING",
    canonicalName: "Сайлентблок поздовжньої тяги",
    category: "suspension",
    aliases: ["сайлентблок поздовжньої тяги", "сайлентблок продольной тяги", "сайлентблок продольного рычага", "trailing link bushing"],
    providerTerms: {
      BM_PARTS: ["сайлентблок продольной тяги", "сайлентблок продольного рычага"],
      UNITRADE: ["сайлентблок поздовжньої тяги", "сайлентблок поздовжнього важеля"],
    },
  },
  {
    slug: "rear-trailing-arm",
    code: "REAR_TRAILING_ARM",
    canonicalName: "Поздовжній важіль",
    category: "suspension",
    aliases: ["поздовжній важіль", "продольный рычаг", "поздовжній важіль задньої підвіски", "trailing arm"],
    providerTerms: {
      BM_PARTS: ["продольный рычаг", "рычаг задней подвески продольный"],
      UNITRADE: ["поздовжній важіль", "важіль задньої підвіски поздовжній"],
    },
  },
  {
    slug: "rear-trailing-arm-bushing",
    code: "REAR_TRAILING_ARM_BUSHING",
    canonicalName: "Сайлентблок поздовжнього важеля",
    category: "suspension",
    aliases: ["сайлентблок поздовжнього важеля", "сайлентблок продольного рычага", "сайлентблок поздовжнього важеля задньої підвіски", "trailing arm bushing"],
    providerTerms: {
      BM_PARTS: ["сайлентблок продольного рычага", "сайлентблок продольного рычага задний"],
      UNITRADE: ["сайлентблок поздовжнього важеля", "сайлентблок поздовжнього важеля задньої підвіски"],
    },
  },
  {
    slug: "strut-mount",
    code: "STRUT_MOUNT",
    canonicalName: "Опора амортизатора",
    category: "suspension",
    aliases: ["опора амортизатора", "опора стійки", "верхня опора амортизатора", "опора стойки", "опора амортизатора", "strut mount"],
    providerTerms: {
      BM_PARTS: ["опора амортизатора", "опора стойки", "верхняя опора стойки"],
      UNITRADE: ["опора амортизатора", "опора стійки", "верхня опора стійки"],
    },
  },
  {
    slug: "engine-oil",
    code: "ENGINE_OIL",
    canonicalName: "Моторна олива",
    category: "fluid",
    aliases: ["моторна олива", "моторне масло", "масло двигуна", "моторное масло", "engine oil"],
    providerTerms: { BM_PARTS: ["моторное масло"], UNITRADE: ["моторна олива", "моторне масло"] },
    searchable: false,
  },
  {
    slug: "coolant",
    code: "COOLANT",
    canonicalName: "Охолоджувальна рідина",
    category: "fluid",
    aliases: ["охолоджувальна рідина", "антифриз", "охлаждающая жидкость", "coolant"],
    providerTerms: { BM_PARTS: ["антифриз", "охлаждающая жидкость"], UNITRADE: ["охолоджувальна рідина", "антифриз"] },
    searchable: false,
  },
  {
    slug: "brake-fluid",
    code: "BRAKE_FLUID",
    canonicalName: "Гальмівна рідина",
    category: "fluid",
    aliases: ["гальмівна рідина", "тормозная жидкость", "brake fluid"],
    providerTerms: { BM_PARTS: ["тормозная жидкость"], UNITRADE: ["гальмівна рідина"] },
    searchable: false,
  },
  {
    slug: "power-steering-fluid",
    code: "POWER_STEERING_FLUID",
    canonicalName: "Рідина ГПК",
    category: "fluid",
    aliases: ["рідина ГПК", "рідина гідропідсилювача", "жидкость гур", "power steering fluid"],
    providerTerms: { BM_PARTS: ["жидкость гур"], UNITRADE: ["рідина гпк", "рідина гідропідсилювача"] },
    searchable: false,
  },
  {
    slug: "transmission-oil",
    code: "TRANSMISSION_OIL",
    canonicalName: "Олива трансмісії / редуктора",
    category: "fluid",
    aliases: ["олива трансмісії", "олива редуктора", "масло кпп", "масло редуктора", "трансмісійна олива", "transmission oil"],
    providerTerms: { BM_PARTS: ["масло кпп", "масло редуктора"], UNITRADE: ["олива трансмісії", "олива редуктора"] },
    searchable: false,
  },
  {
    slug: "engine-sealing",
    code: "ENGINE_SEALING",
    canonicalName: "Герметичність двигуна",
    category: "engine",
    aliases: ["двигун загальна герметичність", "герметичність двигуна", "підтікання двигуна", "герметичность двигателя", "течь двигателя", "engine sealing"],
    providerTerms: { BM_PARTS: ["герметичность двигателя"], UNITRADE: ["герметичність двигуна"] },
    searchable: false,
  },
  {
    slug: "valve-cover",
    code: "VALVE_COVER",
    canonicalName: "Клапанна кришка",
    category: "engine",
    aliases: ["клапанна кришка", "кришка клапанів", "клапанная крышка", "крышка клапанов", "valve cover"],
    providerTerms: { BM_PARTS: ["клапанная крышка", "крышка клапанов"], UNITRADE: ["клапанна кришка", "кришка клапанів"] },
  },
  {
    slug: "engine-oil-pan",
    code: "ENGINE_OIL_PAN",
    canonicalName: "Піддон двигуна",
    category: "engine",
    aliases: ["піддон двигуна", "піддон мотора", "поддон двигателя", "поддон мотора", "oil pan"],
    providerTerms: { BM_PARTS: ["поддон двигателя", "поддон мотора"], UNITRADE: ["піддон двигуна", "піддон мотора"] },
  },
  {
    slug: "crankshaft-front-seal",
    code: "CRANKSHAFT_FRONT_SEAL",
    canonicalName: "Передній сальник колінвала",
    category: "engine",
    aliases: ["передній сальник колінвала", "передний сальник коленвала", "передній сальник коленвала", "front crankshaft seal"],
    providerTerms: { BM_PARTS: ["сальник коленвала передний"], UNITRADE: ["сальник колінвала передній"] },
  },
  {
    slug: "crankshaft-rear-seal",
    code: "CRANKSHAFT_REAR_SEAL",
    canonicalName: "Задній сальник колінвала",
    category: "engine",
    aliases: ["задній сальник колінвала", "задний сальник коленвала", "задній сальник коленвала", "rear crankshaft seal"],
    providerTerms: { BM_PARTS: ["сальник коленвала задний"], UNITRADE: ["сальник колінвала задній"] },
  },
  {
    slug: "cooling-system-hoses",
    code: "COOLING_SYSTEM_HOSES",
    canonicalName: "Система охолодження / патрубки",
    category: "engine",
    aliases: ["система охолодження", "патрубки охолодження", "система охлаждения", "патрубки охлаждения", "cooling system hose"],
    providerTerms: { BM_PARTS: ["система охлаждения", "патрубок охлаждения"], UNITRADE: ["система охолодження", "патрубок охолодження"] },
  },
  {
    slug: "transmission-case-sealing",
    code: "TRANSMISSION_CASE_SEALING",
    canonicalName: "Герметичність корпусу трансмісії",
    category: "transmission",
    aliases: ["корпус трансмісії", "стики трансмісії", "герметичність трансмісії", "корпус коробки", "стыки трансмиссии", "герметичность трансмиссии", "transmission case sealing"],
    providerTerms: { BM_PARTS: ["герметичность коробки передач"], UNITRADE: ["герметичність трансмісії"] },
    searchable: false,
  },
  {
    slug: "transmission-oil-pan",
    code: "TRANSMISSION_OIL_PAN",
    canonicalName: "Піддон КПП",
    category: "transmission",
    aliases: ["піддон КПП", "піддон коробки передач", "поддон кпп", "поддон коробки передач", "transmission oil pan"],
    providerTerms: { BM_PARTS: ["поддон кпп", "поддон коробки передач"], UNITRADE: ["піддон КПП", "піддон коробки передач"] },
  },
  {
    slug: "transmission-input-shaft-seal",
    code: "TRANSMISSION_INPUT_SHAFT_SEAL",
    canonicalName: "Сальник первинного валу КПП",
    category: "transmission",
    aliases: ["сальник первинного валу КПП", "сальник первинного вала", "сальник первичного вала кпп", "сальник первичного вала", "input shaft seal"],
    providerTerms: { BM_PARTS: ["сальник первичного вала кпп", "сальник первичного вала"], UNITRADE: ["сальник первинного валу КПП", "сальник первинного валу"] },
  },
  {
    slug: "axle-shaft-seal",
    code: "AXLE_SHAFT_SEAL",
    canonicalName: "Сальник півосі",
    category: "transmission",
    aliases: ["сальник півосі", "сальник полуоси", "сальник півосі передній", "сальник півосі задній", "axle shaft seal", "differential side seal"],
    providerTerms: { BM_PARTS: ["сальник полуоси", "сальник дифференциала"], UNITRADE: ["сальник півосі", "сальник диференціала"] },
  },
  {
    slug: "exhaust-manifold",
    code: "EXHAUST_MANIFOLD",
    canonicalName: "Випускний колектор",
    category: "exhaust",
    aliases: ["випускний колектор", "випускний колектор двигуна", "выпускной коллектор", "exhaust manifold"],
    providerTerms: { BM_PARTS: ["выпускной коллектор"], UNITRADE: ["випускний колектор"] },
  },
  {
    slug: "exhaust-flex-pipe",
    code: "EXHAUST_FLEX_PIPE",
    canonicalName: "Гофра вихлопної системи",
    category: "exhaust",
    aliases: ["гофра", "гофра вихлопної системи", "гофра вихлопу", "гофра выхлопной системы", "гибкая вставка выхлопа", "exhaust flex"],
    providerTerms: { BM_PARTS: ["гофра глушителя", "гофра выхлопной системы"], UNITRADE: ["гофра вихлопної системи", "гофра глушника"] },
  },
  {
    slug: "exhaust-front-pipe",
    code: "EXHAUST_FRONT_PIPE",
    canonicalName: "Приймальна труба",
    category: "exhaust",
    aliases: ["приймальна труба", "передня труба вихлопу", "приемная труба", "передняя труба выхлопа", "front exhaust pipe"],
    providerTerms: { BM_PARTS: ["приемная труба", "передняя труба выхлопа"], UNITRADE: ["приймальна труба", "передня труба вихлопу"] },
  },
  {
    slug: "catalytic-converter",
    code: "CATALYTIC_CONVERTER",
    canonicalName: "Каталізатор",
    category: "exhaust",
    aliases: ["каталізатор", "катализатор", "catalytic converter", "catalyst"],
    providerTerms: { BM_PARTS: ["катализатор"], UNITRADE: ["каталізатор"] },
  },
  {
    slug: "diesel-particulate-filter",
    code: "DIESEL_PARTICULATE_FILTER",
    canonicalName: "Сажовий фільтр / DPF",
    category: "exhaust",
    aliases: ["сажовий фільтр", "сажовий фільтр dpf", "сажевый фильтр", "dpf", "diesel particulate filter"],
    providerTerms: { BM_PARTS: ["сажевый фильтр", "dpf"], UNITRADE: ["сажовий фільтр", "dpf"] },
  },
  {
    slug: "resonator",
    code: "RESONATOR",
    canonicalName: "Резонатор",
    category: "exhaust",
    aliases: ["резонатор", "резонатор вихлопу", "резонатор выхлопа", "resonator"],
    providerTerms: { BM_PARTS: ["резонатор глушителя", "резонатор выхлопа"], UNITRADE: ["резонатор", "резонатор вихлопу"] },
  },
  {
    slug: "muffler",
    code: "MUFFLER",
    canonicalName: "Глушник",
    category: "exhaust",
    aliases: ["глушник", "задній глушник", "глушитель", "задняя банка", "muffler", "rear silencer"],
    providerTerms: { BM_PARTS: ["глушитель", "задняя банка"], UNITRADE: ["глушник", "задня банка"] },
  },
  {
    slug: "exhaust-hanger",
    code: "EXHAUST_HANGER",
    canonicalName: "Підвіси / кріплення вихлопу",
    category: "exhaust",
    aliases: ["підвіси вихлопу", "кріплення вихлопу", "підвіси глушника", "подвесы выхлопа", "крепления глушителя", "exhaust hanger"],
    providerTerms: { BM_PARTS: ["подвес глушителя", "крепление выхлопа"], UNITRADE: ["підвіс глушника", "кріплення вихлопу"] },
  },
  {
    slug: "exhaust-clamp",
    code: "EXHAUST_CLAMP",
    canonicalName: "З’єднання / хомути вихлопу",
    category: "exhaust",
    aliases: ["з’єднання вихлопу", "хомут вихлопу", "хомути вихлопу", "соединение выхлопа", "хомут выхлопа", "exhaust clamp"],
    providerTerms: { BM_PARTS: ["хомут выхлопной системы", "соединение выхлопа"], UNITRADE: ["хомут вихлопної системи", "з’єднання вихлопу"] },
  },
  {
    slug: "exhaust-system-sealing",
    code: "EXHAUST_SYSTEM_SEALING",
    canonicalName: "Герметичність вихлопної системи",
    category: "exhaust",
    aliases: ["герметичність вихлопної системи", "негерметичність вихлопу", "герметичность выхлопной системы", "негерметичность выхлопа", "exhaust sealing"],
    providerTerms: { BM_PARTS: ["герметичность выхлопной системы"], UNITRADE: ["герметичність вихлопної системи"] },
    searchable: false,
  },
] as const;

const SIDE_WORD: Record<Exclude<MechanicPartSide, null>, string> = {
  LEFT: "ліва сторона",
  RIGHT: "права сторона",
};

const AXIS_WORD: Record<Exclude<MechanicPartAxis, null>, string> = {
  FRONT: "передня вісь",
  REAR: "задня вісь",
};

const SUB_POSITION_WORD: Record<Exclude<MechanicPartSubPosition, null>, string> = {
  FRONT: "передній",
  REAR: "задній",
  UPPER: "верхній",
  LOWER: "нижній",
};

const SUB_POSITION_BY_CODE: Record<string, MechanicPartSubPosition> = {
  BUSH_FRONT_FL: "FRONT",
  BUSH_FRONT_FR: "FRONT",
  BUSH_REAR_FL: "REAR",
  BUSH_REAR_FR: "REAR",
  UPPER_LINK_BUSH_RL: "UPPER",
  UPPER_LINK_BUSH_RR: "UPPER",
  LOWER_LINK_BUSH_RL: "LOWER",
  LOWER_LINK_BUSH_RR: "LOWER",
  TRAILING_LINK_BUSH_RL: "REAR",
  TRAILING_LINK_BUSH_RR: "REAR",
  BUSH_RL: "REAR",
  BUSH_RR: "REAR",
};

const EXPLICIT_CODE_MAP: Record<string, string> = {
  SHOCK_FL: "SHOCK_ABSORBER", SHOCK_FR: "SHOCK_ABSORBER", SHOCK_RL: "SHOCK_ABSORBER", SHOCK_RR: "SHOCK_ABSORBER",
  SPRING_FL: "COIL_SPRING", SPRING_FR: "COIL_SPRING", SPRING_RL: "COIL_SPRING", SPRING_RR: "COIL_SPRING",
  MOUNT_FL: "STRUT_MOUNT", MOUNT_FR: "STRUT_MOUNT",
  BALL_FL: "BALL_JOINT", BALL_FR: "BALL_JOINT",
  ARM_FL: "CONTROL_ARM", ARM_FR: "CONTROL_ARM",
  BUSH_FRONT_FL: "FRONT_ARM_FRONT_BUSHING", BUSH_FRONT_FR: "FRONT_ARM_FRONT_BUSHING",
  BUSH_REAR_FL: "FRONT_ARM_REAR_BUSHING", BUSH_REAR_FR: "FRONT_ARM_REAR_BUSHING",
  STAB_LINK_FL: "STABILIZER_LINK", STAB_LINK_FR: "STABILIZER_LINK", STAB_LINK_RL: "STABILIZER_LINK", STAB_LINK_RR: "STABILIZER_LINK",
  BUSH_REAR: "REAR_TRAILING_ARM_BUSHING",
  BEARING_FL: "WHEEL_HUB_BEARING", BEARING_FR: "WHEEL_HUB_BEARING", BEARING_RL: "WHEEL_HUB_BEARING", BEARING_RR: "WHEEL_HUB_BEARING",
  STAB_BUSH: "STABILIZER_BUSHING", STAB_BUSH_FRONT: "STABILIZER_BUSHING", STAB_BUSH_REAR: "STABILIZER_BUSHING",
  TIE_FL: "TIE_ROD_END", TIE_FR: "TIE_ROD_END", TIE_END_FL: "TIE_ROD_END", TIE_END_FR: "TIE_ROD_END",
  TIE_ROD_FL: "TIE_ROD", TIE_ROD_FR: "TIE_ROD",
  RACK_BOOT_FL: "STEERING_RACK_BOOT", RACK_BOOT_FR: "STEERING_RACK_BOOT", RACK: "STEERING_RACK",
  CV_OUTER_FL: "CV_OUTER_JOINT", CV_OUTER_FR: "CV_OUTER_JOINT", CV_INNER_FL: "CV_INNER_JOINT", CV_INNER_FR: "CV_INNER_JOINT",
  CV_BOOT_FL: "CV_OUTER_BOOT", CV_BOOT_FR: "CV_OUTER_BOOT", CV_BOOT_INNER_FL: "CV_INNER_BOOT", CV_BOOT_INNER_FR: "CV_INNER_BOOT",
  DRIVESHAFT_FL: "DRIVESHAFT", DRIVESHAFT_FR: "DRIVESHAFT",
  PAD_FL: "BRAKE_PAD", PAD_FR: "BRAKE_PAD", PAD_RL: "BRAKE_PAD", PAD_RR: "BRAKE_PAD", PADS_FRONT: "BRAKE_PAD", PADS_REAR: "BRAKE_PAD",
  DISC_FL: "BRAKE_DISC", DISC_FR: "BRAKE_DISC", DISC_RL: "BRAKE_DISC", DISC_RR: "BRAKE_DISC", DISC_REAR: "BRAKE_DISC",
  CALIPER_FL: "BRAKE_CALIPER", CALIPER_FR: "BRAKE_CALIPER", CALIPER_RL: "BRAKE_CALIPER", CALIPER_RR: "BRAKE_CALIPER",
  HOSE_FL: "BRAKE_HOSE", HOSE_FR: "BRAKE_HOSE", HOSES: "BRAKE_HOSE",
  UPPER_LINK_RL: "REAR_UPPER_LATERAL_LINK", UPPER_LINK_RR: "REAR_UPPER_LATERAL_LINK",
  UPPER_LINK_BUSH_RL: "REAR_UPPER_LATERAL_LINK_BUSHING", UPPER_LINK_BUSH_RR: "REAR_UPPER_LATERAL_LINK_BUSHING",
  LOWER_LINK_RL: "REAR_LOWER_LATERAL_LINK", LOWER_LINK_RR: "REAR_LOWER_LATERAL_LINK",
  LOWER_LINK_BUSH_RL: "REAR_LOWER_LATERAL_LINK_BUSHING", LOWER_LINK_BUSH_RR: "REAR_LOWER_LATERAL_LINK_BUSHING",
  TRAILING_LINK_RL: "REAR_TRAILING_LINK", TRAILING_LINK_RR: "REAR_TRAILING_LINK",
  TRAILING_LINK_BUSH_RL: "REAR_TRAILING_LINK_BUSHING", TRAILING_LINK_BUSH_RR: "REAR_TRAILING_LINK_BUSHING",
  ARM_RL: "REAR_TRAILING_ARM", ARM_RR: "REAR_TRAILING_ARM",
  BUSH_RL: "REAR_TRAILING_ARM_BUSHING", BUSH_RR: "REAR_TRAILING_ARM_BUSHING",
  AXLE_SEAL_FL: "AXLE_SHAFT_SEAL", AXLE_SEAL_FR: "AXLE_SHAFT_SEAL", AXLE_SEAL_RL: "AXLE_SHAFT_SEAL", AXLE_SEAL_RR: "AXLE_SHAFT_SEAL",
  ENGINE_LEAK_GENERAL: "ENGINE_SEALING", VALVE_COVER_LEAK: "VALVE_COVER", ENGINE_PAN_LEAK: "ENGINE_OIL_PAN",
  CRANK_SEAL_FRONT: "CRANKSHAFT_FRONT_SEAL", CRANK_SEAL_REAR: "CRANKSHAFT_REAR_SEAL", COOLING_LEAK: "COOLING_SYSTEM_HOSES",
  GEARBOX_BODY_LEAK: "TRANSMISSION_CASE_SEALING", GEARBOX_PAN_LEAK: "TRANSMISSION_OIL_PAN", GEARBOX_INPUT_SEAL: "TRANSMISSION_INPUT_SHAFT_SEAL",
  EXHAUST_MANIFOLD: "EXHAUST_MANIFOLD", EXHAUST_FLEX: "EXHAUST_FLEX_PIPE", EXHAUST_FRONT_PIPE: "EXHAUST_FRONT_PIPE",
  CATALYST: "CATALYTIC_CONVERTER", DPF: "DIESEL_PARTICULATE_FILTER", RESONATOR: "RESONATOR", MUFFLER: "MUFFLER",
  EXHAUST_HANGERS: "EXHAUST_HANGER", EXHAUST_JOINTS: "EXHAUST_CLAMP", EXHAUST_TIGHTNESS: "EXHAUST_SYSTEM_SEALING",
  ENGINE_OIL_LEVEL: "ENGINE_OIL", ENGINE_OIL_CONDITION: "ENGINE_OIL", COOLANT_LEVEL: "COOLANT", COOLANT_CONDITION: "COOLANT",
  BRAKE_FLUID_LEVEL: "BRAKE_FLUID", BRAKE_FLUID_CONDITION: "BRAKE_FLUID", POWER_STEERING_LEVEL: "POWER_STEERING_FLUID", POWER_STEERING_CONDITION: "POWER_STEERING_FLUID",
  GEARBOX_OIL_LEVEL: "TRANSMISSION_OIL", GEARBOX_OIL_CONDITION: "TRANSMISSION_OIL",
};

const BASE_NAMES: Record<string, { name: string; slug: string; category: string; searchable?: boolean }> = {
  SHOCK_ABSORBER: { name: "Амортизатор", slug: "shock-absorber", category: "suspension" },
  COIL_SPRING: { name: "Пружина підвіски", slug: "coil-spring", category: "suspension" },
  STRUT_MOUNT: { name: "Опора амортизатора", slug: "strut-mount", category: "suspension" },
  BALL_JOINT: { name: "Кульова опора", slug: "ball-joint", category: "suspension" },
  WHEEL_HUB_BEARING: { name: "Ступичний підшипник", slug: "wheel-bearing", category: "suspension" },
  TIE_ROD_END: { name: "Рульовий наконечник", slug: "tie-rod-end", category: "steering" },
  BRAKE_PAD: { name: "Гальмівні колодки", slug: "brake-pad", category: "brakes" },
  BRAKE_DISC: { name: "Гальмівний диск", slug: "brake-disc", category: "brakes" },
  CV_JOINT: { name: "ШРУС", slug: "cv-joint", category: "drive" },
  ENGINE_OIL: { name: "Моторна олива", slug: "engine-oil", category: "fluid", searchable: false },
  COOLANT: { name: "Охолоджувальна рідина", slug: "coolant", category: "fluid", searchable: false },
  BRAKE_FLUID: { name: "Гальмівна рідина", slug: "brake-fluid", category: "fluid", searchable: false },
  POWER_STEERING_FLUID: { name: "Рідина ГПК", slug: "power-steering-fluid", category: "fluid", searchable: false },
  TRANSMISSION_OIL: { name: "Олива трансмісії / редуктора", slug: "transmission-oil", category: "fluid", searchable: false },
};

function sideFromItemCode(itemCode: string): MechanicPartSide {
  if (/(?:^|_)(FL|RL)$/u.test(itemCode)) return "LEFT";
  if (/(?:^|_)(FR|RR)$/u.test(itemCode)) return "RIGHT";
  return null;
}

function axisFromItemCode(itemCode: string, position?: string | null): MechanicPartAxis {
  if (/(?:^|_)(FL|FR)$/u.test(itemCode) || /FRONT/u.test(itemCode)) return "FRONT";
  if (/(?:^|_)(RL|RR)$/u.test(itemCode) || /REAR/u.test(itemCode)) return "REAR";
  const source = (position || "").toLocaleLowerCase("uk-UA");
  if (/(перед|front)/u.test(source)) return "FRONT";
  if (/(зад|rear)/u.test(source)) return "REAR";
  return null;
}

function definitionFor(code: string): { name: string; slug: string; category: string; searchable: boolean } {
  const extension = MECHANIC_PART_DEFINITIONS.find((item) => item.code === code);
  if (extension) return { name: extension.canonicalName, slug: extension.slug, category: extension.category, searchable: extension.searchable !== false };
  const base = BASE_NAMES[code];
  return base ? { ...base, searchable: base.searchable !== false } : { name: code, slug: code.toLocaleLowerCase("en-US"), category: "other", searchable: true };
}

export function canonicalCodeForDiagnosticItem(itemCode: string) {
  return EXPLICIT_CODE_MAP[itemCode] || null;
}

export function resolveMechanicDiagnosticPart(input: {
  itemCode?: string | null;
  itemName?: string | null;
  position?: string | null;
  sectionCode?: string | null;
}): MechanicPartMapping | null {
  const itemCode = (input.itemCode || "").trim().toUpperCase();
  if (!itemCode) return null;
  const code = canonicalCodeForDiagnosticItem(itemCode);
  if (!code) return null;
  const definition = definitionFor(code);
  const axis = axisFromItemCode(itemCode, input.position);
  const side = sideFromItemCode(itemCode);
  const subPosition = SUB_POSITION_BY_CODE[itemCode] || null;
  const position = axis
    ? `${axis === "FRONT" ? "Передня" : "Задня"}${side ? side === "LEFT" ? " ліва" : " права" : ""}`
    : input.position?.trim() || null;
  const qualifiers = [axis ? AXIS_WORD[axis] : "", side ? SIDE_WORD[side] : "", subPosition ? SUB_POSITION_WORD[subPosition] : ""].filter(Boolean);
  const displayName = side
    ? `${definition.name} — ${SIDE_WORD[side]}${axis ? `, ${AXIS_WORD[axis]}` : ""}`
    : axis
      ? `${definition.name} — ${AXIS_WORD[axis]}`
      : definition.name;
  const query = [definition.name, ...qualifiers].join(" ").trim();
  return {
    code,
    slug: definition.slug,
    canonicalName: definition.name,
    displayName,
    query,
    category: definition.category,
    axis,
    side,
    subPosition,
    position,
    itemCode,
    searchable: definition.searchable,
  };
}

export function listMechanicDiagnosticMappings() {
  return Object.keys(EXPLICIT_CODE_MAP).flatMap((itemCode) => {
    const mapping = resolveMechanicDiagnosticPart({ itemCode });
    return mapping ? [mapping] : [];
  });
}

export function listMechanicPartDefinitions() {
  return [...MECHANIC_PART_DEFINITIONS];
}
