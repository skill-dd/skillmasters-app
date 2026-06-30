import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const outputImagesDir = path.join(__dirname, "outputs", "images");
const outputPromptsDir = path.join(__dirname, "outputs", "prompts");
const dataDir = path.join(__dirname, "data");
const galleryPath = path.join(__dirname, "data", "gallery.json");

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5178);
const HOST = process.env.HOST || "127.0.0.1";
const APP_PATHS = {
  portal: normalizeRoutePath(process.env.PORTAL_PATH || "/__portal"),
  thumbnails: normalizeRoutePath(process.env.THUMBNAILS_PATH || "/__kurs-thumbnails"),
  presentations: normalizeRoutePath(process.env.PRESENTATIONS_PATH || "/")
};

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
        app: "presentations",
        paths: publicAppPaths()
      });
    }
    if (req.method === "GET" && requestPath === "/api/gallery") {
      return json(res, await readGallery(url.searchParams.get("app") || ""));
    }
    if (req.method === "POST" && requestPath === "/api/ideas") {
      return json(res, await createIdeas(await readJson(req)));
    }
    if (req.method === "POST" && requestPath === "/api/generate") {
      return json(res, await generateImages(await readJson(req)));
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
    json(res, { error: error.message || "Unbekannter Fehler" }, 500);
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
  if (normalized.type === "presentation") return buildPresentationIdeasPrompt(normalized);
  if (normalized.type === "lesson") return buildLessonIdeasPrompt(normalized);
  return buildChapterIdeasPrompt(normalized);
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
- Entwickle eine visuelle Metapher, die aus dem Fachinhalt kommt, nicht aus generischen Standard-Icons.
- Bevorzuge konkrete Motive wie Unterlagen, Checklisten, Ablaufstationen, Rollenmarkierungen, Modellbausteine, Sicherheitszeichen, Qualitaetspruefung, Projektartefakte, Entscheidungsunterlagen, Prozessuebergaben oder Arbeitsmittel.
- Verwende Kompass, Rakete, Leuchtturm, Wegweiser, Zielscheibe und Lupe nur, wenn sie wirklich aus dem Titel folgen.
- Keine Menschen, keine Personen.
- Keine Textelemente im Bild.
- Jede Idee muss ein anderes konkretes Motiv verwenden.
- Jede Idee erklaert in einem kurzen deutschen Satz sichtbar, welchen Inhalt sie visualisiert.

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
- Entwickle eine visuelle Metapher fuer die rechte Bildseite, die aus dem Fachinhalt kommt.
- Das feste Lektionssymbol links ist nur die Typ-Markierung und darf nicht Teil der Bildidee sein.
- Bevorzuge konkrete Motive wie Unterlagen, Checklisten, Ablaufstationen, Rollenmarkierungen, Modellbausteine, Sicherheitszeichen, Qualitaetspruefung, Projektartefakte, Entscheidungsunterlagen, Prozessuebergaben oder Arbeitsmittel.
- Verwende Kompass, Rakete, Leuchtturm, Wegweiser, Zielscheibe und Lupe nur, wenn sie wirklich aus dem Titel folgen.
- Keine Menschen, keine Personen.
- Keine Textelemente im Bild.
- Jede Idee muss ein anderes konkretes Motiv verwenden.
- Jede Idee erklaert in einem kurzen deutschen Satz sichtbar, welchen Inhalt sie visualisiert.

Antworte ausschliesslich als JSON:
{"coreMessage":"...","contentSummary":"...","learningGoal":"...","emotion":"","visualMetaphor":"...","ideas":["...","...","..."]}
`.trim();
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
    if (normalized.type === "lesson") {
      buffer = await applyLessonIcon(buffer, normalized.lessonIcon);
    }

    const stamp = safeStamp();
    const suffix = count > 1 ? `-${index + 1}` : "";
    const baseName = `${stamp}-${normalized.type}${normalized.number ? `-${normalized.number}` : ""}${normalized.lessonIcon ? `-${normalized.lessonIcon}` : ""}${suffix}`;
    const imageFile = path.join(outputImagesDir, `${baseName}.png`);
    const svgFile = path.join(outputImagesDir, `${baseName}.svg`);
    const promptFile = path.join(outputPromptsDir, `${baseName}.json`);
    await writeFile(imageFile, buffer);
    let svg = "";
    let svgPrompt = "";
    let svgUrl = "";
    if (normalized.type === "presentation") {
      svgPrompt = buildPresentationSvgPrompt({
        ...normalized,
        coreMessage: payload.coreMessage || "",
        learningGoal: payload.learningGoal || "",
        emotion: payload.emotion || "",
        visualMetaphor: payload.visualMetaphor || "",
        componentCount
      }, selectedIdea);
      svg = await generatePresentationSvg(svgPrompt);
      await writeFile(svgFile, svg);
      svgUrl = withBasePath(`/outputs/images/${baseName}.svg`);
    }

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
      componentCount,
      componentCountRecommendation,
      selectedIdea,
      prompt,
      svgUrl,
      svgPrompt,
      svgPostProcessing: normalized.type === "presentation"
        ? "Zusätzlich zur PNG wurde eine vereinfachte, echte und editierbare SVG-Version im Skillmasters-Stil erzeugt."
        : "",
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
      svgUrl,
      promptUrl: withBasePath(`/outputs/prompts/${baseName}.json`)
    });
  }

  const gallery = await readGallery();
  await writeGallery([...saved, ...gallery]);
  return { saved };
}

function buildImagePrompt(payload, selectedIdea) {
  if (payload.type === "presentation") return buildPresentationImagePrompt(payload, selectedIdea);
  if (payload.type === "lesson") return buildLessonImagePrompt(payload, selectedIdea);
  return buildChapterImagePrompt(payload, selectedIdea);
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
- The icon must stay simple, but not small: no oversized floor object, no complex base, no full scene.
- Make the core message instantly visible.
- Include the fixed small navy wave in the lower-right corner.

${lockedStyle}
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
- The right icon must stay simple, but not small: no oversized floor object, no complex base, no full scene.
- Make the core message instantly visible.
- Include a small fixed navy wave in the lower-right corner: about 25-28% canvas width and 34-38% canvas height, still smaller and lower than the chapter-thumbnail wave.

${lockedStyle}

Additional hard rules for lesson thumbnails:
- Absolutely no text, labels, letters, or numbers.
- Do not draw any left-side icon. The server will place the fixed pixel-identical lesson symbol after generation.
`.trim();
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
  const typeConfig = assetTypes[type];
  const isThumbnail = type === "chapter" || type === "lesson";
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

async function openAI(endpoint, body) {
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

async function openAIForm(endpoint, form) {
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

function extractResponseText(result) {
  if (result.output_text) return result.output_text;
  const parts = [];
  for (const item of result.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function localIdeas(payload) {
  if (payload.type === "chapter" || payload.type === "lesson") {
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
        `Eine geordnete Arbeitsunterlage mit markierten Bausteinen visualisiert die Struktur hinter "${title}".`,
        `Drei klare Prozessstationen mit einem hervorgehobenen Uebergabepunkt zeigen den fachlichen Ablauf von "${title}".`,
        `Ein Pruefbogen mit einem einzelnen hervorgehobenen Kernbereich zeigt, worauf es bei "${title}" ankommt.`
      ],
      note: "Lokale Vorschlaege, weil noch kein OPENAI_API_KEY gesetzt ist."
    };
  }

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
    learningGoal: payload.type === "presentation" ? "Der Zuschauer versteht die wichtigste Lernbotschaft auf einen Blick." : "",
    emotion: payload.type === "presentation" ? "Klarheit" : "",
    visualMetaphor: payload.type === "presentation" ? `${symbol} als einfache visuelle Metapher.` : "",
    ideas: [
      `${symbol} als klares Hauptsymbol fuer die wichtigste Aussage.`,
      `Leuchtturm mit ruhiger Lichtmarkierung als Zeichen fuer Orientierung.`,
      `Wegweiser mit einer hervorgehobenen Richtung als Bild fuer die naechste Entscheidung.`
    ],
    note: "Lokale Vorschlaege, weil noch kein OPENAI_API_KEY gesetzt ist."
  };
}

async function downloadImage(url) {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function readGallery(app = "") {
  if (!existsSync(galleryPath)) return [];
  const text = await readFile(galleryPath, "utf8");
  const entries = text.trim() ? JSON.parse(text) : [];
  if (!Array.isArray(entries)) return [];
  return filterGallery(entries, app).map((item) => ({
    ...item,
    imageUrl: withBasePath(item.imageUrl),
    svgUrl: item.svgUrl ? withBasePath(item.svgUrl) : "",
    promptUrl: withBasePath(item.promptUrl)
  }));
}

async function writeGallery(entries) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(galleryPath, `${JSON.stringify(entries, null, 2)}\n`);
}

function filterGallery(entries, app) {
  if (app === "thumbnails") return entries.filter((item) => item.type === "chapter" || item.type === "lesson");
  if (app === "presentations") return entries.filter((item) => item.type === "presentation");
  return entries;
}

function serveStatic(requestPath, res) {
  const cleanPath = decodeURIComponent(requestPath === "/" ? "/index.html" : requestPath);
  if (cleanPath === "/shared/styles.css") {
    return serveFile(path.join(__dirname, "..", "skillmasters-grafikstil", "styles.css"), res);
  }
  const root = cleanPath.startsWith("/outputs/") ? __dirname : publicDir;
  const filePath = path.normalize(path.join(root, cleanPath));
  if (!filePath.startsWith(root)) return json(res, { error: "Nicht erlaubt" }, 403);

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

function withBasePath(urlPath) {
  return urlPath;
}

function normalizeRoutePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function normalizeRequestPath(value) {
  const pathname = decodeURIComponent(value || "/");
  if (pathname !== "/" && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}

function matchesRoute(requestPath, routePath) {
  return requestPath === routePath;
}

function isRemovedGrafikenPath(requestPath) {
  return requestPath === "/grafiken" || requestPath.startsWith("/grafiken/");
}

function publicAppPaths() {
  return {
    portal: displayRoutePath(APP_PATHS.portal),
    thumbnails: displayRoutePath(APP_PATHS.thumbnails),
    presentations: displayRoutePath(APP_PATHS.presentations)
  };
}

function displayRoutePath(routePath) {
  return routePath === "/" ? "/" : `${routePath}/`;
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
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  }[ext] || "application/octet-stream";
}

function safeStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function loadEnv(envPath) {
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
