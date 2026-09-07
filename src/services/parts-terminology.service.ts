export type PartProvider = "BM_PARTS" | "UNITRADE";

export type PartAxis = "FRONT" | "REAR" | null;
export type PartSide = "LEFT" | "RIGHT" | null;
export type PartSubPosition = "FRONT" | "REAR" | "UPPER" | "LOWER" | null;

export type PartTerminologyAttributes = {
  axis: PartAxis;
  side: PartSide;
  subPosition: PartSubPosition;
};

export type PartTerminologyDefinition = {
  slug: string;
  code: string;
  canonicalName: string;
  aliases: readonly string[];
  providerTerms?: Partial<Record<PartProvider, readonly string[]>>;
};

export type PartTerminologyResolution = {
  originalQuery: string;
  definition: PartTerminologyDefinition | null;
  attributes: PartTerminologyAttributes;
  matchType: "EXACT_ALIAS" | "TERM_ALIAS" | "CANONICAL_CODE" | "UNKNOWN";
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export type PartTerminologyInput = {
  query?: string | null;
  partName?: string | null;
  canonicalCode?: string | null;
  canonicalSlug?: string | null;
  position?: string | null;
  side?: string | null;
  subPosition?: string | null;
};

const PART_TERMINOLOGY: readonly PartTerminologyDefinition[] = [
  {
    slug: "ball-joint",
    code: "BALL_JOINT",
    canonicalName: "Шарова опора",
    aliases: [
      "шарова опора",
      "кульова опора",
      "шаровая опора",
      "ball joint",
      "ball-joint",
    ],
    providerTerms: {
      BM_PARTS: ["шаровая опора", "шаровая"],
      UNITRADE: ["шарова опора", "кульова опора"],
    },
  },
  {
    slug: "shock-absorber",
    code: "SHOCK_ABSORBER",
    canonicalName: "Амортизатор",
    aliases: [
      "амортизатор",
      "shock absorber",
      "shock-absorber",
    ],
    providerTerms: {
      BM_PARTS: ["амортизатор", "стойка амортизатора"],
      UNITRADE: ["амортизатор", "амортизаційна стійка"],
    },
  },
  {
    slug: "brake-pad",
    code: "BRAKE_PAD",
    canonicalName: "Гальмівні колодки",
    aliases: [
      "гальмівні колодки",
      "гальмівна колодка",
      "тормозные колодки",
      "тормозная колодка",
      "brake pad",
      "brake-pad",
    ],
    providerTerms: {
      BM_PARTS: ["тормозные колодки", "тормозная колодка"],
      UNITRADE: ["гальмівні колодки", "гальмівна колодка"],
    },
  },
  {
    slug: "wheel-bearing",
    code: "WHEEL_HUB_BEARING",
    canonicalName: "Підшипник ступиці",
    aliases: [
      "підшипник ступиці",
      "підшипник маточини",
      "підшипник колеса",
      "ступічний підшипник",
      "ступичный подшипник",
      "подшипник ступицы",
      "подшипник колеса",
      "wheel hub bearing",
      "wheel bearing",
      "wheel-bearing",
    ],
    providerTerms: {
      BM_PARTS: ["ступичный подшипник", "подшипник ступицы"],
      UNITRADE: ["ступічний підшипник", "підшипник маточини"],
    },
  },
  {
    slug: "wheel-hub-assembly",
    code: "WHEEL_HUB_ASSEMBLY",
    canonicalName: "Ступиця в зборі",
    aliases: [
      "ступиця в зборі",
      "маточина в зборі",
      "ступица в сборе",
      "ступица",
      "wheel hub assembly",
      "wheel hub",
    ],
    providerTerms: {
      BM_PARTS: ["ступица в сборе", "ступица"],
      UNITRADE: ["ступиця в зборі", "маточина в зборі"],
    },
  },
  {
    slug: "control-arm-bushing",
    code: "CONTROL_ARM_BUSHING",
    canonicalName: "Сайлентблок важеля",
    aliases: [
      "сайлентблок важеля",
      "сайлентблок підвіски",
      "сайлентблок",
      "сайлентблок рычага",
      "сайлентблок підрамника",
      "control arm bushing",
      "control-arm bushing",
      "control-arm-bushing",
    ],
    providerTerms: {
      BM_PARTS: ["сайлентблок переднего рычага", "сайлентблок рычага"],
      UNITRADE: ["сайлентблок переднього важеля", "сайлентблок важеля"],
    },
  },
  {
    slug: "coil-spring",
    code: "COIL_SPRING",
    canonicalName: "Пружина підвіски",
    aliases: [
      "пружина",
      "пружина підвіски",
      "пружини підвіски",
      "пружина підвіски",
      "coil spring",
      "coil-spring",
    ],
    providerTerms: {
      BM_PARTS: ["пружина підвіски", "пружина"],
      UNITRADE: ["пружина підвіски", "пружина"],
    },
  },
  {
    slug: "brake-disc",
    code: "BRAKE_DISC",
    canonicalName: "Гальмівний диск",
    aliases: [
      "гальмівний диск",
      "гальмівні диски",
      "тормозной диск",
      "тормозные диски",
      "brake disc",
      "brake rotor",
    ],
    providerTerms: {
      BM_PARTS: ["тормозной диск", "тормозные диски"],
      UNITRADE: ["гальмівний диск", "гальмівні диски"],
    },
  },
  {
    slug: "tie-rod-end",
    code: "TIE_ROD_END",
    canonicalName: "Наконечник рульової тяги",
    aliases: [
      "наконечник рульової тяги",
      "наконечник тяги",
      "рульовий наконечник",
      "наконечник рулевой тяги",
      "рулевой наконечник",
      "tie rod end",
      "tie-rod end",
    ],
    providerTerms: {
      BM_PARTS: ["наконечник рулевой тяги", "рулевой наконечник"],
      UNITRADE: ["наконечник рульової тяги", "рульовий наконечник"],
    },
  },
  {
    slug: "cv-joint",
    code: "CV_JOINT",
    canonicalName: "ШРУС",
    aliases: [
      "шрус",
      "шарнір рівних кутових швидкостей",
      "граната",
      "шрус наружный",
      "шрус внутренний",
      "cv joint",
      "constant velocity joint",
    ],
    providerTerms: {
      BM_PARTS: ["шрус", "граната"],
      UNITRADE: ["шрус", "шарнір рівних кутових швидкостей"],
    },
  },
  {
    slug: "oil-filter",
    code: "OIL_FILTER",
    canonicalName: "Масляний фільтр",
    aliases: [
      "масляний фільтр",
      "фільтр масла",
      "масляный фильтр",
      "oil filter",
      "oil-filter",
    ],
    providerTerms: {
      BM_PARTS: ["масляный фильтр"],
      UNITRADE: ["масляний фільтр", "фільтр масла"],
    },
  },
  {
    slug: "air-filter",
    code: "AIR_FILTER",
    canonicalName: "Повітряний фільтр",
    aliases: [
      "повітряний фільтр",
      "фільтр повітря",
      "воздушный фильтр",
      "air filter",
      "air-filter",
    ],
    providerTerms: {
      BM_PARTS: ["воздушный фильтр"],
      UNITRADE: ["повітряний фільтр", "фільтр повітря"],
    },
  },
  {
    slug: "cabin-filter",
    code: "CABIN_FILTER",
    canonicalName: "Салонний фільтр",
    aliases: [
      "салонний фільтр",
      "фільтр салону",
      "салонный фильтр",
      "cabin filter",
      "cabin-filter",
    ],
    providerTerms: {
      BM_PARTS: ["салонный фильтр"],
      UNITRADE: ["салонний фільтр", "фільтр салону"],
    },
  },
] as const;

const CATALOG_LANGUAGE_ALIASES: Record<string, string> = {
  "передній": "передний",
  "передня": "передняя",
  "переднє": "переднее",
  "переднього": "переднего",
  "передньої": "передней",
  "передньому": "переднем",
  "передніх": "передних",
  "передні": "передние",
  "задній": "задний",
  "задня": "задняя",
  "заднє": "заднее",
  "заднього": "заднего",
  "задньої": "задней",
  "задньому": "заднем",
  "задніх": "задних",
  "задні": "задние",
  "важіль": "рычаг",
  "важеля": "рычага",
  "важелів": "рычагов",
  "важелем": "рычагом",
  "важелі": "рычаги",
  "важелям": "рычагам",
  "шарова": "шаровая",
  "шаровий": "шаровой",
  "шарової": "шаровой",
  "шарову": "шаровую",
  "кульова": "шаровая",
  "кульовий": "шаровой",
  "кульової": "шаровой",
  "кульову": "шаровую",
  "стійка": "стойка",
  "стійки": "стойки",
  "стійку": "стойку",
  "стійкою": "стойкой",
  "ступічний": "ступичный",
  "ступічна": "ступичная",
  "ступічної": "ступичной",
  "ступічну": "ступичную",
  "ступиці": "ступицы",
  "ступиця": "ступица",
  "маточина": "ступица",
  "маточини": "ступицы",
  "підшипник": "подшипник",
  "підшипника": "подшипника",
  "підшипники": "подшипники",
  "гальмівні": "тормозные",
  "гальмівна": "тормозная",
  "гальмівної": "тормозной",
  "гальмівну": "тормозную",
  "пильник": "пыльник",
  "пильника": "пыльника",
  "супорт": "суппорт",
  "супорти": "суппорты",
  "охолоджувальної": "охлаждающей",
  "охолоджувальна": "охлаждающая",
  "рідини": "жидкости",
  "фільтр": "фильтр",
  "паливний": "топливный",
  "паливного": "топливного",
  "салонний": "салонный",
  "свічки": "свечи",
  "запалювання": "зажигания",
  "ремінь": "ремень",
};

export function normalizePartTerminology(value: unknown) {
  return typeof value === "string"
    ? value
      .trim()
      .toLocaleLowerCase("uk-UA")
      .replace(/[_-]+/g, " ")
      .replace(/[^a-zа-яіїєґ0-9]+/giu, " ")
      .replace(/\s+/g, " ")
      .trim()
    : "";
}

function textValue(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function includesAny(source: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(source));
}

function axisFromValue(value: unknown): PartAxis {
  const source = normalizePartTerminology(value);
  if (/^(front|front left|front right|перед|передн)/u.test(source)) return "FRONT";
  if (/^(rear|rear left|rear right|зад|задн)/u.test(source)) return "REAR";
  return null;
}

function sideFromValue(value: unknown): PartSide {
  const source = normalizePartTerminology(value);
  if (/(left|лів|лев)/u.test(source)) return "LEFT";
  if (/(right|прав)/u.test(source)) return "RIGHT";
  return null;
}

function subPositionFromValue(value: unknown): PartSubPosition {
  const source = normalizePartTerminology(value);
  if (/(upper|верх)/u.test(source)) return "UPPER";
  if (/(lower|нижн)/u.test(source)) return "LOWER";
  if (/(front|передн)/u.test(source)) return "FRONT";
  if (/(rear|задн)/u.test(source)) return "REAR";
  return null;
}

function detectAttributes(source: string, definition: PartTerminologyDefinition | null, input: PartTerminologyInput): PartTerminologyAttributes {
  const front = /(front|передн)/u.test(source);
  const rear = /(rear|задн)/u.test(source);
  const left = /(left|лів|лев)/u.test(source);
  const right = /(right|прав)/u.test(source);
  let axis: PartAxis = axisFromValue(input.position) || (front ? "FRONT" : rear ? "REAR" : null);
  let subPosition: PartSubPosition = subPositionFromValue(input.subPosition);

  if (definition?.code === "CONTROL_ARM_BUSHING" && front && rear) {
    const frontArm = /(?:front|передн\w*)\s+(?:[a-zа-яіїєґ]+\s+)?(?:control\s+arm|важел\w*|рычаг\w*)/u.test(source);
    const rearArm = /(?:rear|задн\w*)\s+(?:[a-zа-яіїєґ]+\s+)?(?:control\s+arm|важел\w*|рычаг\w*)/u.test(source);
    if (frontArm && !rearArm) {
      axis = "FRONT";
      subPosition = "REAR";
    } else if (rearArm && !frontArm) {
      axis = "REAR";
      subPosition = "FRONT";
    }
  }

  return {
    axis,
    side: sideFromValue(input.side) || (left ? "LEFT" : right ? "RIGHT" : null),
    subPosition,
  };
}

function definitionByInput(input: PartTerminologyInput) {
  const code = textValue(input.canonicalCode, 80).toUpperCase();
  const slug = normalizePartTerminology(input.canonicalSlug);
  return PART_TERMINOLOGY.find((item) => item.code === code || item.slug === slug) || null;
}

export function resolvePartTerminology(input: PartTerminologyInput): PartTerminologyResolution {
  const originalQuery = textValue(input.partName || input.query);
  const combined = [input.partName, input.query].filter(Boolean).join(" ");
  const source = normalizePartTerminology(combined);
  const explicitDefinition = definitionByInput(input);

  if (explicitDefinition) {
    return {
      originalQuery,
      definition: explicitDefinition,
      attributes: detectAttributes(source, explicitDefinition, input),
      matchType: "CANONICAL_CODE",
      confidence: "HIGH",
    };
  }

  const matches = PART_TERMINOLOGY.flatMap((definition) => definition.aliases
    .map((alias) => ({ definition, alias, normalizedAlias: normalizePartTerminology(alias) }))
    .filter((item) => item.normalizedAlias && source.includes(item.normalizedAlias)))
    .sort((left, right) => right.normalizedAlias.length - left.normalizedAlias.length);

  const best = matches[0];
  if (!best) {
    return {
      originalQuery,
      definition: null,
      attributes: detectAttributes(source, null, input),
      matchType: "UNKNOWN",
      confidence: "LOW",
    };
  }

  return {
    originalQuery,
    definition: best.definition,
    attributes: detectAttributes(source, best.definition, input),
    matchType: source === best.normalizedAlias ? "EXACT_ALIAS" : "TERM_ALIAS",
    confidence: source === best.normalizedAlias ? "HIGH" : "MEDIUM",
  };
}

function translateCatalogTerms(query: string) {
  return query.replace(/[A-Za-zА-Яа-яІіЇїЄєҐґ]+/gu, (token) => (
    CATALOG_LANGUAGE_ALIASES[token.toLocaleLowerCase("uk-UA")] || token
  ));
}

function providerAxisWord(provider: PartProvider, axis: PartAxis) {
  if (!axis) return "";
  if (provider === "BM_PARTS") return axis === "FRONT" ? "передний" : "задний";
  return axis === "FRONT" ? "передній" : "задній";
}

function providerSubPositionWord(provider: PartProvider, subPosition: PartSubPosition) {
  if (!subPosition || !["FRONT", "REAR"].includes(subPosition)) return "";
  if (provider === "BM_PARTS") return subPosition === "FRONT" ? "передний" : "задний";
  return subPosition === "FRONT" ? "передній" : "задній";
}

function decorateProviderTerm(term: string, provider: PartProvider, definition: PartTerminologyDefinition, attributes: PartTerminologyAttributes) {
  let candidate = term.trim();
  const normalized = normalizePartTerminology(candidate);
  const axisWord = providerAxisWord(provider, attributes.axis);
  const hasAxis = /(front|rear|передн|задн)/u.test(normalized);
  if (axisWord && !hasAxis) candidate += " " + axisWord;

  const armTerm = /(control arm|важел|рычаг)/u.test(normalized);
  const subPositionWord = providerSubPositionWord(provider, attributes.subPosition);
  const hasSubPosition = /(front|rear|передн|задн)/u.test(normalized);
  if (subPositionWord && definition.code === "CONTROL_ARM_BUSHING" && armTerm && !normalized.includes(subPositionWord)) {
    candidate += " " + subPositionWord;
  }

  return candidate;
}

export function buildProviderPartQueryCandidates(input: PartTerminologyInput & { provider: PartProvider }) {
  const original = textValue(input.partName || input.query);
  if (original.length < 2) return [];

  const resolution = resolvePartTerminology(input);
  const candidates = [
    original,
    translateCatalogTerms(original),
  ];

  const providerTerms = resolution.definition?.providerTerms?.[input.provider] || [];
  for (const term of providerTerms) {
    candidates.push(decorateProviderTerm(term, input.provider, resolution.definition!, resolution.attributes));
  }

  const seen = new Set<string>();
  return candidates
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .filter((candidate) => {
      const key = normalizePartTerminology(candidate);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

export function listPartTerminology() {
  return PART_TERMINOLOGY.map((item) => ({
    slug: item.slug,
    code: item.code,
    canonicalName: item.canonicalName,
    aliases: [...item.aliases],
  }));
}
