const state = {
  config: null,
  type: "presentation",
  ideasPayload: null,
  selectedIdea: "",
  selectedIndex: -1,
  componentCount: 1,
  componentCountRecommendation: 1
};

const el = {
  formPanel: document.querySelector("#formPanel"),
  mainInputLabel: document.querySelector("#mainInputLabel"),
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
  bindEvents();
  updateUi();
  await loadGallery();
}

function configureAppContext() {
  const paths = state.config.paths || {};
  document.body.dataset.app = "presentations";
  document.querySelector("#appTitle").textContent = "Präsentationsfolien";
  document.querySelector("#appKicker").textContent = "Skillmasters Foliengrafiken";
  const portalLink = document.querySelector("#portalLink");
  portalLink.href = String(paths.portal || "").startsWith("/__") ? "/" : paths.portal || "/";
  portalLink.hidden = false;
}

function bindEvents() {
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

function updateUi() {
  document.querySelector(".mode-group").hidden = true;
  el.formPanel.classList.add("presentation-mode");
  el.formPanel.classList.remove("lesson-mode", "thumbnail-mode");
  el.previewNumber.hidden = true;
  el.previewLessonIcon.hidden = true;
  el.previewDivider.hidden = true;
  el.previewLessonIcon.innerHTML = "";
  el.mainInputLabel.textContent = "Sprechertext";
  el.scriptText.rows = 9;
  el.scriptText.placeholder = "Sprechertext hier einfuegen...";
  el.ideasBtn.textContent = "Analyse & 3 Bildideen erstellen";
  resetIdeas();
}

async function createIdeas() {
  setStatus("Kernaussage, Emotion und Metapher werden verdichtet...");
  try {
    resetIdeas({ keepAnalysis: true });
    const data = await api("api/ideas", {
      method: "POST",
      body: JSON.stringify(formPayload())
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
  el.coreMessage.textContent = "";
  el.analysis.hidden = false;
  el.analysisCoreLabel.textContent = "Kernaussage";
  el.analysisEmotionLabel.textContent = "Emotion";
  el.analysisCore.readOnly = true;
  el.analysisEmotion.readOnly = true;
  el.analysisMetaphor.readOnly = true;
  el.analysisCore.value = data.coreMessage || "Keine Kernaussage erhalten.";
  el.analysisEmotion.value = data.emotion || "Keine Emotion erhalten.";
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
  if (!state.selectedIdea) {
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
    const data = await api("api/generate", {
      method: "POST",
      body: JSON.stringify({
        ...formPayload(),
        ...analysisPayload(),
        componentCount: state.componentCount,
        componentCountRecommendation: state.componentCountRecommendation,
        selectedIdea: state.selectedIdea,
        count: 1
      })
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
  const items = await api("api/gallery?app=presentations");
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
        <strong>${escapeHtml(item.typeLabel)}</strong>
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
  el.latestPreviewCaption.textContent = `Letztes Bild: ${item.typeLabel}`;
}

function formPayload() {
  return {
    type: "presentation",
    text: el.scriptText.value.trim()
  };
}

function analysisPayload() {
  return {
    contentSummary: state.ideasPayload?.contentSummary || "",
    coreMessage: el.analysisCore.value.trim() || state.ideasPayload?.coreMessage || "",
    learningGoal: state.ideasPayload?.learningGoal || "",
    emotion: el.analysisEmotion.value.trim() || state.ideasPayload?.emotion || "",
    visualMetaphor: el.analysisMetaphor.value.trim() || state.ideasPayload?.visualMetaphor || ""
  };
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
  el.ideas.innerHTML = "<p>Nach dem Sprechertext erscheinen hier genau drei reduzierte Ideen.</p>";
}

function setStatus(message) {
  el.status.textContent = message || "";
}

async function api(url, options = {}) {
  const response = await fetch(url, {
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
