const state = {
  config: null,
  app: "thumbnails",
  allowedTypes: ["chapter", "lesson"],
  type: "chapter",
  lessonIcon: "video",
  ideasPayload: null,
  selectedIdea: "",
  selectedIndex: -1,
  componentCount: 1,
  componentCountRecommendation: 1
};

const el = {
  modeButtons: [...document.querySelectorAll(".mode-button")],
  formPanel: document.querySelector("#formPanel"),
  numberSection: document.querySelector("#numberSection"),
  numberWrap: document.querySelector("#numberWrap"),
  number: document.querySelector("#number"),
  contextWrap: document.querySelector("#contextWrap"),
  contextInput: document.querySelector("#contextInput"),
  mainInputLabel: document.querySelector("#mainInputLabel"),
  lessonIconSection: document.querySelector("#lessonIconSection"),
  lessonIconGrid: document.querySelector("#lessonIconGrid"),
  scriptText: document.querySelector("#scriptText"),
  ideasBtn: document.querySelector("#ideasBtn"),
  newIdeasBtn: document.querySelector("#newIdeasBtn"),
  generateBtn: document.querySelector("#generateBtn"),
  ideas: document.querySelector("#ideas"),
  status: document.querySelector("#status"),
  coreMessage: document.querySelector("#coreMessage"),
  analysis: document.querySelector("#analysis"),
  analysisCoreLabel: document.querySelector("#analysisCoreLabel"),
  analysisEmotionLabel: document.querySelector("#analysisEmotionLabel"),
  analysisCore: document.querySelector("#analysisCore"),
  analysisEmotion: document.querySelector("#analysisEmotion"),
  analysisMetaphor: document.querySelector("#analysisMetaphor"),
  componentPicker: document.querySelector("#componentPicker"),
  componentRecommendation: document.querySelector("#componentRecommendation"),
  componentOptions: [...document.querySelectorAll(".component-options button")],
  gallery: document.querySelector("#gallery"),
  refreshGallery: document.querySelector("#refreshGallery"),
  latestPreview: document.querySelector("#latestPreview"),
  latestPreviewImage: document.querySelector("#latestPreviewImage"),
  latestPreviewCaption: document.querySelector("#latestPreviewCaption"),
  previewNumber: document.querySelector("#previewNumber"),
  previewLessonIcon: document.querySelector("#previewLessonIcon"),
  previewDivider: document.querySelector("#previewDivider")
};

init();

async function init() {
  state.config = await api("api/config");
  configureAppContext();
  renderLessonIcons();
  bindEvents();
  updateModeUi();
  await loadGallery();
}

function configureAppContext() {
  const path = normalizePath(window.location.pathname);
  const paths = state.config.paths || {};
  state.app = state.config.app || (path === normalizePath(paths.presentations || "/praesentationsfolien/")
    ? "presentations"
    : "thumbnails");
  state.allowedTypes = state.app === "presentations" ? ["presentation"] : ["chapter", "lesson"];
  state.type = state.allowedTypes[0];
  document.body.dataset.app = state.app;
  document.querySelector("#appTitle").textContent = state.app === "presentations"
    ? "Präsentationsfolien"
    : "Kurs-Thumbnails";
  document.querySelector("#appKicker").textContent = state.app === "presentations"
    ? "Skillmasters Foliengrafiken"
    : "Skillmasters Kursgrafiken";
  const portalLink = document.querySelector("#portalLink");
  portalLink.href = paths.portal || "/";
  portalLink.hidden = String(paths.portal || "").startsWith("/__");
}

function bindEvents() {
  el.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.type = button.dataset.type;
      updateModeUi();
    });
  });
  el.number.addEventListener("input", () => {
    el.number.value = el.number.value.replace(/\D/g, "").slice(0, 2);
    el.previewNumber.textContent = normalizedNumber();
  });
  el.ideasBtn.addEventListener("click", createIdeas);
  el.newIdeasBtn.addEventListener("click", createIdeas);
  el.generateBtn.addEventListener("click", generateImage);
  el.refreshGallery.addEventListener("click", loadGallery);
  el.componentOptions.forEach((button) => {
    button.addEventListener("click", () => {
      state.componentCount = Number(button.dataset.count);
      renderComponentPicker();
    });
  });
}

function updateModeUi() {
  const type = currentType();
  const thumbnailMode = isThumbnailMode();
  el.modeButtons.forEach((button) => {
    const visible = state.allowedTypes.includes(button.dataset.type);
    button.hidden = !visible;
    button.classList.toggle("selected", button.dataset.type === state.type);
  });
  document.querySelector(".mode-group").hidden = state.allowedTypes.length < 2;
  el.formPanel.classList.toggle("presentation-mode", state.type === "presentation");
  el.formPanel.classList.toggle("lesson-mode", state.type === "lesson");
  el.formPanel.classList.toggle("thumbnail-mode", thumbnailMode);
  el.numberSection.hidden = !type.needsNumber;
  el.numberWrap.hidden = !type.needsNumber;
  el.contextWrap.hidden = !thumbnailMode;
  el.lessonIconSection.hidden = !type.needsLessonIcon;
  el.previewNumber.hidden = !type.needsNumber;
  el.previewLessonIcon.hidden = !type.needsLessonIcon;
  el.previewDivider.hidden = !(type.needsNumber || type.needsLessonIcon);
  el.previewNumber.textContent = normalizedNumber();
  el.previewLessonIcon.innerHTML = type.needsLessonIcon ? lessonIconSvg(state.lessonIcon) : "";
  el.mainInputLabel.textContent = thumbnailMode ? "Titel" : "Sprechertext";
  el.scriptText.rows = thumbnailMode ? 2 : 9;
  el.scriptText.placeholder = thumbnailMode
    ? "z. B. Was ist INQA-Coaching?"
    : "Sprechertext hier einfuegen...";
  el.ideasBtn.textContent = thumbnailMode
    ? "Inhalt & 3 Bildideen erstellen"
    : "Analyse & 3 Bildideen erstellen";
  resetIdeas();
}

async function createIdeas() {
  setStatus(isThumbnailMode()
    ? "Titel wird in Inhalt, Lernziel und Bildideen uebersetzt..."
    : "Kernaussage, Emotion und Metapher werden verdichtet...");
  try {
    const payload = formPayload();
    resetIdeas({ keepAnalysis: true });
    const data = await api("api/ideas", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.ideasPayload = data;
    renderAnalysis(data);
    renderIdeas(data.ideas);
    el.newIdeasBtn.disabled = false;
    setStatus(data.note || "Drei Bildideen bereit.");
  } catch (error) {
    setStatus(error.message);
  }
}

function renderAnalysis(data) {
  const thumbnailMode = isThumbnailMode();
  el.coreMessage.textContent = thumbnailMode ? data.coreMessage || "" : "";
  if (!thumbnailMode && state.type !== "presentation") {
    el.analysis.hidden = true;
    return;
  }

  el.analysis.hidden = false;
  el.analysisCoreLabel.textContent = thumbnailMode ? "Angenommener Inhalt" : "Kernaussage";
  el.analysisEmotionLabel.textContent = thumbnailMode ? "Lernziel" : "Emotion";
  el.analysisCore.readOnly = !thumbnailMode;
  el.analysisEmotion.readOnly = !thumbnailMode;
  el.analysisMetaphor.readOnly = !thumbnailMode;
  el.analysisCore.value = thumbnailMode
    ? data.contentSummary || data.coreMessage || "Keine Inhaltsannahme erhalten."
    : data.coreMessage || "Keine Kernaussage erhalten.";
  el.analysisEmotion.value = thumbnailMode
    ? data.learningGoal || "Kein Lernziel erhalten."
    : data.emotion || "Keine Emotion erhalten.";
  el.analysisMetaphor.value = data.visualMetaphor || "Keine visuelle Metapher erhalten.";
}

function renderIdeas(ideas) {
  el.ideas.className = "ideas";
  el.ideas.innerHTML = ideas.map((idea, index) => `
    <button class="idea" data-index="${index}">
      ${escapeHtml(idea)}
    </button>
  `).join("");

  el.ideas.querySelectorAll(".idea").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedIndex = Number(button.dataset.index);
      state.selectedIdea = ideas[state.selectedIndex];
      el.ideas.querySelectorAll(".idea").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      updateComponentRecommendation();
      el.generateBtn.disabled = false;
    });
  });
}

function updateComponentRecommendation() {
  if (state.type !== "presentation") {
    el.componentPicker.hidden = true;
    state.componentCount = 1;
    state.componentCountRecommendation = 1;
    return;
  }

  const source = [
    state.selectedIdea,
    state.ideasPayload?.coreMessage,
    state.ideasPayload?.contentSummary,
    state.ideasPayload?.learningGoal,
    state.ideasPayload?.visualMetaphor,
    el.scriptText.value
  ].join(" ").toLowerCase();

  const processTerms = ["prozess", "schritt", "ablauf", "phase", "stufe", "roadmap", "weg", "reise", "erst", "dann", "danach", "drei", "3 "];
  const comparisonTerms = ["vergleich", "gegen", "vs", "unterschied", "zwischen", "ursache", "wirkung", "vorher", "nachher", "problem", "lösung", "zwei", "2 ", "beide", "grobkonzept", "feinkonzept", "unterlagen"];
  const recommended = processTerms.some((term) => source.includes(term))
    ? 3
    : comparisonTerms.some((term) => source.includes(term))
      ? 2
      : 1;

  state.componentCountRecommendation = recommended;
  state.componentCount = recommended;
  renderComponentPicker();
}

function renderComponentPicker() {
  if (state.type !== "presentation" || !state.selectedIdea) {
    el.componentPicker.hidden = true;
    return;
  }

  el.componentPicker.hidden = false;
  el.componentRecommendation.textContent = `${state.componentCountRecommendation} ${state.componentCountRecommendation === 1 ? "Grafik" : "Grafiken"}`;
  el.componentOptions.forEach((button) => {
    button.classList.toggle("selected", Number(button.dataset.count) === state.componentCount);
  });
}

async function generateImage() {
  setStatus("Bild wird erzeugt und gespeichert...");
  el.generateBtn.disabled = true;
  try {
    const payload = {
      ...formPayload(),
      ...analysisPayload(),
      componentCount: state.type === "presentation" ? state.componentCount : 1,
      componentCountRecommendation: state.type === "presentation" ? state.componentCountRecommendation : 1,
      selectedIdea: state.selectedIdea,
      count: 1
    };
    const data = await api("api/generate", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setStatus(`${data.saved.length} Bild gespeichert.`);
    await loadGallery();
  } catch (error) {
    setStatus(error.message);
  } finally {
    el.generateBtn.disabled = !state.selectedIdea;
  }
}

async function loadGallery() {
  const items = await api(`api/gallery?app=${encodeURIComponent(state.app)}`);
  renderLatestPreview(items[0]);
  if (!items.length) {
    el.gallery.className = "gallery empty";
    el.gallery.innerHTML = "<p>Noch keine erzeugten Grafiken.</p>";
    return;
  }
  el.gallery.className = "gallery";
  el.gallery.innerHTML = items.map((item) => `
    <article class="gallery-card">
      <img src="${item.imageUrl}?v=${encodeURIComponent(item.createdAt)}" alt="">
      <div>
        <strong>${escapeHtml(item.typeLabel)}${item.number ? ` ${item.number}` : ""}${item.lessonIconLabel ? ` ${escapeHtml(item.lessonIconLabel)}` : ""}</strong>
        <span>${escapeHtml(item.selectedIdea)}</span>
        <a href="${item.imageUrl}" download>Bild herunterladen</a>
        ${item.svgUrl ? `<a href="${item.svgUrl}" download>SVG herunterladen</a>` : ""}
        <a href="${item.promptUrl}" target="_blank" rel="noreferrer">Prompt ansehen</a>
      </div>
    </article>
  `).join("");
}

function renderLatestPreview(item) {
  if (!item) {
    el.latestPreview.classList.remove("has-image");
    el.latestPreviewImage.removeAttribute("src");
    el.latestPreviewImage.alt = "";
    el.latestPreviewCaption.textContent = "Feste 16:9-Komposition im Referenzstil.";
    return;
  }

  el.latestPreview.classList.add("has-image");
  el.latestPreviewImage.src = `${item.imageUrl}?v=${encodeURIComponent(item.createdAt)}`;
  el.latestPreviewImage.alt = "";
  el.latestPreviewCaption.textContent = `Letztes Bild: ${item.typeLabel}${item.number ? ` ${item.number}` : ""}${item.lessonIconLabel ? ` ${item.lessonIconLabel}` : ""}`;
}

function formPayload() {
  if (isThumbnailMode()) {
    return {
      type: state.type,
      number: normalizedNumber(),
      lessonIcon: state.lessonIcon,
      title: el.scriptText.value.trim(),
      context: el.contextInput.value.trim(),
      ...analysisPayload()
    };
  }

  return {
    type: state.type,
    number: normalizedNumber(),
    lessonIcon: state.lessonIcon,
    text: el.scriptText.value.trim()
  };
}

function analysisPayload() {
  if (isThumbnailMode()) {
    return {
      contentSummary: el.analysisCore.value.trim(),
      coreMessage: state.ideasPayload?.coreMessage || el.analysisCore.value.trim(),
      learningGoal: el.analysisEmotion.value.trim(),
      emotion: state.ideasPayload?.emotion || "",
      visualMetaphor: el.analysisMetaphor.value.trim()
    };
  }

  return {
    contentSummary: state.ideasPayload?.contentSummary || "",
    coreMessage: el.analysisCore.value.trim() || state.ideasPayload?.coreMessage || "",
    learningGoal: state.ideasPayload?.learningGoal || "",
    emotion: el.analysisEmotion.value.trim() || state.ideasPayload?.emotion || "",
    visualMetaphor: el.analysisMetaphor.value.trim() || state.ideasPayload?.visualMetaphor || ""
  };
}

function isThumbnailMode() {
  return state.type === "chapter" || state.type === "lesson";
}

function currentType() {
  return state.config.assetTypes[state.type];
}

function normalizedNumber() {
  return (el.number.value || "1").replace(/\D/g, "").padStart(2, "0").slice(-2);
}

function resetIdeas(options = {}) {
  state.ideasPayload = null;
  state.selectedIdea = "";
  state.selectedIndex = -1;
  state.componentCount = 1;
  state.componentCountRecommendation = 1;
  el.generateBtn.disabled = true;
  el.newIdeasBtn.disabled = true;
  el.coreMessage.textContent = "";
  if (!options.keepAnalysis) {
    el.analysis.hidden = true;
    el.analysisCore.value = "";
    el.analysisEmotion.value = "";
    el.analysisMetaphor.value = "";
  }
  el.componentPicker.hidden = true;
  el.componentRecommendation.textContent = "1 Grafik";
  el.componentOptions.forEach((button) => button.classList.remove("selected"));
  el.ideas.className = "ideas empty";
  el.ideas.innerHTML = isThumbnailMode()
    ? "<p>Titel eingeben; die App leitet Inhalt und Bildideen daraus ab.</p>"
    : "<p>Nach dem Sprechertext erscheinen hier genau drei reduzierte Ideen.</p>";
}

function renderLessonIcons() {
  const icons = state.config.lessonIcons || [];
  el.lessonIconGrid.innerHTML = icons.map((icon) => `
    <button class="lesson-icon-button" type="button" data-icon="${icon.id}">
      <span class="lesson-icon-art">${lessonIconSvg(icon.id)}</span>
      <strong>${escapeHtml(icon.label)}</strong>
    </button>
  `).join("");

  el.lessonIconGrid.querySelectorAll(".lesson-icon-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.lessonIcon = button.dataset.icon;
      renderLessonIconSelection();
      updateModeUi();
    });
  });
  renderLessonIconSelection();
}

function renderLessonIconSelection() {
  el.lessonIconGrid.querySelectorAll(".lesson-icon-button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.icon === state.lessonIcon);
  });
}

function lessonIconSvg(id) {
  const stroke = "currentColor";
  const red = "#F44336";
  const common = `fill="none" stroke="${stroke}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"`;
  const redCommon = `fill="none" stroke="${red}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"`;
  const icons = {
    video: `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="39" ${common}/><path d="M52 43l29 17-29 17z" fill="${red}" stroke="${stroke}" stroke-width="6" stroke-linejoin="round"/></svg>`,
    pdf: `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M25 14h61l23 23v69a9 9 0 0 1-9 9H34a9 9 0 0 1-9-9z" ${common}/><path d="M86 14v26h23" ${common}/><path d="M44 55h45M44 72h45M44 89h45" ${common}/><path d="M91 21l12 12" ${redCommon}/></svg>`,
    text: `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M30 31h60v20M60 31v58M47 89h26M32 31v18M88 31v18" ${common}/></svg>`,
    exam: `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="39" ${common}/><path d="M49 48c2-9 11-14 20-10 8 4 10 14 2 20-7 5-11 8-11 16" ${redCommon}/><circle cx="60" cy="86" r="3" fill="${red}"/></svg>`,
    certificate: `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M60 14l9 8 13-2 6 12 12 5 1 13 9 10-9 10-1 13-12 5-6 12-13-2-9 8-9-8-13 2-6-12-12-5-1-13-9-10 9-10 1-13 12-5 6-12 13 2z" ${common}/><circle cx="60" cy="60" r="22" ${redCommon}/><path d="M40 91l-14 25 22-9 12 13M80 91l14 25-22-9-12 13" ${common}/></svg>`,
    iframe: `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M46 32L24 60l22 28M74 32l22 28-22 28" ${common}/><path d="M65 25L55 95" ${redCommon}/></svg>`,
    task: `<svg viewBox="0 0 120 120" aria-hidden="true"><rect x="24" y="28" width="72" height="74" rx="11" ${common}/><rect x="44" y="14" width="32" height="22" rx="8" ${common}/><path d="M45 66l12 12 28-34" ${redCommon}/></svg>`
  };
  return icons[id] || icons.video;
}

function setStatus(message) {
  el.status.textContent = message || "";
}

async function api(url, options = {}) {
  const apiUrl = url;
  const response = await fetch(apiUrl, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Fehler beim Laden.");
  return data;
}

function normalizePath(value) {
  const path = String(value || "/");
  if (path !== "/" && path.endsWith("/")) return path.slice(0, -1);
  return path || "/";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
