import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CI,
  assetTypes,
  lockedStyle,
  referenceImagePath,
  symbolSystem
} from "../skillmasters-grafikstil/index.js";
import {
  createGalleryStore,
  createPathHelpers,
  createStaticServer,
  downloadImage,
  extractResponseText,
  isRemovedGrafikenPath,
  json,
  loadEnv,
  matchesRoute,
  normalizeRequestPath,
  normalizeRoutePath,
  notFound,
  openAI,
  openAIForm,
  readJson as parseJsonBody,
  safeStamp,
  serveFile
} from "../skillmasters-grafikstil/server-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const outputImagesDir = path.join(__dirname, "outputs", "images");
const outputPromptsDir = path.join(__dirname, "outputs", "prompts");
const dataDir = path.join(__dirname, "data");
const galleryPath = path.join(__dirname, "data", "gallery.json");
const maxJsonBytes = Number(process.env.MAX_JSON_BYTES || 1_000_000);

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5178);
const HOST = process.env.HOST || "127.0.0.1";
const APP_PATHS = {
  portal: normalizeRoutePath(process.env.PORTAL_PATH || "/__portal"),
  thumbnails: normalizeRoutePath(process.env.THUMBNAILS_PATH || "/__kurs-thumbnails"),
  presentations: normalizeRoutePath(process.env.PRESENTATIONS_PATH || "/")
};
const PUBLIC_BASE_PATH = normalizeRoutePath(process.env.PUBLIC_BASE_PATH || "/");
const { publicAppPaths, withBasePath } = createPathHelpers(APP_PATHS, PUBLIC_BASE_PATH);
const galleryStore = createGalleryStore({
  galleryPath,
  dataDir,
  filterTypes: {
    thumbnails: ["course", "chapter", "lesson"],
    presentations: ["presentation"]
  },
  withBasePath
});
const serveStatic = createStaticServer({
  appDir: __dirname,
  publicDir,
  sharedStylesPath: path.join(__dirname, "..", "skillmasters-grafikstil", "styles.css"),
  outputDir: path.join(__dirname, "outputs")
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const requestPath = normalizeRequestPath(url.pathname);

    if (req.method === "GET" && requestPath === "/api/config") {
      return json(res, {
        assetTypes,
        symbolSystem,
        ci: CI,
        imageSize: process.env.OPENAI_IMAGE_SIZE || "1536x864",
        app: "presentations",
        paths: publicAppPaths()
      });
    }
    if (req.method === "GET" && requestPath === "/api/gallery") {
      return json(res, await readGallery(url.searchParams.get("app") || ""));
    }
    if (req.method === "POST" && requestPath === "/api/ideas") {
      return json(res, await createIdeas(await parseJsonBody(req, maxJsonBytes)));
    }
    if (req.method === "POST" && requestPath === "/api/generate") {
      return json(res, await generateImages(await parseJsonBody(req, maxJsonBytes)));
    }
    if (req.method === "GET" && isRemovedGrafikenPath(requestPath)) {
      return notFound(res);
    }
    if (req.method === "GET" && matchesRoute(requestPath, APP_PATHS.portal)) {
      return serveFile(path.join(publicDir, "portal.html"), res);
    }
    if (req.method === "GET" && matchesRoute(requestPath, APP_PATHS.thumbnails)) {
      return serveFile(path.join(publicDir, "index.html"), res);
    }
    if (req.method === "GET" && matchesRoute(requestPath, APP_PATHS.presentations)) {
      return serveFile(path.join(publicDir, "index.html"), res);
    }
    if (requestPath === "/") {
      return notFound(res);
    }
    return serveStatic(requestPath, res);
  } catch (error) {
    console.error(error);
    json(res, { error: error.message || "Unbekannter Fehler" }, error.status || 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`skillmasters-Praesentationsfolien laeuft auf http://${HOST}:${PORT}`);
});

async function createIdeas(payload) {
  const normalized = normalizePayload(payload);
  const prompt = buildIdeasPrompt(normalized);

  if (!process.env.OPENAI_API_KEY) {
    return localIdeas(normalized);
  }

  const result = await openAI("/v1/responses", {
    model: process.env.OPENAI_TEXT_MODEL || "gpt-5-mini",
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "skillmasters_ideas",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["coreMessage", "contentSummary", "learningGoal", "emotion", "visualMetaphor", "ideas"],
          properties: {
            coreMessage: { type: "string" },
            contentSummary: { type: "string" },
            learningGoal: { type: "string" },
            emotion: { type: "string" },
            visualMetaphor: { type: "string" },
            ideas: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: { type: "string" }
            }
          }
        }
      }
    }
  });

  const text = extractResponseText(result);
  const parsed = JSON.parse(text);
  return {
    ...normalized,
    coreMessage: parsed.coreMessage,
    contentSummary: parsed.contentSummary || parsed.coreMessage || "",
    learningGoal: parsed.learningGoal || "",
    emotion: parsed.emotion || "",
    visualMetaphor: parsed.visualMetaphor || "",
    ideas: parsed.ideas.slice(0, 3)
  };
}

function buildIdeasPrompt(normalized) {
  return buildPresentationIdeasPrompt(normalized);
}

function buildPresentationIdeasPrompt(normalized) {
  return `
Du entwickelst exakt 3 kurze Bildideen fuer eine Skillmasters-Praesentationsgrafik.

Deine Aufgabe ist nicht, den gesamten Sprechertext zu illustrieren, sondern die eine staerkste Kernaussage zu identifizieren und daraus eine einzige, sofort verstaendliche visuelle Metapher zu entwickeln.
Wichtig: Vereinfache nicht so stark, dass konkrete Kernelemente des Sprechertexts verloren gehen. Wenn der Sprechertext konkrete Objekte, Unterlagen, Artefakte oder Ergebnisse nennt, sollen diese in der Bildidee erhalten bleiben, sofern sie die Kernaussage tragen.

Sprechertext:
${normalized.text}

Schritt 1 - Analyse:
Analysiere den Sprechertext und ermittle:
- die zentrale Botschaft
- das eigentliche Lernziel
- die Emotion, die vermittelt werden soll
- welche Aussage der Zuschauer nach 2 Sekunden verstanden haben soll

Schritt 2 - Verdichtung:
Pruefe kritisch, ob sich die Bildidee auf eine einzige Kernaussage konzentriert.
Falls mehrere Aussagen enthalten sind, vereinfache sie so lange, bis eine starke, sofort verstaendliche Metapher uebrig bleibt, aber bewahre die wichtigsten konkreten Sprechertext-Objekte.
Wenn der Sprechertext eindeutig einen Prozess, eine Entwicklung oder mehrere konkrete Bausteine beschreibt, darf die Metapher maximal 3 einfache, nebeneinander angeordnete Elemente zeigen. Sonst bleibt es bei einer einzigen zentralen Symbol-Metapher.

Stil- und Inhaltsregeln:
- Keine Menschen, keine Personen.
- Keine Textelemente im Bild.
- Gleicher Skillmasters-Grafikstil wie die Referenz.
- Bildideen sollen sich sichtbar auf den Sprechertext beziehen. Nutze konkrete Motive aus dem Sprechertext, z. B. Dokumente, Konzepte, Kursfundament, Kapitel, Produktion, Ziel, Vorbereitung.
- Wenn mehrere Grafiken vorgeschlagen werden, beschreibe sie als horizontale Abfolge nebeneinander, nicht gestapelt oder aufeinander.
- Verwende bevorzugt dieses Symbolsystem und ergaenze es nur wenn wirklich noetig:
${symbolSystem.map((item) => `${item.symbol} = ${item.meaning}`).join(", ")}
- Jede Idee nur als ein kurzer deutscher Satz.

Antworte ausschliesslich als JSON:
{"coreMessage":"...","contentSummary":"...","learningGoal":"...","emotion":"...","visualMetaphor":"...","ideas":["...","...","..."]}
`.trim();
}

async function generateImages(payload) {
  const normalized = normalizePayload(payload);
  const typeConfig = assetTypes[normalized.type];
  const count = Math.max(1, Math.min(Number(payload.count || 1), typeConfig.maxImages));
  const componentCount = normalized.type === "presentation"
    ? Math.max(1, Math.min(Number(payload.componentCount || 1), 3))
    : 1;
  const componentCountRecommendation = normalized.type === "presentation"
    ? Math.max(1, Math.min(Number(payload.componentCountRecommendation || componentCount), 3))
    : 1;
  const selectedIdea = String(payload.selectedIdea || "").trim();
  if (!selectedIdea) throw new Error("Bitte zuerst eine Bildidee auswaehlen.");
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY fehlt. Bitte in der .env-Datei eintragen.");
  }

  await mkdir(outputImagesDir, { recursive: true });
  await mkdir(outputPromptsDir, { recursive: true });

  const prompt = buildImagePrompt({
    ...normalized,
    contentSummary: payload.contentSummary || normalized.contentSummary || "",
    coreMessage: payload.coreMessage || "",
    learningGoal: payload.learningGoal || "",
    emotion: payload.emotion || "",
    visualMetaphor: payload.visualMetaphor || "",
    componentCount,
    componentCountRecommendation
  }, selectedIdea);
  const saved = [];
  for (let index = 0; index < count; index += 1) {
    const image = await generateOpenAIImage(prompt);

    const item = image.data?.[0];
    let buffer = item?.b64_json
      ? Buffer.from(item.b64_json, "base64")
      : await downloadImage(item?.url);
    if (!buffer) throw new Error("Die Bild-API hat kein Bild zurueckgegeben.");

    const stamp = safeStamp();
    const suffix = count > 1 ? `-${index + 1}` : "";
    const baseName = `${stamp}-${normalized.type}${suffix}`;
    const imageFile = path.join(outputImagesDir, `${baseName}.png`);
    const svgFile = path.join(outputImagesDir, `${baseName}.svg`);
    const promptFile = path.join(outputPromptsDir, `${baseName}.json`);
    await writeFile(imageFile, buffer);
    let svgPrompt = "";
    let svgUrl = "";
    svgPrompt = buildPresentationSvgPrompt({
      ...normalized,
      coreMessage: payload.coreMessage || "",
      learningGoal: payload.learningGoal || "",
      emotion: payload.emotion || "",
      visualMetaphor: payload.visualMetaphor || "",
      componentCount
    }, selectedIdea);
    const svg = await generatePresentationSvg(svgPrompt);
    await writeFile(svgFile, svg);
    svgUrl = withBasePath(`/outputs/images/${baseName}.svg`);

    const promptRecord = {
      createdAt: new Date().toISOString(),
      type: normalized.type,
      typeLabel: typeConfig.label,
      title: normalized.title,
      context: normalized.context,
      text: normalized.text,
      contentSummary: payload.contentSummary || normalized.contentSummary || "",
      coreMessage: payload.coreMessage || "",
      learningGoal: payload.learningGoal || "",
      emotion: payload.emotion || "",
      visualMetaphor: payload.visualMetaphor || "",
      componentCount,
      componentCountRecommendation,
      selectedIdea,
      prompt,
      svgUrl,
      svgPrompt,
      svgPostProcessing: "Zusätzlich zur PNG wurde eine vereinfachte, echte und editierbare SVG-Version im Skillmasters-Stil erzeugt.",
      fixedIconPostProcessing: "",
      styleReference: "assets/thumbnail-referenzbild.png",
      imageSize: process.env.OPENAI_IMAGE_SIZE || "1536x864",
      ci: CI
    };
    await writeFile(promptFile, `${JSON.stringify(promptRecord, null, 2)}\n`);

    saved.push({
      id: baseName,
      createdAt: promptRecord.createdAt,
      type: normalized.type,
      typeLabel: typeConfig.label,
      selectedIdea,
      imageUrl: withBasePath(`/outputs/images/${baseName}.png`),
      svgUrl,
      promptUrl: withBasePath(`/outputs/prompts/${baseName}.json`)
    });
  }

  const gallery = await readGallery();
  await writeGallery([...saved, ...gallery]);
  return { saved };
}

function buildImagePrompt(payload, selectedIdea) {
  return buildPresentationImagePrompt(payload, selectedIdea);
}

function buildPresentationImagePrompt(payload, selectedIdea) {
  return `
Create one final 16:9 Skillmasters presentation graphic.

Selected metaphor idea:
${selectedIdea}

Analysis context:
- Core message: ${payload.coreMessage || ""}
- Learning goal: ${payload.learningGoal || ""}
- Emotion: ${payload.emotion || ""}
- Visual metaphor: ${payload.visualMetaphor || ""}

Composition:
- No number.
- No red divider line.
- No navy wave, no corner wave, no bottom wave.
- No pale gray background circle. Do not draw any circle behind the symbol.
- The top 25% of the canvas must be completely empty white space reserved for a later two-line headline. No icon, line, shadow, circle, accent, or graphic may enter this top 25% zone.
- Place all visual content below the top 25% reserved headline zone.
- The selected composition must contain exactly ${payload.componentCount || 1} ${Number(payload.componentCount || 1) === 1 ? "single graphic element" : "separate graphic elements"}.
- If componentCount is 1: show one strong central symbol/metaphor only.
- If componentCount is 2: show two clearly separated but related graphic elements arranged side by side horizontally, not stacked and not overlapping.
- If componentCount is 3: show at most three simple process steps arranged side by side horizontally, not stacked and not overlapping; only use this when the idea/process justifies it.
- The visual elements must remain meaningfully tied to the speaker text. Preserve concrete objects from the selected idea instead of replacing them with generic symbols.
- The image must be understandable in two seconds and work without text.
- Use clean navy line art, small red accents, and the same plastic depth as the reference.

${lockedStyle}

Additional hard rules for presentation graphics:
- Absolutely no text, labels, letters, numbers, UI, captions, or title.
- Absolutely no people.
- Absolutely no wave shape.
- Absolutely no pale gray circle or circular background shape.
- Absolutely keep the upper 25% blank white.
- Multiple graphic elements must be next to each other horizontally, never on top of each other.
`.trim();
}

function buildPresentationSvgPrompt(payload, selectedIdea) {
  return `
Create a real editable SVG illustration for a Skillmasters presentation graphic.

Return only raw SVG markup. Do not wrap it in markdown. Do not explain anything.

Selected metaphor idea:
${selectedIdea}

Analysis context:
- Core message: ${payload.coreMessage || ""}
- Learning goal: ${payload.learningGoal || ""}
- Emotion: ${payload.emotion || ""}
- Visual metaphor: ${payload.visualMetaphor || ""}
- Component count: ${payload.componentCount || 1}

SVG requirements:
- Root must be: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 864" width="1536" height="864">
- White background rectangle covering the full canvas.
- Keep the top 25% of the canvas completely blank white for a later two-line headline.
- Place all illustration elements below y=216.
- Use only these colors: ${CI.navy}, ${CI.red}, ${CI.white}. You may use opacity, but no other color values.
- No text, no labels, no words, no letters, no numbers, and no <text> elements.
- No people, no faces, no hands, no body parts.
- No gray circle, no background circle, no wave, no corner wave.
- Build a simplified editable vector version of the selected idea.
- Use clean navy strokes, white fills, and small red accents.
- Add subtle plastic depth only with SVG filters using ${CI.navy} as flood-color with low opacity.
- If component count is 1: create one central metaphor.
- If component count is 2: create two separate horizontal graphic elements.
- If component count is 3: create three simple horizontal process elements.
- Multiple elements must be arranged side by side, not stacked and not overlapping.
- Keep shapes simple and editable: path, line, polyline, polygon, rect, circle, ellipse, g, defs, filter are acceptable.
- No external images, no embedded raster images, no external URLs.

The SVG must be understandable in two seconds and fit the Skillmasters reference style.
`.trim();
}

async function generatePresentationSvg(svgPrompt) {
  const result = await openAI("/v1/responses", {
    model: process.env.OPENAI_TEXT_MODEL || "gpt-5-mini",
    input: svgPrompt
  });
  const raw = extractResponseText(result);
  const svg = normalizeSvgMarkup(raw);
  validatePresentationSvg(svg);
  return `${svg}\n`;
}

function normalizeSvgMarkup(value) {
  let svg = String(value || "").trim();
  svg = svg.replace(/^```(?:svg|xml)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = svg.indexOf("<svg");
  const end = svg.lastIndexOf("</svg>");
  if (start !== -1 && end !== -1) {
    svg = svg.slice(start, end + "</svg>".length).trim();
  }
  return svg;
}

function validatePresentationSvg(svg) {
  if (!svg.trim().startsWith("<svg")) throw new Error("SVG-Ausgabe ist ungueltig: kein <svg>-Root.");
  if (!svg.includes("</svg>")) throw new Error("SVG-Ausgabe ist ungueltig: </svg> fehlt.");
  if (/<script\b/i.test(svg)) throw new Error("SVG-Ausgabe ist ungueltig: script-Tags sind nicht erlaubt.");
  if (/<text\b/i.test(svg)) throw new Error("SVG-Ausgabe ist ungueltig: Text-Elemente sind nicht erlaubt.");
  if (/<image\b/i.test(svg)) throw new Error("SVG-Ausgabe ist ungueltig: Rasterbilder sind nicht erlaubt.");
  if (/\b(?:href|src)\s*=\s*["']https?:\/\//i.test(svg)) throw new Error("SVG-Ausgabe ist ungueltig: externe Links sind nicht erlaubt.");
  const withoutXmlns = svg.replace(/xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/gi, "");
  if (/https?:\/\//i.test(withoutXmlns)) throw new Error("SVG-Ausgabe ist ungueltig: externe URLs sind nicht erlaubt.");
  if (/url\(\s*['"]?(?!#)/i.test(svg)) throw new Error("SVG-Ausgabe ist ungueltig: externe url()-Referenzen sind nicht erlaubt.");

  const allowed = new Set([CI.navy.toLowerCase(), CI.red.toLowerCase(), CI.white.toLowerCase()]);
  const colors = svg.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  for (const color of colors) {
    if (!allowed.has(color.toLowerCase())) {
      throw new Error(`SVG-Ausgabe ist ungueltig: Farbe ${color} ist nicht erlaubt.`);
    }
  }
}

async function generateOpenAIImage(prompt) {
  if (existsSync(referenceImagePath)) {
    try {
      const form = new FormData();
      form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
      form.append("prompt", prompt);
      form.append("size", process.env.OPENAI_IMAGE_SIZE || "1536x864");
      form.append("quality", process.env.OPENAI_IMAGE_QUALITY || "medium");
      form.append("n", "1");
      const reference = new Blob([await readFile(referenceImagePath)], { type: "image/png" });
      form.append("image", reference, "thumbnail-referenzbild.png");
      return await openAIForm("/v1/images/edits", form);
    } catch (error) {
      console.warn(`Referenzbild-Edit fehlgeschlagen, nutze Generierung: ${error.message}`);
    }
  }

  return openAI("/v1/images/generations", {
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    prompt,
    size: process.env.OPENAI_IMAGE_SIZE || "1536x864",
    quality: process.env.OPENAI_IMAGE_QUALITY || "medium",
    n: 1
  });
}

function normalizePayload(payload) {
  const type = String(payload.type || "").trim();
  if (!assetTypes[type]) throw new Error("Bitte eine gueltige Einsatzart auswaehlen.");
  if (type !== "presentation") throw new Error("Diese App erzeugt nur Praesentationsfolien.");
  const text = String(payload.text || "").trim();
  if (text.length < 20) throw new Error("Bitte einen Sprechertext mit mindestens 20 Zeichen eingeben.");
  return {
    type,
    title: "",
    context: "",
    text,
    contentSummary: String(payload.contentSummary || "").trim(),
    coreMessage: String(payload.coreMessage || "").trim(),
    learningGoal: String(payload.learningGoal || "").trim(),
    emotion: String(payload.emotion || "").trim(),
    visualMetaphor: String(payload.visualMetaphor || "").trim(),
    number: "",
    lessonIcon: "",
    lessonIconLabel: ""
  };
}

function localIdeas(payload) {
  const lower = payload.text.toLowerCase();
  const symbol = lower.includes("strategie") ? "Kompass"
    : lower.includes("fehler") || lower.includes("risiko") ? "Warnschild"
    : lower.includes("analyse") || lower.includes("daten") ? "Lupe"
    : lower.includes("wachstum") || lower.includes("skal") ? "Rakete"
    : lower.includes("entscheidung") ? "Wegweiser"
    : lower.includes("wissen") || lower.includes("lernen") ? "Buch"
    : "Zielscheibe";
  return {
    ...payload,
    coreMessage: "Eine zentrale Aussage aus dem Sprechertext wird als einfache Metapher verdichtet.",
    learningGoal: "Der Zuschauer versteht die wichtigste Lernbotschaft auf einen Blick.",
    emotion: "Klarheit",
    visualMetaphor: `${symbol} als einfache visuelle Metapher.`,
    ideas: [
      `${symbol} als klares Hauptsymbol fuer die wichtigste Aussage.`,
      `Leuchtturm mit ruhiger Lichtmarkierung als Zeichen fuer Orientierung.`,
      `Wegweiser mit einer hervorgehobenen Richtung als Bild fuer die naechste Entscheidung.`
    ],
    note: "Lokale Vorschlaege, weil noch kein OPENAI_API_KEY gesetzt ist."
  };
}

async function readGallery(app = "") {
  return galleryStore.read(app);
}

async function writeGallery(entries) {
  await galleryStore.write(entries);
}
