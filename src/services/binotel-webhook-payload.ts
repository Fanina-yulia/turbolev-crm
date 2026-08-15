export type BinotelFormPayload = Record<string, unknown>;

type MutableNode = Record<string, unknown> | unknown[];

const BLOCKED_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function isMutableNode(value: unknown): value is MutableNode {
  return Boolean(value) && typeof value === "object";
}

function pathSegments(key: string): string[] {
  const segments = key.match(/[^\[\]]+/g) || [];
  return segments.filter(Boolean);
}

function assignNested(target: Record<string, unknown>, key: string, value: string) {
  const segments = pathSegments(key);
  if (!segments.length || segments.some((segment) => BLOCKED_PATH_SEGMENTS.has(segment))) return;

  let current: MutableNode = target;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const last = index === segments.length - 1;
    const nextSegment = segments[index + 1];
    const nextIsArray = Boolean(nextSegment && /^\d+$/.test(nextSegment));

    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return;
      const position = Number(segment);
      if (last) {
        current[position] = value;
        return;
      }
      if (!isMutableNode(current[position])) current[position] = nextIsArray ? [] : {};
      current = current[position] as MutableNode;
      continue;
    }

    if (last) {
      current[segment] = value;
      return;
    }

    if (!isMutableNode(current[segment])) current[segment] = nextIsArray ? [] : {};
    current = current[segment] as MutableNode;
  }
}

/**
 * Binotel sends API PUSH / API CALL COMPLETED payloads as
 * application/x-www-form-urlencoded. PHP-style keys such as
 * callDetails[historyData][0][employeeData][email] must be inflated before
 * the normal webhook parser can read them.
 */
export function inflateBinotelFormEntries(entries: Iterable<[string, string]>): BinotelFormPayload {
  const payload: BinotelFormPayload = {};
  for (const [key, value] of entries) assignNested(payload, key, value);
  return payload;
}

export function requiresBinotelSuccessAck(payload: BinotelFormPayload): boolean {
  const requestType = payload.requestType;
  if (typeof requestType !== "string") return false;
  return requestType.toLowerCase().replace(/[^a-z]/g, "") === "apicallcompleted";
}
