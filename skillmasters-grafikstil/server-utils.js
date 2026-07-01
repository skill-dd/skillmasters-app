import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export function loadEnv(envPath) {
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

export function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

export function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Nicht gefunden");
}

export function safeStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function readJson(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("Anfrage ist zu gross.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("Ungueltiges JSON.");
    error.status = 400;
    throw error;
  }
}

export function createRateLimiter({ windowMs = 60 * 60 * 1000, max = 20, label = "Anfragen" } = {}) {
  const buckets = new Map();

  return function checkRateLimit(req) {
    const now = Date.now();
    const key = clientIp(req);
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;

    bucket.count += 1;
    buckets.set(key, bucket);
    cleanupBuckets(buckets, now);

    if (bucket.count > max) {
      const minutes = Math.max(1, Math.ceil((bucket.resetAt - now) / 60_000));
      const error = new Error(`${label}: zu viele Anfragen. Bitte in ca. ${minutes} Min. erneut versuchen.`);
      error.status = 429;
      throw error;
    }
  };
}

export async function openAI(endpoint, body) {
  const response = await fetch(`https://api.openai.com${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI-Fehler ${response.status}`);
  }
  return data;
}

export async function openAIForm(endpoint, form) {
  const response = await fetch(`https://api.openai.com${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI-Fehler ${response.status}`);
  }
  return data;
}

export function extractResponseText(result) {
  if (result.output_text) return result.output_text;
  const parts = [];
  for (const item of result.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

export async function downloadImage(url) {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

export function normalizeRoutePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

export function normalizeRequestPath(value) {
  const pathname = decodeURIComponent(value || "/");
  if (pathname !== "/" && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}

export function matchesRoute(requestPath, routePath) {
  return requestPath === routePath;
}

export function isRemovedGrafikenPath(requestPath) {
  return requestPath === "/grafiken" || requestPath.startsWith("/grafiken/");
}

export function createPathHelpers(appPaths, publicBasePath = "/") {
  const normalizedBase = normalizeRoutePath(publicBasePath);
  return {
    publicAppPaths() {
      return {
        portal: displayRoutePath(appPaths.portal),
        thumbnails: displayRoutePath(appPaths.thumbnails),
        presentations: displayRoutePath(appPaths.presentations)
      };
    },
    withBasePath(urlPath) {
      const cleanPath = `/${String(urlPath || "").replace(/^\/+/, "")}`;
      if (normalizedBase === "/") return cleanPath;
      if (cleanPath === normalizedBase || cleanPath.startsWith(`${normalizedBase}/`)) return cleanPath;
      return `${normalizedBase}${cleanPath}`;
    }
  };
}

export function createGalleryStore({ galleryPath, dataDir, filterTypes, withBasePath }) {
  return {
    async read(app = "") {
      if (!existsSync(galleryPath)) return [];
      const text = await readFile(galleryPath, "utf8");
      const entries = text.trim() ? JSON.parse(text) : [];
      if (!Array.isArray(entries)) return [];
      return filterGallery(entries, app, filterTypes).map((item) => publicGalleryItem(item, withBasePath));
    },
    async write(entries) {
      await mkdir(dataDir, { recursive: true });
      await writeFile(galleryPath, `${JSON.stringify(entries, null, 2)}\n`);
    }
  };
}

export function createStaticServer({ appDir, publicDir, sharedStylesPath, outputDir }) {
  return function serveStatic(requestPath, res) {
    const cleanPath = decodeURIComponent(requestPath === "/" ? "/index.html" : requestPath);
    if (cleanPath === "/shared/styles.css") {
      return serveFile(sharedStylesPath, res);
    }
    if (cleanPath.startsWith("/outputs/prompts/")) {
      return notFound(res);
    }
    const isOutput = cleanPath.startsWith("/outputs/");
    const root = path.resolve(isOutput ? outputDir : publicDir);
    const relativePath = isOutput ? cleanPath.slice("/outputs/".length) : cleanPath.replace(/^\/+/, "");
    const filePath = path.resolve(root, relativePath);
    if (!isInsidePath(root, filePath) || !isInsidePath(appDir, filePath)) {
      return json(res, { error: "Nicht erlaubt" }, 403);
    }

    serveFile(filePath, res);
  };
}

export function serveFile(filePath, res) {
  readFile(filePath)
    .then((content) => {
      res.writeHead(200, { "Content-Type": mime(filePath) });
      res.end(content);
    })
    .catch(() => notFound(res));
}

function filterGallery(entries, app, filterTypes) {
  if (app === "thumbnails") return entries.filter((item) => filterTypes.thumbnails.includes(item.type));
  if (app === "presentations") return entries.filter((item) => filterTypes.presentations.includes(item.type));
  return entries;
}

function publicGalleryItem(item, withBasePath) {
  const { promptUrl, ...publicItem } = item;
  return {
    ...publicItem,
    imageUrl: withBasePath(publicItem.imageUrl),
    svgUrl: publicItem.svgUrl ? withBasePath(publicItem.svgUrl) : ""
  };
}

function clientIp(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwardedFor || req.socket.remoteAddress || "unknown";
}

function cleanupBuckets(buckets, now) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function displayRoutePath(routePath) {
  return routePath === "/" ? "/" : `${routePath}/`;
}

function isInsidePath(root, filePath) {
  return filePath === root || filePath.startsWith(`${root}${path.sep}`);
}

function mime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  }[ext] || "application/octet-stream";
}
