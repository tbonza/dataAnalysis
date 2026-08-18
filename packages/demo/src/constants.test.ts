import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFlags } from "./constants.js";

describe("parseFlags", () => {
  it("accepts both --flag=value and --flag value", () => {
    assert.deepEqual(parseFlags(["--allowed-host=a.test"]).allowedHosts, ["a.test"]);
    assert.deepEqual(parseFlags(["--allowed-host", "a.test"]).allowedHosts, ["a.test"]);
  });

  it("treats --allowed-host, --allowedHost and --allowedhost as one flag", () => {
    for (const spelling of ["--allowed-host", "--allowedHost", "--allowedhost"]) {
      assert.deepEqual(parseFlags([spelling, "a.test"]).allowedHosts, ["a.test"], spelling);
    }
  });

  it("collects a repeated --allowed-host, and splits a comma-separated one", () => {
    assert.deepEqual(parseFlags(["--allowed-host", "a.test", "--allowed-host", "b.test"]).allowedHosts, [
      "a.test",
      "b.test",
    ]);
    assert.deepEqual(parseFlags(["--allowed-host=a.test, b.test"]).allowedHosts, ["a.test", "b.test"]);
  });

  it("ignores the `--` that pnpm forwards literally", () => {
    const flags = parseFlags(["--", "--allowed-host", "a.test"]);
    assert.deepEqual(flags.allowedHosts, ["a.test"]);
    assert.deepEqual(flags.errors, []);
  });

  it("reads --host and --port", () => {
    const flags = parseFlags(["--host", "0.0.0.0", "--port", "9090"]);
    assert.equal(flags.host, "0.0.0.0");
    assert.equal(flags.port, 9090);
    assert.deepEqual(flags.errors, []);
  });

  it("rejects a --port that is not a port", () => {
    for (const bad of ["abc", "1.5", "0", "70000"]) {
      const flags = parseFlags(["--port", bad]);
      assert.equal(flags.port, undefined, bad);
      assert.equal(flags.errors.length, 1, bad);
    }
  });

  it("reports an unknown option rather than ignoring it", () => {
    const flags = parseFlags(["--allowedhosts=a.test"]);
    assert.deepEqual(flags.allowedHosts, []);
    assert.match(flags.errors[0]!, /Unknown option "--allowedhosts=a\.test"/);
  });

  it("reports a flag left without a value", () => {
    assert.match(parseFlags(["--allowed-host"]).errors[0]!, /--allowed-host needs a value/);
    assert.match(parseFlags(["--host", "--port", "9090"]).errors[0]!, /--host needs a value/);
  });

  it("does not swallow the next option as a value", () => {
    const flags = parseFlags(["--host", "--port", "9090"]);
    assert.equal(flags.port, 9090);
  });

  it("reports a bare argument", () => {
    assert.match(parseFlags(["a.test"]).errors[0]!, /Unexpected argument "a\.test"/);
  });

  it("finds nothing wrong with an empty command line", () => {
    assert.deepEqual(parseFlags([]), { allowedHosts: [], host: undefined, port: undefined, errors: [] });
  });
});
