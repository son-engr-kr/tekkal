/**
 * Direct Worker client for @drgrice1/tikzjax's run-tex.js.
 *
 * Bypasses tikzjax.js entirely (no MutationObserver, no DOM insertion,
 * no event dispatching). Talks to the Worker via the `threads` library
 * postMessage protocol:
 *
 *   Master → Worker:  {type:"run", uid, method, args}
 *   Worker → Master:  {type:"init"|"running"|"result"|"error", uid, ...}
 *   Worker → Master:  raw string  (TeX console output)
 *
 * Assets served from /tikzjax/ (copied from node_modules by postinstall).
 */

import { assert } from "@/utils/assert";

// Respect Vite's base path (e.g. "/tekkal/" for GitHub Pages without custom domain)
const TIKZJAX_BASE = `${import.meta.env.BASE_URL}tikzjax`.replace(/\/\//g, "/");

/**
 * Standard preamble prepended to every render.
 * Mirrors server/deckApi.ts → wrapTikzDocument().
 */
const STANDARD_PREAMBLE = [
  "\\usepackage{pgfplots}",
  "\\pgfplotsset{compat=1.18}",
].join("\n");

// ── Worker lifecycle ────────────────────────────────────────────────

let workerReady: Promise<Worker> | null = null;
let rpcUid = 0;

function getWorker(): Promise<Worker> {
  if (workerReady) return workerReady;

  workerReady = (async () => {
    // Inject fonts.css (needed for SVG text rendering)
    if (!document.querySelector(`link[href="${TIKZJAX_BASE}/fonts.css"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${TIKZJAX_BASE}/fonts.css`;
      document.head.appendChild(link);
    }

    const worker = await spawnWorker();
    const baseUrl = `${location.origin}${TIKZJAX_BASE}`;
    console.log("[tikzjax] Loading TeX engine from", baseUrl);
    await rpc(worker, "load", [baseUrl]);
    console.log("[tikzjax] TeX engine ready");
    return worker;
  })();

  // Reset on failure so next attempt retries
  workerReady.catch(() => { workerReady = null; });

  return workerReady;
}

/** Spawn a Worker from run-tex.js and wait for the threads "init" message. */
function spawnWorker(): Promise<Worker> {
  return new Promise<Worker>((resolve, reject) => {
    const url = `${location.origin}${TIKZJAX_BASE}/run-tex.js`;
    const blob = new Blob(
      [`importScripts(${JSON.stringify(url)});`],
      { type: "application/javascript" },
    );
    const worker = new Worker(URL.createObjectURL(blob));

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("[tikzjax] Worker init timeout (10 s)"));
    }, 10_000);

    function onMsg(e: MessageEvent) {
      if (typeof e.data === "object" && e.data?.type === "init") {
        clearTimeout(timeout);
        worker.removeEventListener("message", onMsg);
        worker.removeEventListener("error", onErr);

        // Forward TeX console output permanently
        worker.addEventListener("message", (ev: MessageEvent) => {
          if (typeof ev.data === "string") console.log("tikzjax:", ev.data);
        });

        resolve(worker);
      }
    }

    function onErr(e: ErrorEvent) {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(`[tikzjax] Worker load error: ${e.message}`));
    }

    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
  });
}

// ── RPC (threads protocol) ──────────────────────────────────────────

/**
 * Call an exposed method on the Worker and return the result.
 * Implements the threads.js master→worker protocol.
 */
function rpc(worker: Worker, method: string, args: unknown[]): Promise<unknown> {
  const uid = ++rpcUid;

  return new Promise((resolve, reject) => {
    function onMsg(e: MessageEvent) {
      const msg = e.data;
      // Ignore console strings and messages for other UIDs
      if (typeof msg !== "object" || msg.uid !== uid) return;

      if (msg.type === "result" && msg.complete) {
        done();
        resolve(msg.payload);
      } else if (msg.type === "error") {
        done();
        const err = msg.error;
        if (err?.__error_marker === "$$error") {
          reject(Object.assign(new Error(err.message), { name: err.name }));
        } else {
          reject(new Error(String(err)));
        }
      }
      // "running" → informational, ignore
    }

    function done() {
      worker.removeEventListener("message", onMsg);
    }

    worker.addEventListener("message", onMsg);
    worker.postMessage({ type: "run", uid, method, args });
  });
}

// ── Font embedding ──────────────────────────────────────────────────

/** Cache fetched font data (base64) across renders to avoid re-fetching. */
const fontDataCache = new Map<string, string>();

/**
 * Extract unique font-family names referenced in the SVG markup.
 * dvi2html emits `font-family="cmr10"` attributes on <text> elements.
 */
function extractFontFamilies(svg: string): string[] {
  const families = new Set<string>();
  // Match font-family="..." attribute (with or without quotes)
  const attrRe = /font-family="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(svg)) !== null) {
    families.add(m[1]!.trim());
  }
  // Match font-family:'...' in inline style attributes
  const styleRe = /font-family:\s*'?([^;'"]+)/g;
  while ((m = styleRe.exec(svg)) !== null) {
    families.add(m[1]!.trim());
  }
  return [...families];
}

/**
 * Fetch a woff2 font file and return its base64 data URI.
 * Results are cached globally so repeated renders don't re-fetch.
 */
async function fetchFontAsBase64(fontName: string): Promise<string | null> {
  const cached = fontDataCache.get(fontName);
  if (cached) return cached;

  const url = `${location.origin}${TIKZJAX_BASE}/fonts/${fontName}.woff2`;
  const resp = await fetch(url);
  if (!resp.ok) {
    console.warn(`[tikzjax] Font not found: ${fontName} (${resp.status})`);
    return null;
  }

  const buf = await resp.arrayBuffer();
  // Convert ArrayBuffer to base64
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const b64 = btoa(binary);
  const dataUri = `data:font/woff2;base64,${b64}`;
  fontDataCache.set(fontName, dataUri);
  return dataUri;
}

/**
 * Embed @font-face declarations with base64 data URIs into the SVG,
 * making it self-contained so fonts render correctly inside <img> tags.
 */
async function embedFonts(svg: string): Promise<string> {
  const families = extractFontFamilies(svg);
  if (families.length === 0) return svg;

  console.log("[tikzjax] Embedding fonts:", families.join(", "));

  const fontFaces: string[] = [];
  await Promise.all(
    families.map(async (name) => {
      const dataUri = await fetchFontAsBase64(name);
      if (dataUri) {
        fontFaces.push(
          `@font-face { font-family: '${name}'; src: url('${dataUri}') format('woff2'); }`,
        );
      }
    }),
  );

  if (fontFaces.length === 0) return svg;

  const styleBlock = `<defs><style>${fontFaces.join("\n")}</style></defs>`;

  // Insert after the opening <svg ...> tag
  const svgTagEnd = svg.indexOf(">", svg.indexOf("<svg"));
  assert(svgTagEnd !== -1, "Could not find <svg> opening tag");
  return svg.slice(0, svgTagEnd + 1) + styleBlock + svg.slice(svgTagEnd + 1);
}

// ── IndexedDB SVG cache ─────────────────────────────────────────────

// Cache is regenerable (SHA-256 keyed compile outputs), so no migration
// from the legacy "deckode-tikz-cache" database. Orphan cost is negligible.
const CACHE_DB = "tekkal-tikz-cache";
const CACHE_STORE = "svgCache";

function openCacheDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(CACHE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheKey(content: string, preamble: string): Promise<string> {
  const data = new TextEncoder().encode(content + "\0" + preamble);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getCachedSvg(
  content: string,
  preamble: string,
): Promise<string | null> {
  const key = await cacheKey(content, preamble);
  const db = await openCacheDB();
  return new Promise((resolve) => {
    const tx = db.transaction(CACHE_STORE, "readonly");
    const req = tx.objectStore(CACHE_STORE).get(key);
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function setCachedSvg(
  content: string,
  preamble: string,
  svg: string,
): Promise<void> {
  const key = await cacheKey(content, preamble);
  const db = await openCacheDB();
  return new Promise((resolve) => {
    const tx = db.transaction(CACHE_STORE, "readwrite");
    tx.objectStore(CACHE_STORE).put(svg, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve(); // don't fail on cache errors
  });
}

// ── Public API ──────────────────────────────────────────────────────

export async function renderTikzToSvg(
  content: string,
  preamble?: string,
): Promise<string> {
  const fullPreamble = preamble
    ? STANDARD_PREAMBLE + "\n" + preamble
    : STANDARD_PREAMBLE;

  // Check IndexedDB cache first
  const cached = await getCachedSvg(content, fullPreamble);
  if (cached) {
    console.log("[tikzjax] Cache hit, skipping WASM compilation");
    return cached;
  }

  const worker = await getWorker();

  const dataset: Record<string, string> = {
    showConsole: "true",
    addToPreamble: fullPreamble,
  };

  console.log("[tikzjax] Compiling TikZ, content length:", content.length);
  const svgHtml = (await rpc(worker, "texify", [content, dataset])) as string;
  console.log("[tikzjax] SVG generated, length:", svgHtml.length);

  // Embed fonts directly into SVG for <img> tag rendering
  const svgWithFonts = await embedFonts(svgHtml);
  console.log("[tikzjax] Fonts embedded, final length:", svgWithFonts.length);

  // Store in cache for future renders
  await setCachedSvg(content, fullPreamble, svgWithFonts);

  return svgWithFonts;
}
