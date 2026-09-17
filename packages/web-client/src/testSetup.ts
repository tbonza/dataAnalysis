import { JSDOM } from "jsdom";

/**
 * Installs a jsdom `window`/`document`/`navigator` as globals before any DOM-touching
 * test module runs (loaded via `node --test --import`). App code (`Chart.tsx`,
 * `CopyButton.tsx`, `download.ts`, `clipboard.ts`) references the bare `document`/
 * `navigator` identifiers exactly as it would in a real browser — this is what lets it
 * run unmodified under `node:test`.
 *
 * Node itself already defines a minimal `navigator` (just `userAgent`), so that one is
 * force-replaced with jsdom's fuller version below rather than skipped; everything else
 * jsdom's `window` offers is only added where Node doesn't already have a global of
 * that name, so this never clobbers `console`, `process`, `Buffer`, and so on. Note
 * jsdom's `navigator` has no `clipboard` either (jsdom doesn't implement the Clipboard
 * API) — tests that need it stub `navigator.clipboard` themselves.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

const { window } = dom;
const target = globalThis as unknown as Record<string, unknown>;

// Force these three first — `window` is itself one of `window`'s own properties (the
// self-reference every Window has), so setting it before the copy loop below means
// that loop's own "window" entry is already `in target` and gets skipped, instead of
// copying a non-configurable descriptor that a later explicit set couldn't redefine.
for (const [name, value] of Object.entries({ window, document: window.document, navigator: window.navigator })) {
  Object.defineProperty(target, name, { value, configurable: true, writable: true, enumerable: true });
}

for (const name of Object.getOwnPropertyNames(window)) {
  if (name in target) continue;
  const descriptor = Object.getOwnPropertyDescriptor(window, name);
  if (descriptor) Object.defineProperty(target, name, descriptor);
}

target.IS_REACT_ACT_ENVIRONMENT = true;
