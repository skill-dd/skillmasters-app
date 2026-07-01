import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  CI,
  assetTypes,
  lessonIcons,
  lessonIconSvg,
  lessonWaveSvg,
  lockedStyle,
  referenceImagePath,
  symbolSystem
} from "../skillmasters-grafikstil/index.js";
import {
  createGalleryStore,
  createPathHelpers,
  createRateLimiter,
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

const PORT = Number(process.env.PORT || 5177);
const HOST = process.env.HOST || "127.0.0.1";
const APP_PATHS = {
  portal: normalizeRoutePath(process.env.PORTAL_PATH || "/__portal"),
  thumbnails: normalizeRoutePath(process.env.THUMBNAILS_PATH || "/"),
  presentations: normalizeRoutePath(process.env.PRESENTATIONS_PATH || "/__praesentationsfolien")
};
const PUBLIC_BASE_PATH = normalizeRoutePath(process.env.PUBLIC_BASE_PATH || "/");
const { publicAppPaths, withBasePath } = createPathHelpers(APP_PATHS, PUBLIC_BASE_PATH);
const ideasRateLimit = createRateLimiter({
  max: Number(process.env.RATE_LIMIT_IDEAS_PER_HOUR || 40),
  label: "Bildideen"
});
const generateRateLimit = createRateLimiter({
  max: Number(process.env.RATE_LIMIT_GENERATE_PER_HOUR || 10),
  label: "Bilderzeugung"
});
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
        lessonIcons,
        symbolSystem,
        ci: CI,
        imageSize: process.env.OPENAI_IMAGE_SIZE || "1536x864",
        app: "thumbnails",
        paths: publicAppPaths()
      });
    }
    if (req.method === "GET" && requestPath === "/api/gallery") {
      return json(res, await readGallery(url.searchParams.get("app") || ""));
    }
    if (req.method === "POST" && requestPath === "/api/ideas") {
      ideasRateLimit(req);
      return json(res, await createIdeas(await parseJsonBody(req, maxJsonBytes)));
    }
    if (req.method === "POST" && requestPath === "/api/generate") {
      generateRateLimit(req);
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
  console.log(`skillmasters-Kurs-Thumbnails laeuft auf http://${HOST}:${PORT}`);
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
    ideas: parsed.ideas.slice(0, 3).map(cleanIdeaText)
  };
}

function buildIdeasPrompt(normalized) {
  if (normalized.type === "course") return buildCourseIdeasPrompt(normalized);
  if (normalized.type === "lesson") return buildLessonIdeasPrompt(normalized);
  return buildChapterIdeasPrompt(normalized);
}

function buildCourseIdeasPrompt(normalized) {
  return `
Du entwickelst Inhalt und exakt 3 konkrete Bildideen fuer eine Skillmasters-Kursgrafik.

Einsatzart: ${assetTypes[normalized.type].label}
Titel:
${normalized.title}
Optionaler Kurs-/Fachkontext:
${normalized.context || "nicht angegeben"}
Vorhandene Nutzerkorrektur zur Inhaltsannahme:
${normalized.contentSummary || "keine"}
Vorhandene Nutzerkorrektur zum Lernziel:
${normalized.learningGoal || "keine"}
Vorhandene Nutzerkorrektur zur visuellen Metapher:
${normalized.visualMetaphor || "keine"}

Aufgabe:
- Leite aus dem kurzen Titel eine plausible fachliche Inhaltsannahme fuer den gesamten Kurs ab.
- Denke kursweit, aber verdichte radikal auf ein einziges Titelbild-Motiv.
- Erfinde keine spezifischen Fakten, Normen, Foerderbedingungen, Paragraphen oder Produktdetails.
- Wenn der Titel mehrdeutig ist, bleibe allgemein und nutze den optionalen Kontext.
- Formuliere eine klare Kernaussage und ein konkretes Lernziel fuer den gesamten Kurs.
- Entwickle eine visuelle Metapher, die aus dem Fachinhalt kommt, nicht aus generischen Standard-Icons.
- Jede Bildidee muss auf den ersten Blick als Thumbnail funktionieren: ein grosses Hauptobjekt, maximal ein kleiner Nebenakzent.
- Vermeide Kurslandkarten, Prozessuebersichten, Netzwerke, viele Kacheln, viele Dokumente, mehrere Stationen, Pfeilketten, Dashboards und kleinteilige Icon-Sammlungen.
- Bevorzuge ein einzelnes konkretes Motiv wie ein stark vereinfachtes Arbeitsmittel, ein einzelnes Kursartefakt, ein Modellbaustein, ein Schutzobjekt, ein Qualitaetszeichen, ein Projektordner oder ein klarer Pruefpunkt.
- Verwende Kompass, Rakete, Leuchtturm, Wegweiser, Zielscheibe und Lupe nur, wenn sie wirklich aus dem Titel folgen.
- Keine Menschen, keine Personen.
- Keine Textelemente im Bild.
- Jede Idee muss ein anderes konkretes Motiv verwenden.
- Jede Idee ist nur eine kurze Motivbeschreibung mit maximal 12 Woertern.
- Keine Erklaersaetze, keine Begruendung, keine Klammern.
- Schreibe nicht "Hauptmotiv:" und nicht "Satz:".

Antworte ausschliesslich als JSON:
{"coreMessage":"...","contentSummary":"...","learningGoal":"...","emotion":"","visualMetaphor":"...","ideas":["...","...","..."]}
`.trim();
}

function buildChapterIdeasPrompt(normalized) {
  return `
Du entwickelst Inhalt und exakt 3 konkrete Bildideen fuer ein Skillmasters-Kapitel-Thumbnail.

Einsatzart: ${assetTypes[normalized.type].label}
Kapitelnummer: ${normalized.number || "keine"}
Titel:
${normalized.title}
Optionaler Kurs-/Fachkontext:
${normalized.context || "nicht angegeben"}
Vorhandene Nutzerkorrektur zur Inhaltsannahme:
${normalized.contentSummary || "keine"}
Vorhandene Nutzerkorrektur zum Lernziel:
${normalized.learningGoal || "keine"}
Vorhandene Nutzerkorrektur zur visuellen Metapher:
${normalized.visualMetaphor || "keine"}

Aufgabe:
- Leite aus dem kurzen Titel eine plausible fachliche Inhaltsannahme ab.
- Erfinde keine spezifischen Fakten, Normen, Foerderbedingungen, Paragraphen oder Produktdetails.
- Wenn der Titel mehrdeutig ist, bleibe allgemein und nutze den optionalen Kontext.
- Formuliere eine klare Kernaussage und ein konkretes Lernziel.
- Entwickle eine stark vereinfachte visuelle Metapher, die aus dem Fachinhalt kommt.
- Jede Bildidee muss auf den ersten Blick als Thumbnail funktionieren: ein grosses Hauptobjekt, maximal ein kleiner Nebenakzent.
- Wenn der Titel einen Prozess beschreibt, verdichte ihn auf ein einziges Uebergangs- oder Ergebnisobjekt, keine Ablaufkette.
- Vermeide Ablaufstationen, Prozessstrassen, Pfeilketten, mehrere Tische, viele Dokumente, mehrere Marker, Dashboards und kleinteilige Icon-Sammlungen.
- Bevorzuge ein einzelnes konkretes Motiv wie eine Mappe, ein Baustein, ein Arbeitsmittel, ein Pruefpunkt, ein Schutzobjekt, ein Projektordner oder ein Qualitaetszeichen.
- Verwende Kompass, Rakete, Leuchtturm, Wegweiser, Zielscheibe und Lupe nur, wenn sie wirklich aus dem Titel folgen.
- Keine Menschen, keine Personen.
- Keine Textelemente im Bild.
- Jede Idee muss ein anderes konkretes Motiv verwenden.
- Jede Idee ist nur eine kurze Motivbeschreibung mit maximal 12 Woertern.
- Keine Erklaersaetze, keine Begruendung, keine Klammern.
- Schreibe nicht "Thumbnail-Idee", nicht "Hauptmotiv:" und nicht "Satz:".

Antworte ausschliesslich als JSON:
{"coreMessage":"...","contentSummary":"...","learningGoal":"...","emotion":"","visualMetaphor":"...","ideas":["...","...","..."]}
`.trim();
}

function buildLessonIdeasPrompt(normalized) {
  return `
Du entwickelst Inhalt und exakt 3 konkrete Bildideen fuer ein Skillmasters-Lektion-Thumbnail.

Einsatzart: ${assetTypes[normalized.type].label}
Festes Lektionssymbol links: ${normalized.lessonIconLabel}
Titel:
${normalized.title}
Optionaler Kurs-/Fachkontext:
${normalized.context || "nicht angegeben"}
Vorhandene Nutzerkorrektur zur Inhaltsannahme:
${normalized.contentSummary || "keine"}
Vorhandene Nutzerkorrektur zum Lernziel:
${normalized.learningGoal || "keine"}
Vorhandene Nutzerkorrektur zur visuellen Metapher:
${normalized.visualMetaphor || "keine"}

Aufgabe:
- Leite aus dem kurzen Titel eine plausible fachliche Inhaltsannahme ab.
- Erfinde keine spezifischen Fakten, Normen, Foerderbedingungen, Paragraphen oder Produktdetails.
- Wenn der Titel mehrdeutig ist, bleibe allgemein und nutze den optionalen Kontext.
- Formuliere eine klare Kernaussage und ein konkretes Lernziel.
- Entwickle eine stark vereinfachte visuelle Metapher fuer die rechte Bildseite.
- Das feste Lektionssymbol links ist nur die Typ-Markierung und darf nicht Teil der Bildidee sein.
- Jede Bildidee muss auf den ersten Blick als Thumbnail funktionieren: ein grosses Hauptobjekt rechts, maximal ein kleiner Nebenakzent.
- Wenn der Titel einen Prozess beschreibt, verdichte ihn auf ein einziges Uebergangs- oder Ergebnisobjekt, keine Ablaufkette.
- Vermeide Ablaufstationen, Pruefstationen, Prozessachsen, Pfeile, mehrere Ordner, viele Unterlagen, Bewertungsboegen, Rollenplaettchen, Netzwerke und kleinteilige Icon-Sammlungen.
- Bevorzuge ein einzelnes konkretes Motiv wie ein Modellbaustein, ein Arbeitsmittel, ein Pruefpunkt, eine Mappe, ein Schutzobjekt, ein Projektordner oder ein Qualitaetszeichen.
- Verwende Kompass, Rakete, Leuchtturm, Wegweiser, Zielscheibe und Lupe nur, wenn sie wirklich aus dem Titel folgen.
- Keine Menschen, keine Personen.
- Keine Textelemente im Bild.
- Jede Idee muss ein anderes konkretes Motiv verwenden.
- Jede Idee ist nur eine kurze Motivbeschreibung mit maximal 12 Woertern.
- Keine Erklaersaetze, keine Begruendung, keine Klammern.
- Schreibe nicht "Thumbnail-Idee", nicht "Hauptmotiv:" und nicht "Satz:".

Antworte ausschliesslich als JSON:
{"coreMessage":"...","contentSummary":"...","learningGoal":"...","emotion":"","visualMetaphor":"...","ideas":["...","...","..."]}
`.trim();
}

async function generateImages(payload) {
  const normalized = normalizePayload(payload);
  const typeConfig = assetTypes[normalized.type];
  const count = Math.max(1, Math.min(Number(payload.count || 1), typeConfig.maxImages));
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
    componentCount: 1,
    componentCountRecommendation: 1
  }, selectedIdea);
  const saved = [];
  for (let index = 0; index < count; index += 1) {
    const image = await generateOpenAIImage(prompt);

    const item = image.data?.[0];
    let buffer = item?.b64_json
      ? Buffer.from(item.b64_json, "base64")
      : await downloadImage(item?.url);
    if (!buffer) throw new Error("Die Bild-API hat kein Bild zurueckgegeben.");
    if (normalized.type === "lesson") {
      buffer = await applyLessonIcon(buffer, normalized.lessonIcon);
    }

    const stamp = safeStamp();
    const suffix = count > 1 ? `-${index + 1}` : "";
    const baseName = `${stamp}-${normalized.type}${normalized.number ? `-${normalized.number}` : ""}${normalized.lessonIcon ? `-${normalized.lessonIcon}` : ""}${suffix}`;
    const imageFile = path.join(outputImagesDir, `${baseName}.png`);
    const promptFile = path.join(outputPromptsDir, `${baseName}.json`);
    await writeFile(imageFile, buffer);
    const svgUrl = "";

    const promptRecord = {
      createdAt: new Date().toISOString(),
      type: normalized.type,
      typeLabel: typeConfig.label,
      number: normalized.number,
      lessonIcon: normalized.lessonIcon,
      lessonIconLabel: normalized.lessonIconLabel,
      title: normalized.title,
      context: normalized.context,
      text: normalized.text,
      contentSummary: payload.contentSummary || normalized.contentSummary || "",
      coreMessage: payload.coreMessage || "",
      learningGoal: payload.learningGoal || "",
      emotion: payload.emotion || "",
      visualMetaphor: payload.visualMetaphor || "",
      componentCount: 1,
      componentCountRecommendation: 1,
      selectedIdea,
      prompt,
      svgUrl,
      svgPrompt: "",
      svgPostProcessing: "",
      fixedIconPostProcessing: normalized.type === "lesson"
        ? "Das linke Lektionssymbol wurde nach der KI-Generierung als festes SVG pixelgleich in die finale PNG-Datei eingesetzt."
        : "",
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
      number: normalized.number,
      lessonIcon: normalized.lessonIcon,
      lessonIconLabel: normalized.lessonIconLabel,
      selectedIdea,
      imageUrl: withBasePath(`/outputs/images/${baseName}.png`),
      svgUrl
    });
  }

  const gallery = await readGallery();
  await writeGallery([...saved, ...gallery]);
  return { saved };
}

function buildImagePrompt(payload, selectedIdea) {
  if (payload.type === "course") return buildCourseImagePrompt(payload, selectedIdea);
  if (payload.type === "lesson") return buildLessonImagePrompt(payload, selectedIdea);
  return buildChapterImagePrompt(payload, selectedIdea);
}

function buildCourseImagePrompt(payload, selectedIdea) {
  return `
Create one final 16:9 Skillmasters course overview graphic.

Selected metaphor idea:
${selectedIdea}

Thumbnail input:
- Title: ${payload.title || ""}
- Context: ${payload.context || ""}
- Assumed content: ${payload.contentSummary || payload.coreMessage || ""}
- Learning goal: ${payload.learningGoal || ""}
- Visual metaphor: ${payload.visualMetaphor || ""}

Composition:
- No number.
- No red divider line.
- No fixed lesson icon.
- No left-side marker area.
- Place one very large central symbol in the middle of the canvas.
- The main symbol should fill roughly 45-58% of the canvas width, centered around x=50%, y=43%, with generous white space and a subtle pale support circle if useful.
- Use one immediately understandable course-level metaphor only.
- Allow at most one tiny supporting accent. If the idea mentions several objects, choose the strongest single object and ignore the rest.
- Make the visual feel like a course cover or course overview, not a chapter or lesson tile.
- Include the fixed navy wave in the lower-right corner, similar to the reference thumbnail style.
- Keep the icon large and clear, but not crowded: no oversized floor object, no complex base, no full scene.
- Make the core course message instantly visible.

${lockedStyle}

Additional hard rules for course graphics:
- Absolutely no text, labels, letters, or numbers.
- Do not draw any red vertical divider.
- Do not reserve or decorate a left marker area.
- Do not draw a course map, process map, network, dashboard, multi-card board, connected platforms, arrows between stations, or several separate icons.
- Do not include more than one main object.
`.trim();
}

function buildChapterImagePrompt(payload, selectedIdea) {
  return `
Create one final 16:9 Skillmasters course graphic.

Selected metaphor idea:
${selectedIdea}

Thumbnail input:
- Title: ${payload.title || ""}
- Context: ${payload.context || ""}
- Assumed content: ${payload.contentSummary || payload.coreMessage || ""}
- Learning goal: ${payload.learningGoal || ""}
- Visual metaphor: ${payload.visualMetaphor || ""}

Include the large two-digit number "${payload.number}" on the left, in ${CI.navy}. Place it like Bild03: left edge around 5-7% of canvas width, top around 15-17%, height around 52-58% of canvas. Add one thin vertical red divider line close to the number, at about 25% of canvas width, from about 18% to 72% of canvas height. The number is the only text-like element allowed.

Composition:
- Number on the left, red divider line close to the number, large central symbol on the right.
- Increase the actual symbol size to 200% compared with the previous generated result. It should dominate the right half while still leaving white space.
- Use the Bild03 layout proportions, but enlarge the icon: icon center around x=68%, y=43%; pale circle behind it around 46-54% canvas height; navy wave small like Bild11, tucked into the lower-right corner with only slight overlap allowed.
- Match the layout of Bild03 / reference tile 08: large number at far left, red divider close to the number, icon group on the right.
- The red divider sits close to the number: around 24-27% from the left edge, not near the center of the canvas.
- Use one single central symbol only; never merge two symbols, for example never combine lighthouse plus compass.
- Allow at most one tiny supporting accent. If the idea mentions several objects, choose the strongest single object and ignore the rest.
- If the title or idea describes a process, show one single result or transition object, not a sequence.
- The icon must stay simple, but not small: no oversized floor object, no complex base, no full scene.
- Make the core message instantly visible.
- Include the fixed small navy wave in the lower-right corner.

${lockedStyle}

Additional hard rules for chapter thumbnails:
- Do not draw process roads, arrows between stages, multiple tables, connected stations, dashboards, many documents, networks, or separate icon collections.
- Do not include more than one main object on the right side.
`.trim();
}

function buildLessonImagePrompt(payload, selectedIdea) {
  return `
Create one final 16:9 Skillmasters lesson thumbnail graphic.

Selected metaphor idea for the right-side illustration:
${selectedIdea}

Thumbnail input:
- Title: ${payload.title || ""}
- Context: ${payload.context || ""}
- Assumed content: ${payload.contentSummary || payload.coreMessage || ""}
- Learning goal: ${payload.learningGoal || ""}
- Visual metaphor: ${payload.visualMetaphor || ""}

The fixed lesson icon "${payload.lessonIconLabel}" will be added later by the server. Do not draw this icon yourself.

Composition:
- No number.
- Leave the entire left icon area blank white from x=4% to x=22% and y=12% to y=70%. Do not place any symbol, mark, shadow, text, number, or decoration there.
- Add one thin vertical red divider line close to the blank icon area, at about 25% of canvas width, from about 18% to 72% of canvas height.
- Large central symbol on the right, using the selected metaphor idea.
- Increase the actual right-side symbol size to 200% compared with small generated thumbnails. It should dominate the right half while still leaving white space.
- Use the Bild03 layout proportions: icon center around x=68%, y=43%; pale circle behind it around 46-54% canvas height; navy wave much smaller than Bild11, tucked tightly into the lower-right corner with minimal overlap only.
- Match the reference tile layout: left marker area, red divider close to it, icon group on the right.
- The red divider sits around 24-27% from the left edge, not near the center of the canvas.
- Use one single central metaphor symbol on the right; never merge unrelated full symbols.
- Allow at most one tiny supporting accent. If the idea mentions several objects, choose the strongest single object and ignore the rest.
- If the title or idea describes a process, show one single result or transition object, not a sequence.
- The right icon must stay simple, but not small: no oversized floor object, no complex base, no full scene.
- Make the core message instantly visible.
- Include a small fixed navy wave in the lower-right corner: about 25-28% canvas width and 34-38% canvas height, still smaller and lower than the chapter-thumbnail wave.

${lockedStyle}

Additional hard rules for lesson thumbnails:
- Absolutely no text, labels, letters, or numbers.
- Do not draw any left-side icon. The server will place the fixed pixel-identical lesson symbol after generation.
- Do not draw process roads, arrows between stages, rows of stations, multiple folders, checklists plus binders, dashboards, networks, or separate icon collections.
- Do not include more than one main object on the right side.
`.trim();
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
  if (type === "presentation") throw new Error("Diese App erzeugt nur Kurs-Thumbnails.");
  const typeConfig = assetTypes[type];
  const isThumbnail = type === "course" || type === "chapter" || type === "lesson";
  const title = isThumbnail ? String(payload.title || payload.text || "").trim() : "";
  const context = isThumbnail ? String(payload.context || "").trim() : "";
  const text = isThumbnail ? title : String(payload.text || "").trim();
  if (isThumbnail && title.length < 3) throw new Error("Bitte einen Titel eingeben.");
  if (!isThumbnail && text.length < 20) throw new Error("Bitte einen Sprechertext mit mindestens 20 Zeichen eingeben.");
  const number = typeConfig.needsNumber ? normalizeNumber(payload.number) : "";
  const lessonIcon = typeConfig.needsLessonIcon ? normalizeLessonIcon(payload.lessonIcon) : "";
  const lessonIconLabel = lessonIcon ? lessonIcons.find((icon) => icon.id === lessonIcon).label : "";
  return {
    type,
    title,
    context,
    text,
    contentSummary: String(payload.contentSummary || "").trim(),
    coreMessage: String(payload.coreMessage || "").trim(),
    learningGoal: String(payload.learningGoal || "").trim(),
    emotion: String(payload.emotion || "").trim(),
    visualMetaphor: String(payload.visualMetaphor || "").trim(),
    number,
    lessonIcon,
    lessonIconLabel
  };
}

function normalizeNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) throw new Error("Bitte eine Nummer eingeben.");
  return digits.padStart(2, "0").slice(-2);
}

function normalizeLessonIcon(value) {
  const id = String(value || "").trim();
  if (!lessonIcons.some((icon) => icon.id === id)) {
    throw new Error("Bitte ein gueltiges Lektionssymbol auswaehlen.");
  }
  return id;
}

async function applyLessonIcon(buffer, iconId) {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 1536;
  const height = metadata.height || 864;
  const scale = width / 1536;
  const overlaySize = Math.round(392 * scale);
  const left = Math.round(28 * scale);
  const top = Math.round((height - overlaySize) / 2);
  const cleanPlate = Buffer.from(`
    <svg width="${overlaySize}" height="${overlaySize}" viewBox="0 0 270 270" xmlns="http://www.w3.org/2000/svg">
      <rect width="270" height="270" fill="${CI.white}"/>
    </svg>
  `);
  const icon = Buffer.from(lessonIconSvg(iconId, overlaySize));
  const wave = Buffer.from(lessonWaveSvg(width, height));

  return sharp(buffer)
    .composite([
      { input: wave, left: 0, top: 0 },
      { input: cleanPlate, left, top },
      { input: icon, left, top }
    ])
    .png()
    .toBuffer();
}

function cleanIdeaText(value) {
  return String(value || "")
    .replace(/^\s*(thumbnail-idee|bildidee|hauptmotiv)\s*\d*\s*[:.-]\s*/i, "")
    .replace(/\s+(satz|visualisiert|zeigt|verdeutlicht)\s*[:.-].*$/i, "")
    .replace(/\s+[–-]\s*(visualisiert|zeigt|verdeutlicht)\s+.*$/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localIdeas(payload) {
  const title = payload.title || payload.text;
  const context = payload.context ? ` im Kontext ${payload.context}` : "";
  return {
    ...payload,
    coreMessage: `${title} wird als konkreter fachlicher Einstieg verstanden.`,
    contentSummary: payload.contentSummary || `Der Titel beschreibt ein kompaktes Lernstueck${context}, das zentrale Begriffe, Ablauf oder Rollen klaert.`,
    learningGoal: payload.learningGoal || "Der Zuschauer versteht, worum es in dieser Einheit fachlich geht und worauf er achten soll.",
    emotion: "Klarheit",
    visualMetaphor: payload.visualMetaphor || "Ein konkretes Arbeits- oder Prozessartefakt visualisiert den Kern des Titels.",
    ideas: [
      "Ein grosser Projektordner mit einem farbigen Registertab.",
      "Ein robuster Werkzeugkasten mit einem hervorgehobenen Werkzeug.",
      "Ein schlichtes Qualitaetssiegel mit kleinem roten Akzent."
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
