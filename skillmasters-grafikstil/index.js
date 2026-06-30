import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CI = {
  navy: "#0F0F3C",
  red: "#F44336",
  white: "#FFFFFF"
};

export const referenceImagePath = path.join(__dirname, "assets", "thumbnail-referenzbild.png");

export const assetTypes = {
  course: { label: "Kurs", maxImages: 1, needsNumber: false },
  chapter: { label: "Kapitel", maxImages: 1, needsNumber: true },
  lesson: { label: "Lektion", maxImages: 1, needsNumber: false, needsLessonIcon: true },
  presentation: { label: "Praesentation", maxImages: 3, needsNumber: false }
};

export const lessonIcons = [
  { id: "video", label: "Video" },
  { id: "pdf", label: "PDF" },
  { id: "text", label: "Text" },
  { id: "exam", label: "Prüfung" },
  { id: "certificate", label: "Zertifikat" },
  { id: "iframe", label: "iFrame" },
  { id: "task", label: "Aufgabe" }
];

export const symbolSystem = [
  { symbol: "Kompass", meaning: "Strategie" },
  { symbol: "Leuchtturm", meaning: "Orientierung" },
  { symbol: "Werkzeug", meaning: "Umsetzung" },
  { symbol: "Zielscheibe", meaning: "Ziel" },
  { symbol: "Lupe", meaning: "Analyse" },
  { symbol: "Rakete", meaning: "Wachstum" },
  { symbol: "Buch", meaning: "Wissen" },
  { symbol: "Segelboot", meaning: "Transformation" },
  { symbol: "Warnschild", meaning: "Fehler" },
  { symbol: "Wegweiser", meaning: "Entscheidung" },
  { symbol: "Diagramm", meaning: "Erfolg" },
  { symbol: "Filmklappe", meaning: "Video" }
];

export const lockedStyle = `
Use the exact visual language of the supplied Skillmasters reference thumbnail:
minimal premium course-thumbnail style, white background, strong white space,
one large central symbol illustration, clean navy line art, subtle dimensional
plasticity, small red accent only where useful, subtle card-like depth, no clutter.

Reference matching details:
- Match the reference image more than the written idea.
- Use simple geometric background support only when the mode-specific prompt allows it.
- Use slight 3D/plastic depth like the reference: soft inner shading, subtle
  navy shadow under the icon, gently rounded vector edges.
- Keep line weights elegant and moderate, not oversized.
- Do not combine multiple full symbols into one complex scene.

Hard rules:
- 16:9 landscape composition.
- Use only these colors: ${CI.navy}, ${CI.red}, ${CI.white}.
- No people, no faces, no hands, no body parts.
- No text, no labels, no words, no letters, and no numbers unless an explicit
  chapter number instruction is present.
- Visualize only one core message.
- Use one immediately understandable metaphor.
- Do not add red light beams, glow cones, gradients, or dramatic effects.
- Do not change style, palette, composition logic, or illustration density.
`.trim();

export function lessonIconSvg(iconId, size) {
  const stroke = CI.navy;
  const red = CI.red;
  const common = `fill="none" stroke="${stroke}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"`;
  const redCommon = `fill="none" stroke="${red}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"`;
  const body = {
    video: `<circle cx="135" cy="135" r="88" ${common}/><path d="M117 96l66 39-66 39z" fill="${red}" stroke="${stroke}" stroke-width="13" stroke-linejoin="round"/>`,
    pdf: `<path d="M56 32h137l52 52v155a20 20 0 0 1-20 20H76a20 20 0 0 1-20-20z" ${common}/><path d="M193 32v58h52" ${common}/><path d="M100 123h101M100 162h101M100 201h101" ${common}/><path d="M204 47l28 28" ${redCommon}/>`,
    text: `<path d="M68 72h134v45M135 72v130M106 202h58M72 72v41M198 72v41" ${common}/>`,
    exam: `<circle cx="135" cy="135" r="88" ${common}/><path d="M110 108c5-21 25-33 46-23 18 9 23 32 5 45-16 11-26 19-26 36" ${redCommon}/><circle cx="135" cy="195" r="8" fill="${red}"/>`,
    certificate: `<path d="M135 31l21 18 30-5 14 27 28 11 3 31 21 22-21 22-3 31-28 11-14 27-30-5-21 18-21-18-30 5-14-27-28-11-3-31-21-22 21-22 3-31 28-11 14-27 30 5z" ${common}/><circle cx="135" cy="135" r="49" ${redCommon}/><path d="M90 204l-31 56 49-20 27 29M180 204l31 56-49-20-27 29" ${common}/>`,
    iframe: `<path d="M104 72L54 135l50 63M166 72l50 63-50 63" ${common}/><path d="M146 55l-22 160" ${redCommon}/>`,
    task: `<rect x="54" y="64" width="162" height="166" rx="25" ${common}/><rect x="99" y="31" width="72" height="50" rx="18" ${common}/><path d="M100 150l27 27 63-76" ${redCommon}/>`
  }[iconId] || "";

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 270 270" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="10" stdDeviation="6" flood-color="${CI.navy}" flood-opacity=".14"/>
        </filter>
      </defs>
      <g filter="url(#shadow)">${body}</g>
    </svg>
  `;
}

export function lessonWaveSvg(width, height) {
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <path d="M ${width * 0.73} ${height} C ${width * 0.83} ${height * 0.82}, ${width * 0.95} ${height * 0.78}, ${width} ${height * 0.58} L ${width} ${height} Z" fill="${CI.navy}"/>
    </svg>
  `;
}
