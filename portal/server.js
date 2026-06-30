import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

const PORT = Number(process.env.PORT || 5176);
const HOST = process.env.HOST || "127.0.0.1";
const THUMBNAILS_URL = process.env.THUMBNAILS_URL || "/kurs-thumbnails/";
const PRESENTATIONS_URL = process.env.PRESENTATIONS_URL || "/praesentationsfolien/";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = normalizeRequestPath(url.pathname);

  if (req.method === "GET" && requestPath === "/api/config") {
    return json(res, {
      thumbnailsUrl: THUMBNAILS_URL,
      presentationsUrl: PRESENTATIONS_URL
    });
  }
  if (req.method === "GET" && requestPath === "/") {
    return serveFile(path.join(publicDir, "index.html"), res);
  }
  if (req.method === "GET" && requestPath === "/shared/styles.css") {
    return serveFile(path.join(__dirname, "..", "skillmasters-grafikstil", "styles.css"), res);
  }
  return serveStatic(requestPath, res);
});

server.listen(PORT, HOST, () => {
  console.log(`skillmasters-Portal laeuft auf http://${HOST}:${PORT}`);
});

function serveStatic(requestPath, res) {
  const cleanPath = decodeURIComponent(requestPath);
  const filePath = path.normalize(path.join(publicDir, cleanPath));
  if (!filePath.startsWith(publicDir)) return notFound(res);
  serveFile(filePath, res);
}

function serveFile(filePath, res) {
  readFile(filePath)
    .then((content) => {
      res.writeHead(200, { "Content-Type": mime(filePath) });
      res.end(content);
    })
    .catch(() => notFound(res));
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Nicht gefunden");
}

function normalizeRequestPath(value) {
  const pathname = decodeURIComponent(value || "/");
  if (pathname !== "/" && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function mime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";
}
