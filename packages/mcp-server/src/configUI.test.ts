import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __test, applyConfigUI, sanitizeConfigUI } from "./configUI.js";
import { ConfigControl, ConfigControlInput } from "./schemas.js";

const { setAtPath } = __test;

describe("sanitizeConfigUI", () => {
  it("accepts one well-formed control of each kind", () => {
    const controls = sanitizeConfigUI([
      { key: "opacity", label: "opacity", path: ["mark", "opacity"], type: "continuous", min: 0.1, max: 1, step: 0.1, defaultValue: 0.7 },
      { key: "grid", label: "gridlines", path: ["config", "axis", "grid"], type: "binary", defaultValue: true },
      {
        key: "legend",
        label: "legend position",
        path: ["config", "legend", "orient"],
        type: "discrete",
        options: [{ value: "right", label: "right" }, { value: "bottom", label: "bottom" }],
        defaultValue: "right",
      },
    ]);
    assert.equal(controls.length, 3);
    assert.deepEqual(controls.map((c) => c.type), ["continuous", "binary", "discrete"]);
  });

  it("refuses prototype-polluting path segments", () => {
    for (const segment of ["__proto__", "prototype", "constructor"]) {
      const controls = sanitizeConfigUI([
        { key: "x", label: "x", path: [segment, "y"], type: "binary", defaultValue: true },
      ]);
      assert.deepEqual(controls, [], `expected "${segment}" to be rejected`);
    }
  });

  it("drops malformed controls rather than emitting broken ones", () => {
    const controls = sanitizeConfigUI([
      { key: "", label: "no key", path: ["a"], type: "binary", defaultValue: true },
      { key: "a", label: "", path: ["a"], type: "binary", defaultValue: true },
      { key: "b", label: "empty path", path: [], type: "binary", defaultValue: true },
      { key: "c", label: "bad range", path: ["a"], type: "continuous", min: 5, max: 1, defaultValue: 2 },
      { key: "d", label: "no options", path: ["a"], type: "discrete", options: [], defaultValue: 1 },
      { key: "e", label: "unknown kind", path: ["a"], type: "rainbow", defaultValue: 1 },
      { key: "f", label: "fractional index", path: ["layer", 1.5], type: "binary", defaultValue: true },
      "not an object",
    ]);
    assert.deepEqual(controls, []);
  });

  it("keeps only the first control for a duplicated key", () => {
    const controls = sanitizeConfigUI([
      { key: "dup", label: "first", path: ["a"], type: "binary", defaultValue: true },
      { key: "dup", label: "second", path: ["b"], type: "binary", defaultValue: false },
    ]);
    assert.equal(controls.length, 1);
    assert.equal(controls[0]?.label, "first");
  });

  it("returns an empty list for a non-array payload", () => {
    assert.deepEqual(sanitizeConfigUI(undefined), []);
    assert.deepEqual(sanitizeConfigUI({ key: "a" }), []);
  });
});

describe("setAtPath", () => {
  it("creates an object for a string segment and an array for a numeric one", () => {
    const target: Record<string, unknown> = {};
    assert.equal(setAtPath(target, ["config", "axis", "grid"], false), true);
    assert.deepEqual(target, { config: { axis: { grid: false } } });

    const withArray: Record<string, unknown> = {};
    assert.equal(setAtPath(withArray, ["layer", 0, "mark", "color"], "green"), true);
    assert.ok(Array.isArray((withArray as { layer?: unknown }).layer));
    assert.deepEqual(withArray, { layer: [{ mark: { color: "green" } }] });
  });

  it("replaces a non-object intermediate instead of failing", () => {
    const target: Record<string, unknown> = { mark: "bar" };
    assert.equal(setAtPath(target, ["mark", "opacity"], 0.5), true);
    assert.deepEqual(target, { mark: { opacity: 0.5 } });
  });

  it("refuses a forbidden segment anywhere in the path", () => {
    const target: Record<string, unknown> = {};
    assert.equal(setAtPath(target, ["a", "__proto__", "b"], 1), false);
    assert.equal(setAtPath(target, ["__proto__"], 1), false);
  });
});

describe("applyConfigUI", () => {
  const controls: ConfigControl[] = [
    { key: "opacity", label: "opacity", path: ["mark", "opacity"], type: "continuous", min: 0, max: 1, defaultValue: 0.7 },
    { key: "grid", label: "grid", path: ["config", "axis", "grid"], type: "binary", defaultValue: true },
  ];

  it("writes defaults when no values are supplied", () => {
    const out = applyConfigUI({ mark: { type: "bar" } }, controls, undefined);
    assert.deepEqual(out, { mark: { type: "bar", opacity: 0.7 }, config: { axis: { grid: true } } });
  });

  it("prefers supplied values over defaults", () => {
    const out = applyConfigUI({ mark: { type: "bar" } }, controls, { opacity: 0.2 });
    assert.equal(((out["mark"] as Record<string, unknown>)["opacity"]), 0.2);
  });

  it("never mutates the input spec", () => {
    const original: Record<string, unknown> = { mark: { type: "bar" } };
    const snapshot = structuredClone(original);
    applyConfigUI(original, controls, undefined);
    assert.deepEqual(original, snapshot);
  });

  it("returns the spec unchanged when there are no controls", () => {
    const spec = { mark: "bar" };
    assert.equal(applyConfigUI(spec, [], undefined), spec);
    assert.equal(applyConfigUI(spec, undefined, undefined), spec);
  });
});

describe("the configUI tool-input schema", () => {
  // The payload that failed in the demo: a discrete control the model built without
  // `options`. Strictly validated it took the whole apply_restyle call down with it.
  const missingOptions = {
    key: "legend",
    label: "Legend position",
    path: ["legend", "orient"],
    type: "discrete",
    defaultValue: "right",
  };

  it("accepts a control the strict shape rejects, so one bad control cannot fail the call", () => {
    assert.equal(ConfigControl.safeParse(missingOptions).success, false);
    assert.equal(ConfigControlInput.safeParse(missingOptions).success, true);
  });

  it("leaves the sanitizer to drop it, which is where the real contract lives", () => {
    assert.deepEqual(sanitizeConfigUI([missingOptions]), []);
  });

  it("still rejects a control with no path at all", () => {
    const { path: _path, ...noPath } = missingOptions;
    assert.equal(ConfigControlInput.safeParse(noPath).success, false);
  });
});
