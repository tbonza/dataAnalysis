import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENT_CLIENT_BASE, AGENT_PREFIX, parseFlags } from "./constants.js";

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

describe("the agent prefix", () => {
  // The proxy table is keyed by the root-absolute form; the client is built with the
  // relative one so its calls resolve against the document and stay inside a proxy's
  // path prefix. Both must name the same route or the demo 404s one way or the other.
  it("is root-absolute for the proxy table and relative for the client", () => {
    assert.ok(AGENT_PREFIX.startsWith("/"), AGENT_PREFIX);
    assert.ok(!AGENT_CLIENT_BASE.startsWith("/"), AGENT_CLIENT_BASE);
    assert.equal(`/${AGENT_CLIENT_BASE}`, AGENT_PREFIX);
  });

  it("resolves under a proxy path prefix rather than at the origin root", () => {
    const under = new URL(AGENT_CLIENT_BASE, "https://host.test/proxy/8080/").href;
    assert.equal(under, "https://host.test/proxy/8080/api");

    const root = new URL(AGENT_CLIENT_BASE, "http://127.0.0.1:8080/").href;
    assert.equal(root, "http://127.0.0.1:8080/api");
  });
});
