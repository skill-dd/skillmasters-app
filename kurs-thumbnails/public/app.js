const state = {
  config: null,
  type: "course",
  lessonIcon: "video",
  ideasPayload: null,
  selectedIdea: "",
  selectedIndex: -1
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
  const paths = state.config.paths || {};
  document.body.dataset.app = "thumbnails";
  document.querySelector("#appTitle").textContent = "Kurs-Thumbnails";
  document.querySelector("#appKicker").textContent = "Skillmasters Kursgrafiken";
  const portalLink = document.querySelector("#portalLink");
  portalLink.href = String(paths.portal || "").startsWith("/__") ? "/" : paths.portal || "/";
  portalLink.hidden = false;
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
}

function updateModeUi() {
  const type = currentType();
  el.modeButtons.forEach((button) => {
    button.classList.toggle("selected", button.dataset.type === state.type);
  });
  el.formPanel.classList.toggle("lesson-mode", state.type === "lesson");
  el.formPanel.classList.add("thumbnail-mode");
  el.numberSection.hidden = !type.needsNumber;
  el.numberWrap.hidden = !type.needsNumber;
  el.contextWrap.hidden = false;
  el.lessonIconSection.hidden = !type.needsLessonIcon;
  el.previewNumber.hidden = !type.needsNumber;
  el.previewLessonIcon.hidden = !type.needsLessonIcon;
  el.previewDivider.hidden = !(type.needsNumber || type.needsLessonIcon);
  el.previewNumber.textContent = normalizedNumber();
  el.previewLessonIcon.innerHTML = type.needsLessonIcon ? lessonIconSvg(state.lessonIcon) : "";
  el.mainInputLabel.textContent = titleFieldLabel();
  el.scriptText.rows = 1;
  el.scriptText.placeholder = titleFieldPlaceholder();
  el.ideasBtn.textContent = "Inhalt & 3 Bildideen erstellen";
  resetIdeas();
}

function titleFieldLabel() {
  return {
    course: "Name des Kurses",
    chapter: "Name des Kapitels",
    lesson: "Name der Lektion"
  }[state.type];
}

function titleFieldPlaceholder() {
  return {
    course: "z. B. Grundlagen der Arbeitssicherheit",
    chapter: "z. B. Abrechnung & Kostenerstattung",
    lesson: "z. B. Von der Erstberatung zum Projektstart"
  }[state.type];
}

async function createIdeas() {
  setStatus("Titel wird in Inhalt, Lernziel und Bildideen uebersetzt...");
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
  el.coreMessage.textContent = data.coreMessage || "";
  el.analysis.hidden = true;
  el.analysisCore.value = data.contentSummary || data.coreMessage || "";
  el.analysisEmotion.value = data.learningGoal || "";
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
      el.generateBtn.disabled = false;
    });
  });
}

async function generateImage() {
  setStatus("Bild wird erzeugt und gespeichert...");
  el.generateBtn.disabled = true;
  try {
    const payload = {
      ...formPayload(),
      ...analysisPayload(),
      componentCount: 1,
      componentCountRecommendation: 1,
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
  const items = await api("api/gallery?app=thumbnails");
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
  return {
    type: state.type,
    number: normalizedNumber(),
    lessonIcon: state.lessonIcon,
    title: el.scriptText.value.trim(),
    context: el.contextInput.value.trim(),
    ...analysisPayload()
  };
}

function analysisPayload() {
  return {
    contentSummary: state.ideasPayload?.contentSummary || el.analysisCore.value.trim(),
    coreMessage: state.ideasPayload?.coreMessage || state.ideasPayload?.contentSummary || el.analysisCore.value.trim(),
    learningGoal: state.ideasPayload?.learningGoal || el.analysisEmotion.value.trim(),
    emotion: state.ideasPayload?.emotion || "",
    visualMetaphor: state.ideasPayload?.visualMetaphor || el.analysisMetaphor.value.trim()
  };
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
  el.generateBtn.disabled = true;
  el.newIdeasBtn.disabled = true;
  el.coreMessage.textContent = "";
  if (!options.keepAnalysis) {
    el.analysis.hidden = true;
    el.analysisCore.value = "";
    el.analysisEmotion.value = "";
    el.analysisMetaphor.value = "";
  }
  el.ideas.className = "ideas empty";
  el.ideas.innerHTML = "<p>Titel eingeben; die App leitet Inhalt und Bildideen daraus ab.</p>";
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
