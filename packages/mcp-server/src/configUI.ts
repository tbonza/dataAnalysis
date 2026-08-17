import type { ConfigControl } from "./schemas.js";

/**
 * Generative restyle controls, ported from data-formulator
 * (src/app/restyle.ts:203-322).
 *
 * A control is a *path* into a Vega-Lite spec plus the values allowed there — never
 * code. That is what makes model-authored controls safe to apply: the only thing a
 * control can do is write a value at a location.
 */

/**
 * Writing to any of these would let a payload reach Object.prototype — the classic
 * prototype-pollution sink. Upstream blocks them and so do we.
 */
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

type PathSegment = string | number;

function sanitizePath(raw: unknown): PathSegment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const path: PathSegment[] = [];
  for (const segment of raw) {
    if (typeof segment === "number" && Number.isInteger(segment) && segment >= 0) {
      path.push(segment);
    } else if (
      typeof segment === "string" &&
      segment.length > 0 &&
      !FORBIDDEN_PATH_SEGMENTS.has(segment)
    ) {
      path.push(segment);
    } else {
      return undefined;
    }
  }
  return path;
}

/**
 * Validate and normalize a `configUI` array, dropping anything malformed so a bad
 * payload yields fewer controls rather than broken or unsafe ones.
 */
export function sanitizeConfigUI(raw: unknown): ConfigControl[] {
  if (!Array.isArray(raw)) return [];
  const out: ConfigControl[] = [];
  const seen = new Set<string>();

  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object") continue;
    const control = candidate as Record<string, unknown>;

    const key = typeof control["key"] === "string" ? control["key"].trim() : "";
    const label = typeof control["label"] === "string" ? control["label"].trim() : "";
    if (!key || !label || seen.has(key)) continue;

    const path = sanitizePath(control["path"]);
    if (!path) continue;

    if (control["type"] === "binary") {
      out.push({ key, label, path, type: "binary", defaultValue: Boolean(control["defaultValue"]) });
    } else if (control["type"] === "continuous") {
      const min = Number(control["min"]);
      const max = Number(control["max"]);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) continue;
      const stepRaw = Number(control["step"]);
      const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : undefined;
      const defaultRaw = Number(control["defaultValue"]);
      out.push({
        key,
        label,
        path,
        type: "continuous",
        min,
        max,
        ...(step === undefined ? {} : { step }),
        defaultValue: Number.isFinite(defaultRaw) ? defaultRaw : min,
      });
    } else if (control["type"] === "discrete") {
      const rawOptions = control["options"];
      if (!Array.isArray(rawOptions) || rawOptions.length === 0) continue;
      const options = rawOptions
        .filter(
          (option): option is { value: unknown; label: string } =>
            !!option && typeof option === "object" && typeof (option as { label?: unknown }).label === "string"
        )
        .map((option) => ({ value: option.value, label: option.label }));
      if (options.length === 0) continue;
      out.push({
        key,
        label,
        path,
        type: "discrete",
        options,
        defaultValue: control["defaultValue"] !== undefined ? control["defaultValue"] : options[0]?.value,
      });
    } else {
      continue;
    }
    seen.add(key);
  }

  return out;
}

/**
 * Write `value` into `target` at `path`, creating intermediate containers. The
 * container's kind comes from the *next* segment's type, so a numeric segment
 * builds an array and a string builds an object.
 */
function setAtPath(target: Record<string, unknown>, path: PathSegment[], value: unknown): boolean {
  if (path.length === 0) return false;
  let node: Record<string, unknown> | unknown[] = target;

  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]!;
    if (typeof segment === "string" && FORBIDDEN_PATH_SEGMENTS.has(segment)) return false;
    let next = (node as Record<PathSegment, unknown>)[segment];
    if (next === null || typeof next !== "object") {
      next = typeof path[i + 1] === "number" ? [] : {};
      (node as Record<PathSegment, unknown>)[segment] = next;
    }
    node = next as Record<string, unknown> | unknown[];
  }

  const last = path[path.length - 1]!;
  if (typeof last === "string" && FORBIDDEN_PATH_SEGMENTS.has(last)) return false;
  (node as Record<PathSegment, unknown>)[last] = value;
  return true;
}

/**
 * Apply a variant's controls to its spec, writing each control's current value (or
 * its default) at the control's path. A pure data transform — no model-authored
 * code runs. Returns a new spec; the input is never mutated.
 */
export function applyConfigUI(
  spec: Record<string, unknown>,
  controls: readonly ConfigControl[] | undefined,
  values: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!controls || controls.length === 0) return spec;
  const working = structuredClone(spec);
  for (const control of controls) {
    const value =
      values && Object.hasOwn(values, control.key) ? values[control.key] : control.defaultValue;
    setAtPath(working, control.path, value);
  }
  return working;
}

/** Exposed for tests; the write path is the sharp edge worth covering directly. */
export const __test = { setAtPath };
