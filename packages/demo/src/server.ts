/**
 * The demo's single exposed port: the built chat client, plus the two services behind it.
 *
 * This used to be Vite's preview server. Preview is a development convenience being asked
 * to do a deployment job, and every proxy problem the demo has had came from inheriting
 * its assumptions rather than stating our own — a `Host` allow-list we did not know was
 * there, a `base` that resolved assets against the origin root, a compressor in the
 * middleware chain. What a proxied deployment needs is small and specific, so it is
 * written down here instead: a static directory, two upstreams, and a stream that is
 * never buffered on its way through.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

import {
  ASSET_CACHE_CONTROL,
  ASSETS_PREFIX,
  CONTENT_TYPES,
  DEFAULT_CACHE_CONTROL,
  FALLBACK_CONTENT_TYPE,
  HOP_BY_HOP_HEADERS,
  INDEX_HTML,
  LOCALHOST_NAMES,
} from "./constants.js";

// --- host validation --------------------------------------------------------------

/**
 * The hostname in a `Host` header, lowercased and without its port.
 *
 * IPv6 is bracketed (`[::1]:8080`), so the first colon is only a port separator outside
 * brackets. Returns `""` for anything that isn't a hostname we can reason about.
 */
export function hostnameOf(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    return close === -1 ? "" : trimmed.slice(0, close + 1);
  }
  const colon = trimmed.indexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/**
 * Whether to answer a request claiming this `Host`.
 *
 * This is the DNS-rebinding guard Vite's `allowedHosts` was providing: a browser on any
 * page can be pointed at a server bound to loopback, and the `Host` header is what
 * distinguishes "someone typed our address" from "someone's page resolved a name to
 * 127.0.0.1". Localhost is always allowed; `--allowed-host` widens the list rather than
 * replacing it, which is what lets `/mcp` stay reachable through a proxy.
 *
 * Characters that could smuggle a second host past the comparison — userinfo (`@`), a
 * path or scheme separator, whitespace — are refused outright rather than parsed.
 */
export function hostAllowed(raw: string | undefined, allowedHosts: readonly string[]): boolean {
  if (!raw) return false;
  if (/[@/\\\s]/.test(raw)) return false;

  const name = hostnameOf(raw);
  if (!name) return false;
  return [...LOCALHOST_NAMES, ...allowedHosts].some((allowed) => allowed.toLowerCase() === name);
}

// --- static files -----------------------------------------------------------------

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? FALLBACK_CONTENT_TYPE;
}

/**
 * The decoded path of a request, with the query and fragment removed.
 *
 * Order matters: strip first, then decode. Decoding first would let a `%3F` in a filename
 * turn into a `?` and truncate the path. `undefined` means the request line is malformed
 * — a percent-escape that isn't one, or an embedded NUL.
 */
export function pathnameOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return undefined;
  }
  return decoded.includes("\0") ? undefined : decoded;
}

/**
 * A request path resolved inside `root`, or `undefined` if it escapes.
 *
 * Checked after `resolve` rather than by scanning for `..`, because the segments a path
 * traversal needs can be produced by decoding as easily as by typing.
 */
export function resolveWithin(root: string, pathname: string): string | undefined {
  const base = resolve(root);
  const target = resolve(base, `.${pathname.startsWith("/") ? pathname : `/${pathname}`}`);
  if (target !== base && !target.startsWith(base + sep)) return undefined;
  return target;
}

function plain(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(`${message}\n`);
}

/**
 * Send one file, or a 304 if the client already has it.
 *
 * The ETag is size and mtime rather than a content hash: the point is to answer a reload
 * cheaply, not to survive a rebuild that produces identical bytes.
 *
 * Range requests are deliberately unsupported. `dist/` is html, js and css, which no
 * browser range-requests; if the client ever ships media this is the place to add it.
 */
async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, cacheControl: string): Promise<void> {
  let info;
  try {
    info = await stat(file);
  } catch {
    plain(res, 404, "Not found");
    return;
  }
  if (!info.isFile()) {
    plain(res, 404, "Not found");
    return;
  }

  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { etag, "cache-control": cacheControl });
    res.end();
    return;
  }

  res.writeHead(200, {
    "content-type": contentTypeFor(file),
    "content-length": String(info.size),
    "cache-control": cacheControl,
    etag,
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

/**
 * Serve the built client, falling back to `index.html` so the SPA keeps its routes.
 *
 * With one exception: a miss under `/assets/` is a 404, never the fallback. Answering a
 * missing stylesheet with HTML is what produced "Refused to apply style … MIME type
 * ('text/html')" when the demo's asset paths were wrong — an error that describes the
 * symptom and hides the cause.
 */
export async function serveStatic(req: IncomingMessage, res: ServerResponse, distDir: string): Promise<void> {
  const pathname = pathnameOf(req.url);
  if (pathname === undefined) {
    plain(res, 400, "Bad request");
    return;
  }

  const target = resolveWithin(distDir, pathname);
  if (target === undefined) {
    plain(res, 403, "Forbidden");
    return;
  }

  const isAsset = pathname.startsWith(ASSETS_PREFIX);
  if (target !== resolve(distDir)) {
    const info = await stat(target).catch(() => undefined);
    if (info?.isFile()) {
      await sendFile(req, res, target, isAsset ? ASSET_CACHE_CONTROL : DEFAULT_CACHE_CONTROL);
      return;
    }
  }

  if (isAsset) {
    plain(res, 404, "Not found");
    return;
  }
  await sendFile(req, res, join(distDir, INDEX_HTML), DEFAULT_CACHE_CONTROL);
}

// --- proxying ---------------------------------------------------------------------

function withoutHopByHop(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const out = { ...headers };
  for (const name of HOP_BY_HOP_HEADERS) delete out[name];
  return out;
}

export interface ProxyTarget {
  host: string;
  port: number;
  /** Sent as `Host` upstream. Rewriting it to the loopback target is what satisfies the
   *  MCP server's own DNS-rebinding guard without weakening it. */
  hostHeader: string;
}

/**
 * Pass one request to a loopback service and its response straight back.
 *
 * Everything here that isn't plumbing exists to keep a stream a stream. `accept-encoding`
 * is dropped on the way up so nothing upstream can gzip — a compressed stream buffers by
 * nature, and no amount of flushing downstream recovers it. `flushHeaders` sends the head
 * as soon as the upstream status arrives, so the browser's `fetch` resolves and starts
 * reading before the first event rather than after it. `x-accel-buffering` asks whatever
 * sits in front of us to do the same.
 */
export function proxyRequest(req: IncomingMessage, res: ServerResponse, target: ProxyTarget, path: string): void {
  const headers = withoutHopByHop(req.headers);
  headers.host = target.hostHeader;
  delete headers["accept-encoding"];

  req.socket.setNoDelay(true);

  const upstream = request(
    { host: target.host, port: target.port, method: req.method ?? "GET", path, headers },
    (response) => {
      res.writeHead(response.statusCode ?? 502, {
        ...withoutHopByHop(response.headers),
        "x-accel-buffering": "no",
      });
      res.flushHeaders();
      response.pipe(res);
    }
  );

  upstream.on("socket", (socket) => socket.setNoDelay(true));
  upstream.on("error", () => {
    if (!res.headersSent) plain(res, 502, "The service behind this path is not answering.");
    else res.end();
  });
  // A closed tab must not leave a turn running upstream.
  req.on("aborted", () => upstream.destroy());

  req.pipe(upstream);
}

// --- the server -------------------------------------------------------------------

export interface DemoRoute extends ProxyTarget {
  /** Matched against the request path, exactly or as a path prefix. */
  prefix: string;
  /** Whether to remove `prefix` before forwarding. The agent server serves `/chat`; the
   *  MCP server owns `/mcp` on both sides. */
  strip: boolean;
}

export interface DemoServerOptions {
  host: string;
  port: number;
  allowedHosts: readonly string[];
  distDir: string;
  routes: readonly DemoRoute[];
}

function routeFor(routes: readonly DemoRoute[], rawPath: string): DemoRoute | undefined {
  return routes.find((route) => rawPath === route.prefix || rawPath.startsWith(`${route.prefix}/`));
}

/** Resolve once the server is listening, so the caller can print an address that is
 *  actually reachable. */
export function startDemoServer(options: DemoServerOptions): Promise<Server> {
  const server = createServer((req, res) => {
    if (!hostAllowed(req.headers.host, options.allowedHosts)) {
      plain(res, 403, `Host ${String(req.headers.host)} is not allowed. Name it with --allowed-host.`);
      return;
    }

    const url = req.url ?? "/";
    const rawPath = url.split(/[?#]/, 1)[0] ?? "/";
    const route = routeFor(options.routes, rawPath);
    if (route) {
      proxyRequest(req, res, route, route.strip ? url.slice(route.prefix.length) || "/" : url);
      return;
    }

    void serveStatic(req, res, options.distDir).catch(() => {
      if (!res.headersSent) plain(res, 500, "Internal error");
      else res.end();
    });
  });

  return new Promise((settle, fail) => {
    server.once("error", fail);
    server.listen(options.port, options.host, () => {
      server.removeListener("error", fail);
      settle(server);
    });
  });
}
