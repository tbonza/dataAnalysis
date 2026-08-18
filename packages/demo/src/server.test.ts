import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { contentTypeFor, hostAllowed, hostnameOf, pathnameOf, resolveWithin, startDemoServer } from "./server.js";

describe("hostAllowed", () => {
  const allowed = ["my-proxy.internal"];

  it("always answers to localhost, with or without a port", () => {
    for (const host of ["localhost", "localhost:8080", "127.0.0.1", "127.0.0.1:8080", "[::1]", "[::1]:8080"]) {
      assert.equal(hostAllowed(host, []), true, host);
    }
  });

  it("answers to a named proxy and refuses an unnamed one", () => {
    assert.equal(hostAllowed("my-proxy.internal", allowed), true);
    assert.equal(hostAllowed("my-proxy.internal:8080", allowed), true);
    assert.equal(hostAllowed("MY-PROXY.INTERNAL", allowed), true, "host comparison is case-insensitive");
    assert.equal(hostAllowed("evil.test", allowed), false);
  });

  it("refuses a header that hides a second host", () => {
    // Each of these parses as an allowed name under a lax reading, and as something else
    // entirely under a browser's.
    assert.equal(hostAllowed("evil.test@my-proxy.internal", allowed), false, "userinfo");
    assert.equal(hostAllowed("my-proxy.internal/../evil.test", allowed), false, "path separator");
    assert.equal(hostAllowed("my-proxy.internal evil.test", allowed), false, "whitespace");
    assert.equal(hostAllowed("http://my-proxy.internal", allowed), false, "absolute form");
  });

  it("refuses a missing or empty header", () => {
    assert.equal(hostAllowed(undefined, allowed), false);
    assert.equal(hostAllowed("", allowed), false);
    assert.equal(hostAllowed(":8080", allowed), false);
  });

  it("keeps a bracketed IPv6 address intact", () => {
    assert.equal(hostnameOf("[::1]:8080"), "[::1]");
    assert.equal(hostnameOf("[fe80::1]"), "[fe80::1]");
  });
});

describe("request paths", () => {
  it("strips the query before decoding, not after", () => {
    assert.equal(pathnameOf("/assets/index-abc.js?t=123"), "/assets/index-abc.js");
    assert.equal(pathnameOf("/a%20b.css"), "/a b.css");
    // %3F decodes to "?" — decoding first would truncate the path here.
    assert.equal(pathnameOf("/weird%3Fname.css"), "/weird?name.css");
  });

  it("rejects a malformed escape or an embedded NUL", () => {
    assert.equal(pathnameOf("/%ZZ"), undefined);
    assert.equal(pathnameOf("/a%00b"), undefined);
    assert.equal(pathnameOf(undefined), undefined);
  });

  it("refuses a path that escapes the root, however it is spelled", () => {
    const root = "/srv/dist";
    assert.equal(resolveWithin(root, "/assets/app.js"), join(root, "assets/app.js"));
    assert.equal(resolveWithin(root, "/../../etc/passwd"), undefined);
    assert.equal(resolveWithin(root, "/assets/../../secret"), undefined);
  });

  it("names the types the built client actually ships", () => {
    assert.equal(contentTypeFor("index.html"), "text/html; charset=utf-8");
    assert.equal(contentTypeFor("index-abc.js"), "text/javascript; charset=utf-8");
    assert.equal(contentTypeFor("index-abc.CSS"), "text/css; charset=utf-8");
    assert.equal(contentTypeFor("mystery.xyz"), "application/octet-stream");
  });
});

describe("the demo server", () => {
  let dist: string;
  let upstream: Server;
  let demo: Server;
  let origin: string;

  before(async () => {
    dist = await mkdtemp(join(tmpdir(), "demo-dist-"));
    await mkdir(join(dist, "assets"));
    await writeFile(join(dist, "index.html"), "<!doctype html><title>client</title>");
    await writeFile(join(dist, "assets", "app.css"), "body{color:red}");

    // Stands in for the agent server: writes three SSE frames with a gap between them.
    upstream = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"status":"ok"}');
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      let sent = 0;
      const timer = setInterval(() => {
        res.write(`data: {"n":${sent}}\n\n`);
        if (++sent === 3) {
          clearInterval(timer);
          res.end();
        }
      }, 60);
    });
    await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
    const upstreamPort = (upstream.address() as { port: number }).port;

    demo = await startDemoServer({
      host: "127.0.0.1",
      port: 0,
      allowedHosts: ["my-proxy.internal"],
      distDir: dist,
      routes: [
        {
          prefix: "/api",
          strip: true,
          host: "127.0.0.1",
          port: upstreamPort,
          hostHeader: `127.0.0.1:${upstreamPort}`,
        },
      ],
    });
    origin = `http://127.0.0.1:${(demo.address() as { port: number }).port}`;
  });

  after(async () => {
    // The fake upstream keeps writing to a stream the streaming test cancelled, so drop
    // sockets rather than waiting for them to finish.
    demo.closeAllConnections();
    upstream.closeAllConnections();
    await new Promise<void>((done) => demo.close(() => done()));
    await new Promise<void>((done) => upstream.close(() => done()));
  });

  it("serves the client and its assets with the right types", async () => {
    const page = await fetch(`${origin}/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");

    const css = await fetch(`${origin}/assets/app.css`);
    assert.equal(css.status, 200);
    assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
    assert.match(css.headers.get("cache-control") ?? "", /immutable/);
  });

  it("404s a missing asset instead of answering it with HTML", async () => {
    const missing = await fetch(`${origin}/assets/nope.css`);
    assert.equal(missing.status, 404);
    assert.doesNotMatch(missing.headers.get("content-type") ?? "", /html/);
  });

  it("falls back to the client for an unknown route, so the SPA keeps working", async () => {
    const deep = await fetch(`${origin}/some/spa/route`);
    assert.equal(deep.status, 200);
    assert.equal(deep.headers.get("content-type"), "text/html; charset=utf-8");
  });

  it("answers a revalidation with 304 rather than the file again", async () => {
    const first = await fetch(`${origin}/`);
    const etag = first.headers.get("etag");
    assert.ok(etag);
    const again = await fetch(`${origin}/`, { headers: { "if-none-match": etag } });
    assert.equal(again.status, 304);
  });

  it("refuses a Host it was not told about", async () => {
    // Not `fetch`: `Host` is a forbidden header name there, so it is dropped silently and
    // the request goes out claiming the address it dialled — which would pass every time.
    const statusWithHost = (host: string): Promise<number> =>
      new Promise((settle, fail) => {
        const req = request(`${origin}/`, { headers: { host } }, (res) => {
          res.resume();
          settle(res.statusCode ?? 0);
        });
        req.on("error", fail);
        req.end();
      });

    assert.equal(await statusWithHost("evil.test"), 403);
    assert.equal(await statusWithHost("my-proxy.internal"), 200);
    assert.equal(await statusWithHost("localhost"), 200);
  });

  it("strips the route prefix before forwarding", async () => {
    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
  });

  // The regression this server was written for: a proxied stream has to arrive as it is
  // produced. Reading it whole and finding all three frames proves nothing — the question
  // is whether the first one arrives before the last one is written.
  it("passes a stream through as it arrives, not once it has finished", async () => {
    const response = await fetch(`${origin}/api/chat`, { method: "POST" });
    assert.equal(response.headers.get("x-accel-buffering"), "no");

    const reader = response.body!.getReader();
    const started = Date.now();
    const { value } = await reader.read();
    const firstChunkAt = Date.now() - started;

    assert.ok(new TextDecoder().decode(value).includes('"n":0'), "first frame arrives first");
    // Upstream writes its last frame at ~180ms. A buffering proxy would deliver nothing
    // before then; the margin is wide enough not to be flaky on a loaded machine.
    assert.ok(firstChunkAt < 150, `first chunk took ${firstChunkAt}ms — the stream was buffered`);
    await reader.cancel();
  });
});
