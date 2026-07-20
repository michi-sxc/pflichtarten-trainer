const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const elements = {
  setup: $("#setup-view"), quiz: $("#quiz-view"), results: $("#results-view"),
  browse: $("#browse-view"), statsView: $("#stats-view"),
  setupForm: $("#setup-form"), choiceAnswer: $("#choice-answer"), inputAnswer: $("#input-answer"),
  inputSubmit: $("#input-answer button[type='submit']"),
  germanInput: $("#german-input"), latinInput: $("#latin-input"), feedback: $("#feedback"),
  feedbackLabel: $("#feedback-label"), answerGerman: $("#answer-german"), answerLatin: $("#answer-latin"),
  hintButton: $("#hint-button"), hintText: $("#hint-text"), revealButton: $("#reveal-button"),
  previousButton: $("#previous-button"), nextButton: $("#next-button"), newImage: $("#new-image"), expandImage: $("#expand-image"), image: $("#species-image"),
  imageLoader: $("#image-loader"), imageError: $("#image-error"), imageCredit: $("#image-credit"),
  sourceLink: $("#source-link"), questionKicker: $("#question-kicker"), questionTitle: $("#question-title"), progressText: $("#progress-text"),
  progressBar: $("#progress-bar"), scoreText: $("#score-text"), mastered: $("#mastered-count"),
  due: $("#due-count"), speciesCount: $("#species-count"), mistakesStart: $("#mistakes-start"),
  questionCount: $("#question-count"),
  resultPercent: $("#result-percent"), resultDetail: $("#result-detail"), resultMessage: $("#result-message"),
  resultTime: $("#result-time"), resultsTitle: $("#results-title"), resultsKicker: $("#results-kicker"),
  resultQuestions: $("#result-questions"), resultCoverage: $("#result-coverage"), resultRepeats: $("#result-repeats"),
  mistakeReview: $("#mistake-review"), mistakeList: $("#mistake-list"), repeatMistakes: $("#repeat-mistakes"),
  learningNote: $("#learning-note"), featureText: $("#feature-text"), focusText: $("#focus-text"),
  featuresTitle: $("#features-title"), comparisonBlock: $("#comparison-block"), comparisonList: $("#comparison-list"),
  taxonomyFilter: $("#taxonomy-filter"), taxonomyToggle: $("#taxonomy-toggle"),
  taxonomySections: $("#taxonomy-sections"), taxonomySummary: $("#taxonomy-summary"),
  plantTaxonomy: $("#plant-taxonomy"), animalTaxonomy: $("#animal-taxonomy"),
  plantTaxonomyList: $("#plant-taxonomy-list"), animalTaxonomyList: $("#animal-taxonomy-list"),
  markedOnly: $("#marked-only"), markedFilterCount: $("#marked-filter-count"), startButton: $("#start-button"),
  markCurrent: $("#mark-current"), noteToggle: $("#note-toggle"), noteEditor: $("#note-editor"), speciesNote: $("#species-note"),
  levelFilter: $("#level-filter"), inputFieldsLabel: $("#input-fields-label"), inputFields: $("#input-fields"),
  sessionTimer: $("#session-timer"), quizStreak: $("#quiz-streak"),
  streakDisplay: $("#streak-display"), streakCount: $("#streak-count"),
  homeButton: $("#home-button"), browseButton: $("#browse-button"), statsButton: $("#stats-button"),
  browseBack: $("#browse-back"), browseSearch: $("#browse-search"), browseGrid: $("#browse-grid"), browseMore: $("#browse-more"),
  statsBack: $("#stats-back"), statTotal: $("#stat-total"), statMastered: $("#stat-mastered"),
  statDue: $("#stat-due"), statAccuracy: $("#stat-accuracy"), statStreak: $("#stat-streak"),
  weakestList: $("#weakest-list"), statsTbody: $("#stats-tbody"),
  exportButton: $("#export-button"), importButton: $("#import-button"), importFile: $("#import-file"),
  themeToggle: $("#theme-toggle"), imageViewer: $("#image-viewer"), imageViewerClose: $("#image-viewer-close"),
  imageViewerImage: $("#image-viewer-image"), imageViewerLoader: $("#image-viewer-loader"),
  imageViewerCredit: $("#image-viewer-credit"), imageViewerSource: $("#image-viewer-source")
};

const STORAGE_KEY = "pflichtarten-trainer-v1";
const TAXON_CACHE_KEY = "pflichtarten-taxa-v1";
const STREAK_KEY = "pflichtarten-streak-v1";
const THEME_KEY = "pflichtarten-theme";
const TAXON_CACHE_MAX = 500;
let installPrompt;
let noteSaveTimer;
let sessionStart = 0;
let sessionTimerId = null;
let apiLastCall = 0;
let apiGate = Promise.resolve();
let viewerToken = 0;
const taxonRequests = new Map();
const API_MIN_GAP = 350; // ms between iNaturalist API calls
const state = {
  stats: loadStats(), queue: [], index: 0, score: 0, mode: "choice", scope: "all",
  smart: true, answered: false, hintUsed: false, roundMistakes: [], imageToken: 0,
  recentImages: new Map(), responses: [], options: [], photos: [], taxa: loadTaxa(), prefetches: new Map(), roundToken: 0,
  selectedTaxa: new Set(Object.values(TAXON_FILTERS).flat().map(taxon => taxon.key)),
  inputFields: "both", streak: loadStreak(), correctStreak: 0,
  endless: false, endlessSource: [], endlessDeck: [], endlessCycleSeen: new Set(), endlessRepeatStreak: 0,
  sessionCoverage: new Set(), sessionPoolSize: 0
};

function loadStats() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveStats() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.stats)); }
  catch { /* private mode can block storage, quiz still works */ }
}

function loadStreak() {
  try { return JSON.parse(localStorage.getItem(STREAK_KEY)) || { count: 0, lastDate: "" }; }
  catch { return { count: 0, lastDate: "" }; }
}

function saveStreak() {
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(state.streak)); }
  catch { /* optional */ }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function updateStreak() {
  const today = todayStr();
  if (state.streak.lastDate === today) return;
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  state.streak.count = state.streak.lastDate === yesterday ? state.streak.count + 1 : 1;
  state.streak.lastDate = today;
  saveStreak();
}

function loadTaxa() {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(TAXON_CACHE_KEY)) || {})); }
  catch { return new Map(); }
}

function saveTaxa() {
  try {
    // evict oldest entries if cache too large
    if (state.taxa.size > TAXON_CACHE_MAX) {
      const excess = state.taxa.size - TAXON_CACHE_MAX;
      for (const key of [...state.taxa.keys()].slice(0, excess)) state.taxa.delete(key);
    }
    const compact = Object.fromEntries([...state.taxa].map(([id, taxon]) => [id, {
      id: taxon.id,
      default_photo: taxon.default_photo && {
        url: taxon.default_photo.url,
        medium_url: taxon.default_photo.medium_url,
        attribution: taxon.default_photo.attribution
      }
    }]));
    localStorage.setItem(TAXON_CACHE_KEY, JSON.stringify(compact));
  } catch { /* cache is optional */ }
}

function getStat(species) {
  return state.stats[species.id] || { seen: 0, correct: 0, wrong: 0, level: 0, mistake: false, marked: false, note: "" };
}

function updateHeader() {
  const values = SPECIES.map(getStat);
  elements.mastered.textContent = values.filter(item => item.level >= 3).length;
  const due = SPECIES.filter(item => getStat(item).mistake).length;
  elements.due.textContent = due;
  elements.mistakesStart.hidden = due === 0;
  elements.mistakesStart.textContent = `${due} Fehler wiederholen`;
  if (state.streak.count > 0 && elements.streakDisplay) {
    elements.streakDisplay.hidden = false;
    elements.streakCount.textContent = state.streak.count;
  }
  updateAvailableCount();
}

function currentScope() {
  return new FormData(elements.setupForm).get("scope") || "all";
}

function levelFilterFn(item) {
  const level = elements.levelFilter?.value || "all";
  if (level === "all") return true;
  const stat = getStat(item);
  if (level === "new") return stat.seen === 0;
  if (level === "unsure") return stat.seen > 0 && stat.level <= 2;
  if (level === "secure") return stat.level >= 3;
  return true;
}

function scopedSpecies(scope = currentScope(), markedOnly = elements.markedOnly.checked) {
  const inScope = item => scope === "all" ||
    (scope === "taxon" ? item.kind === "taxon" : item.group === scope && item.kind === "species");
  return SPECIES.filter(item => inScope(item) &&
    (item.kind === "taxon" || state.selectedTaxa.has(TAXONOMY_BY_ID[item.id]?.key)) &&
    (!markedOnly || getStat(item).marked) && levelFilterFn(item));
}

function renderTaxonomyFilters() {
  for (const group of ["plant", "animal"]) {
    const list = elements[`${group}TaxonomyList`];
    list.replaceChildren(...TAXON_FILTERS[group].map(taxon => {
      const label = document.createElement("label");
      const inputId = `taxonomy-${taxon.key}`;
      label.className = "taxonomy-option";
      label.htmlFor = inputId;
      label.innerHTML = `<input id="${inputId}" type="checkbox" value="${taxon.key}" checked><span><strong>${escapeHtml(taxon.german)}</strong><em>${escapeHtml(taxon.latin)}</em></span>`;
      label.querySelector("input").addEventListener("change", event => {
        if (event.target.checked) state.selectedTaxa.add(taxon.key);
        else state.selectedTaxa.delete(taxon.key);
        updateAvailableCount();
      });
      return label;
    }));
  }
}

function toggleTaxonomyFilter() {
  const expanded = elements.taxonomyToggle.getAttribute("aria-expanded") !== "true";
  elements.taxonomyToggle.setAttribute("aria-expanded", String(expanded));
  elements.taxonomyToggle.querySelector(".taxonomy-symbol").textContent = expanded ? "−" : "+";
  elements.taxonomySections.hidden = !expanded;
}

function setTaxonomyGroup(group, selected) {
  for (const taxon of TAXON_FILTERS[group]) {
    if (selected) state.selectedTaxa.add(taxon.key);
    else state.selectedTaxa.delete(taxon.key);
  }
  elements[`${group}TaxonomyList`].querySelectorAll("input").forEach(input => { input.checked = selected; });
  updateAvailableCount();
}

function updateTaxonomyFilter(scope) {
  elements.taxonomyFilter.dataset.scope = scope;
  elements.taxonomyFilter.hidden = scope === "taxon";
  elements.plantTaxonomy.hidden = scope === "animal";
  elements.animalTaxonomy.hidden = scope === "plant";
  if (scope === "taxon") return;
  const visible = scope === "all" ? [...TAXON_FILTERS.plant, ...TAXON_FILTERS.animal] : TAXON_FILTERS[scope];
  const selected = visible.filter(taxon => state.selectedTaxa.has(taxon.key)).length;
  elements.taxonomySummary.textContent = selected === visible.length ? "Alle ausgewählt" : `${selected} von ${visible.length}`;
}

function updateAvailableCount() {
  const scope = currentScope();
  const available = scopedSpecies(scope, false);
  const markedCount = available.filter(item => getStat(item).marked).length;
  const selected = elements.markedOnly.checked ? available.filter(item => getStat(item).marked) : available;
  const count = selected.length;
  const due = selected.filter(item => getStat(item).mistake).length;
  const labels = { all: "Arten und Tiergruppen", plant: "Pflanzenarten", animal: "Tierarten", taxon: "Tiergruppen" };
  updateTaxonomyFilter(scope);
  elements.markedFilterCount.textContent = `${markedCount} markiert`;
  elements.speciesCount.textContent = count ? `${count} ${labels[scope]} in dieser Auswahl` :
    (elements.markedOnly.checked ? "Keine markierten Einträge in dieser Auswahl" : "Mindestens eine Gruppe auswählen");
  elements.startButton.disabled = count === 0;
  elements.startButton.textContent = elements.questionCount.value === "endless" ? "Endloslauf starten" : "Quiz starten";
  elements.mistakesStart.hidden = due === 0;
  elements.mistakesStart.textContent = `${due} Fehler wiederholen`;
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function weightedSample(items, count) {
  const pool = [...items];
  const picked = [];
  while (picked.length < count && pool.length) {
    const weights = pool.map(item => {
      const stat = getStat(item);
      return 1 + stat.wrong * 1.5 + (stat.mistake ? 6 : 0) + Math.max(0, 3 - stat.level) * 1.5;
    });
    let roll = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
    let index = 0;
    while (index < weights.length - 1 && (roll -= weights[index]) > 0) index++;
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

function orderPool(pool) {
  return state.smart ? weightedSample(pool, pool.length) : shuffle(pool);
}

function startEndlessCycle() {
  state.endlessDeck = orderPool(state.endlessSource);
  state.endlessCycleSeen.clear();
  state.endlessRepeatStreak = 0;
  const previousId = state.queue[state.queue.length - 1]?.id;
  if (state.endlessDeck.length > 1 && state.endlessDeck[0].id === previousId) {
    const swapIndex = state.endlessDeck.findIndex(item => item.id !== previousId);
    [state.endlessDeck[0], state.endlessDeck[swapIndex]] = [state.endlessDeck[swapIndex], state.endlessDeck[0]];
  }
}

function drawEndlessSpecies() {
  if (!state.endlessDeck.length) startEndlessCycle();
  const repeatPool = state.endlessSource.filter(item => state.endlessCycleSeen.has(item.id));
  // max one inserted repeat, so every second question still advances coverage
  if (repeatPool.length && state.endlessRepeatStreak === 0 && Math.random() < .25) {
    state.endlessRepeatStreak = 1;
    return state.smart ? weightedSample(repeatPool, 1)[0] : repeatPool[Math.floor(Math.random() * repeatPool.length)];
  }
  state.endlessRepeatStreak = 0;
  const species = state.endlessDeck.shift();
  state.endlessCycleSeen.add(species.id);
  return species;
}

function appendEndlessQuestion() {
  if (state.endless) state.queue.push(drawEndlessSpecies());
}

function startQuiz({ mistakesOnly = false, species = null } = {}) {
  const form = new FormData(elements.setupForm);
  state.scope = form.get("scope") || "all";
  state.mode = form.get("mode") || "choice";
  state.smart = form.get("smart") === "on";
  state.inputFields = form.get("inputFields") || "both";
  const pool = species || scopedSpecies(state.scope).filter(item => !mistakesOnly || getStat(item).mistake);
  if (!pool.length) return;
  const countValue = form.get("count") || "20";
  state.endless = !mistakesOnly && !species && countValue === "endless";
  state.queue = [];
  state.endlessSource = state.endless ? [...pool] : [];
  state.endlessDeck = [];
  state.endlessCycleSeen = new Set();
  state.endlessRepeatStreak = 0;
  state.sessionCoverage = new Set();
  state.sessionPoolSize = pool.length;
  if (state.endless) appendEndlessQuestion();
  else {
    const count = mistakesOnly || countValue === "all" ? pool.length : Math.min(Number(countValue), pool.length);
    state.queue = state.smart ? weightedSample(pool, count) : shuffle(pool).slice(0, count);
  }
  state.index = 0;
  state.score = 0;
  state.correctStreak = 0;
  updateQuizStreak();
  state.roundMistakes = [];
  state.responses = [];
  state.options = [];
  state.photos = [];
  state.prefetches.clear();
  state.roundToken++;
  startSessionTimer();
  showView("quiz");
  renderQuestion();
}

function showView(name) {
  for (const view of [elements.setup, elements.quiz, elements.results, elements.browse, elements.statsView]) {
    view.hidden = true;
  }
  const target = name === "quiz" ? elements.quiz : name === "results" ? elements.results :
    name === "browse" ? elements.browse : name === "stats" ? elements.statsView : elements.setup;
  target.hidden = false;
  const activeMenu = name === "browse" ? elements.browseButton : name === "stats" ? elements.statsButton : elements.homeButton;
  for (const button of [elements.homeButton, elements.browseButton, elements.statsButton]) {
    if (button === activeMenu) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
}

function renderQuestion() {
  if (state.index >= state.queue.length) {
    if (state.endless) appendEndlessQuestion();
    else return showResults();
  }
  const species = state.queue[state.index];
  const response = state.responses[state.index];
  state.answered = Boolean(response);
  state.hintUsed = response?.hintUsed || false;
  state.correctStreak = response?.streak ?? state.responses[state.index - 1]?.streak ?? 0;
  elements.feedback.hidden = true;
  elements.learningNote.hidden = true;
  elements.hintText.hidden = true;
  elements.hintButton.hidden = state.answered;
  elements.revealButton.hidden = state.answered;
  elements.previousButton.disabled = state.index === 0;
  elements.questionKicker.textContent = species.group === "plant" ? "Pflanze bestimmen" : "Tier bestimmen";
  elements.progressText.textContent = state.endless ? `${state.index + 1} · Endlos` : `${state.index + 1} / ${state.queue.length}`;
  elements.scoreText.textContent = `${state.score} richtig`;
  updateQuizStreak();
  elements.progressBar.parentElement.hidden = state.endless;
  if (!state.endless) elements.progressBar.style.width = `${(state.index / state.queue.length) * 100}%`;
  elements.choiceAnswer.hidden = state.mode !== "choice";
  elements.inputAnswer.hidden = state.mode !== "input";
  if (state.mode === "input") {
    const showGerman = state.inputFields !== "latin";
    const showLatin = state.inputFields !== "german";
    elements.germanInput.parentElement.hidden = !showGerman;
    elements.latinInput.parentElement.hidden = !showLatin;
    if (!showGerman && !state.answered) requestAnimationFrame(() => elements.latinInput.focus());
  }
  elements.germanInput.value = response?.german || "";
  elements.latinInput.value = response?.latin || "";
  elements.germanInput.disabled = state.answered;
  elements.latinInput.disabled = state.answered;
  elements.inputSubmit.disabled = state.answered;
  elements.germanInput.removeAttribute("aria-invalid");
  elements.latinInput.removeAttribute("aria-invalid");
  if (species.kind === "taxon") {
    elements.questionKicker.textContent = `Tiergruppe · ${species.rank}`;
    elements.questionTitle.textContent = rankQuestion(species.rank);
  } else {
    elements.questionKicker.textContent = species.group === "plant" ? "Pflanze bestimmen" : "Tier bestimmen";
    elements.questionTitle.textContent = "Welche Art ist das?";
  }
  if (state.mode === "choice") renderChoices(species, response);
  else if (!state.answered) requestAnimationFrame(() => elements.germanInput.focus());
  else showInputValidity(response);
  loadImage(species);
  if (response) showFeedback(response.correct, species, false);
}

function rankQuestion(rank) {
  const masculine = new Set(["Stamm", "Unterstamm"]);
  return `${masculine.has(rank) ? "Welcher" : "Welche"} ${rank} ist das?`;
}

function renderChoices(correct, response) {
  let optionIds = state.options[state.index];
  if (!optionIds) {
    const distractors = shuffle(SPECIES.filter(item =>
      item.id !== correct.id &&
      item.kind === correct.kind &&
      item.cluster === correct.cluster &&
      (correct.kind !== "taxon" || item.rank === correct.rank)
    )).sort((a, b) => sameGenusScore(correct, b) - sameGenusScore(correct, a)).slice(0, 3);
    optionIds = shuffle([correct, ...distractors]).map(item => item.id);
    state.options[state.index] = optionIds;
  }
  const options = optionIds.map(id => SPECIES.find(item => item.id === id)).filter(Boolean);
  elements.choiceAnswer.replaceChildren(...options.map(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.dataset.id = option.id;
    button.innerHTML = `<strong>${escapeHtml(option.german)}</strong><em>${escapeHtml(option.latin)}</em>`;
    button.addEventListener("click", () => gradeChoice(option, button));
    return button;
  }));
  if (response) {
    $$(".choice").forEach(choice => {
      choice.disabled = true;
      if (choice.dataset.id === correct.id) choice.classList.add("correct");
      if (!response.correct && choice.dataset.id === response.selectedId) choice.classList.add("wrong");
    });
  }
}

function sameGenusScore(target, candidate) {
  if (target.kind !== "species") return 0;
  return target.latin.split(" ")[0] === candidate.latin.split(" ")[0] ? 1 : 0;
}

function gradeChoice(option, button) {
  if (state.answered) return;
  const species = state.queue[state.index];
  const correct = option.id === species.id;
  $$(".choice").forEach(choice => {
    choice.disabled = true;
    if (choice.dataset.id === species.id) choice.classList.add("correct");
  });
  if (!correct) button.classList.add("wrong");
  recordAnswer(correct, { selectedId: option.id });
}

function normalize(value) {
  return value.trim().toLocaleLowerCase("de-DE").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss").replace(/\bagg\.?\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function acceptedNames(primary, aliases) {
  return [primary, ...aliases].map(normalize);
}

function showInputValidity({ germanProvided, latinProvided, germanOk, latinOk }) {
  const neitherProvided = !germanProvided && !latinProvided;
  elements.germanInput.setAttribute("aria-invalid", String(neitherProvided || germanProvided && !germanOk));
  elements.latinInput.setAttribute("aria-invalid", String(neitherProvided || latinProvided && !latinOk));
}

function gradeInput(event) {
  event.preventDefault();
  if (state.answered) return;
  const species = state.queue[state.index];
  const germanValue = normalize(elements.germanInput.value);
  const latinValue = normalize(elements.latinInput.value);
  const germanProvided = state.inputFields !== "latin" && Boolean(germanValue);
  const latinProvided = state.inputFields !== "german" && Boolean(latinValue);
  const germanOk = germanProvided && acceptedNames(species.german, species.germanAliases).includes(germanValue);
  const latinOk = latinProvided && acceptedNames(species.latin, species.latinAliases).includes(latinValue);
  const detail = {
    german: elements.germanInput.value,
    latin: elements.latinInput.value,
    germanProvided,
    latinProvided,
    germanOk,
    latinOk
  };
  showInputValidity(detail);
  recordAnswer(germanOk || latinOk, detail);
}

function updateQuizStreak() {
  elements.quizStreak.textContent = `Serie ${state.correctStreak}`;
  elements.quizStreak.classList.toggle("active", state.correctStreak > 0);
}

function recordAnswer(correct, detail = {}) {
  if (state.responses[state.index]) return;
  state.answered = true;
  state.correctStreak = correct ? state.correctStreak + 1 : 0;
  updateQuizStreak();
  const species = state.queue[state.index];
  state.sessionCoverage.add(species.id);
  state.responses[state.index] = { correct, hintUsed: state.hintUsed, streak: state.correctStreak, ...detail };
  const stat = getStat(species);
  stat.seen++;
  if (correct) {
    state.score++;
    stat.correct++;
    stat.mistake = false;
    if (!state.hintUsed) stat.level = Math.min(5, stat.level + 1);
  } else {
    stat.wrong++;
    stat.mistake = true;
    stat.level = Math.max(0, stat.level - 1);
    state.roundMistakes.push(species);
  }
  state.stats[species.id] = stat;
  saveStats();
  updateStreak();
  updateHeader();
  if (state.endless && state.index === state.queue.length - 1) {
    appendEndlessQuestion();
    prefetchImage(state.index + 1);
  }
  showFeedback(correct, species, true);
}

function showFeedback(correct, species, focusNext = true) {
  elements.feedback.hidden = false;
  elements.germanInput.disabled = state.mode === "input";
  elements.latinInput.disabled = state.mode === "input";
  elements.inputSubmit.disabled = state.mode === "input";
  elements.feedbackLabel.textContent = correct ? (state.hintUsed ? "Richtig - mit Hinweis" : "Richtig") : "Noch nicht ganz";
  elements.feedbackLabel.className = `feedback-label ${correct ? "good" : "bad"}`;
  elements.answerGerman.textContent = [species.german, ...species.germanAliases].join(" / ");
  elements.answerLatin.textContent = [species.latin, ...species.latinAliases].join(" / ");
  elements.hintButton.hidden = true;
  elements.revealButton.hidden = true;
  showLearningNote(species);
  renderPersonalStudy(species);
  if (!state.endless) elements.progressBar.style.width = `${((state.index + 1) / state.queue.length) * 100}%`;
  elements.scoreText.textContent = `${state.score} richtig`;
  elements.nextButton.textContent = !state.endless && state.index + 1 === state.queue.length ? "Ergebnis ansehen" : "Nächste Frage";
  if (focusNext) elements.nextButton.focus();
}

function showLearningNote(species) {
  elements.learningNote.hidden = false;
  const focus = diagnosticFocus(species);
  elements.featuresTitle.textContent = focus ? "Merkmalsfokus" : "Erkennungsmerkmale";
  elements.focusText.textContent = focus;
  elements.focusText.hidden = !focus;
  elements.featureText.textContent = FEATURES[species.id] || "Keine Merkmale hinterlegt.";
  const alternatives = state.mode === "choice"
    ? (state.options[state.index] || []).map(id => SPECIES.find(item => item.id === id)).filter(item => item && item.id !== species.id)
    : [];
  elements.comparisonBlock.hidden = alternatives.length === 0;
  elements.comparisonList.replaceChildren(...alternatives.map(item => {
    const row = document.createElement("li");
    row.innerHTML = `<strong>${escapeHtml(item.german)}:</strong> ${escapeHtml(FEATURES[item.id])}`;
    return row;
  }));
}

function setNoteOpen(open) {
  elements.noteToggle.setAttribute("aria-expanded", String(open));
  elements.noteEditor.hidden = !open;
  elements.noteToggle.textContent = open ? "Notiz schließen" :
    (elements.speciesNote.value.trim() ? "Notiz ansehen" : "Notiz hinzufügen");
}

function renderPersonalStudy(species) {
  const stat = getStat(species);
  elements.markCurrent.checked = Boolean(stat.marked);
  elements.speciesNote.value = stat.note || "";
  setNoteOpen(Boolean(elements.speciesNote.value.trim()));
}

function updateCurrentStudy(patch, persist = true) {
  const species = state.queue[state.index];
  if (!species || !state.answered) return;
  const stat = getStat(species);
  Object.assign(stat, patch);
  state.stats[species.id] = stat;
  if (persist) saveStats();
}

function saveCurrentNote() {
  updateCurrentStudy({ note: elements.speciesNote.value }, false);
  window.clearTimeout(noteSaveTimer);
  noteSaveTimer = window.setTimeout(() => {
    noteSaveTimer = null;
    saveStats();
  }, 180);
}

function flushNoteSave() {
  if (!noteSaveTimer) return;
  window.clearTimeout(noteSaveTimer);
  noteSaveTimer = null;
  saveStats();
}

function makeHint(name) {
  return name.split(/([ -])/).map(part => /^[\p{L}]/u.test(part) ? `${part[0]}${"_".repeat(Math.max(1, part.length - 1))}` : part).join("");
}

function revealHint() {
  const species = state.queue[state.index];
  state.hintUsed = true;
  elements.hintText.textContent = `${makeHint(species.german)} · ${makeHint(species.latin)}`;
  elements.hintText.hidden = false;
  elements.hintButton.hidden = true;
}

function revealAnswer() {
  if (!state.answered) recordAnswer(false, { revealed: true });
}

function nextQuestion() {
  flushNoteSave();
  if (state.endless && state.index === state.queue.length - 1) appendEndlessQuestion();
  state.index++;
  renderQuestion();
}

function previousQuestion() {
  if (state.index === 0) return;
  flushNoteSave();
  state.index--;
  renderQuestion();
}

function imageQuery(species) {
  return (species.imageName || species.latin).replace(/\s+agg\.?$/i, "");
}

async function fetchWithTimeout(url, timeout = 6500) {
  const turn = apiGate.then(async () => {
    const wait = Math.max(0, apiLastCall + API_MIN_GAP - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    apiLastCall = Date.now();
  });
  apiGate = turn.catch(() => {});
  await turn;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { signal: controller.signal }); }
  finally { window.clearTimeout(timer); }
}

function largerPhoto(url) {
  const size = window.innerWidth <= 700 ? "medium" : "large";
  return url.replace(/\/(square|small|thumb|medium|large)\./, `/${size}.`);
}

function browsePhotoUrl(url) {
  return url.replace(/\/(square|small|thumb|medium|large)\./, "/medium.");
}

function fullPhotoUrl(url) {
  return url.replace(/\/(square|small|thumb|medium|large)\./, "/large.");
}

function rememberImage(species, url) {
  const recent = state.recentImages.get(species.id) || [];
  state.recentImages.set(species.id, [...recent.filter(item => item !== url), url].slice(-8));
}

function cleanTaxonName(value) {
  return value.replace(/\b(agg|kl|f)\.?\b/gi, " ").replace(/[^\p{L}-]+/gu, " ").trim().toLowerCase();
}

async function fetchResolvedTaxon(species) {
  if (state.taxa.has(species.id)) return state.taxa.get(species.id);
  const names = [...new Set([imageQuery(species), species.latin, ...species.latinAliases].map(name =>
    name.replace(/\b(agg|kl|f)\.?\b/gi, " ").replace(/\s+/g, " ").trim()))];
  for (const name of names) {
    const params = new URLSearchParams({ q: name, per_page: "10" });
    let response;
    try { response = await fetchWithTimeout(`https://api.inaturalist.org/v1/taxa?${params}`); }
    catch { continue; }
    if (!response.ok) continue;
    const data = await response.json();
    const exact = data.results.find(taxon => cleanTaxonName(taxon.name) === cleanTaxonName(name));
    if (exact) {
      state.taxa.set(species.id, exact);
      saveTaxa();
      return exact;
    }
  }
  throw new Error("No exact iNaturalist taxon");
}

function resolveTaxon(species) {
  if (state.taxa.has(species.id)) return Promise.resolve(state.taxa.get(species.id));
  if (taxonRequests.has(species.id)) return taxonRequests.get(species.id);
  const request = fetchResolvedTaxon(species).finally(() => taxonRequests.delete(species.id));
  taxonRequests.set(species.id, request);
  return request;
}

function taxonPhoto(taxon) {
  if (!taxon.default_photo?.url) return null;
  return {
    url: largerPhoto(taxon.default_photo.medium_url || taxon.default_photo.url),
    credit: taxon.default_photo.attribution || "iNaturalist-Mitwirkende",
    link: `https://www.inaturalist.org/taxa/${taxon.id}`
  };
}

function observationPhoto(observation, detailed) {
  const variants = observation.photos.slice(0, detailed ? 4 : 1).map(photo => ({
    url: largerPhoto(photo.url),
    credit: photo.attribution || "iNaturalist-Mitwirkende"
  }));
  return {
    ...variants[0],
    variants,
    variantIndex: 0,
    link: observation.uri || `https://www.inaturalist.org/observations/${observation.id}`
  };
}

async function fetchINaturalist(species) {
  const taxon = await resolveTaxon(species);
  const params = new URLSearchParams({
    taxon_id: String(taxon.id), photos: "true", quality_grade: "research", photo_license: "any",
    order_by: "random", per_page: "16"
  });
  let response;
  try { response = await fetchWithTimeout(`https://api.inaturalist.org/v1/observations?${params}`); }
  catch { /* default taxon photo below is the fast fallback */ }
  if (response?.ok) {
    const data = await response.json();
    const observations = shuffle(data.results.filter(item => item.photos?.length &&
      (item.taxon?.id === taxon.id || item.taxon?.ancestor_ids?.includes(taxon.id))));
    const recent = state.recentImages.get(species.id) || [];
    const detailed = Boolean(diagnosticFocus(species));
    // multi-photo records often include the close-up grasses and ferns need
    const candidates = detailed
      ? [...observations.filter(item => item.photos.length > 1), ...observations.filter(item => item.photos.length === 1)]
      : observations;
    const picked = candidates.find(item => !recent.includes(largerPhoto(item.photos[0].url))) || candidates[0];
    if (picked) {
      const photo = observationPhoto(picked, detailed);
      const fallbacks = candidates.filter(item => item !== picked).slice(0, 2).map(item => observationPhoto(item, false));
      const fallback = taxonPhoto(taxon);
      if (fallback) fallbacks.push(fallback);
      // dead CDN files happen, keep verified alternates from the same API response
      photo.fallbacks = [...new Map(fallbacks.filter(item => item.url !== photo.url).map(item => [item.url, item])).values()];
      return photo;
    }
  }
  const fallback = taxonPhoto(taxon);
  if (fallback) return fallback;
  throw new Error("No iNaturalist photo");
}

function stripHtml(value = "") {
  const node = document.createElement("div");
  node.innerHTML = value;
  return node.textContent.trim();
}

async function fetchCommons(species) {
  const params = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: `intitle:\"${imageQuery(species)}\" filetype:bitmap`,
    gsrnamespace: "6", gsrlimit: "12", prop: "imageinfo", iiprop: "url|extmetadata",
    iiurlwidth: window.innerWidth <= 700 ? "700" : "1200",
    format: "json", origin: "*"
  });
  const response = await fetchWithTimeout(`https://commons.wikimedia.org/w/api.php?${params}`);
  if (!response.ok) throw new Error("No Commons response");
  const data = await response.json();
  const expected = cleanTaxonName(imageQuery(species));
  const pages = shuffle(Object.values(data.query?.pages || {})).filter(page => {
    const title = cleanTaxonName(page.title?.replace(/^File:/i, "") || "");
    return page.imageinfo?.[0]?.thumburl && title.startsWith(expected);
  });
  const page = pages[0];
  if (!page) throw new Error("No Commons photo");
  const info = page.imageinfo[0];
  const metadata = info.extmetadata || {};
  const artist = stripHtml(metadata.Artist?.value) || "Wikimedia-Commons-Mitwirkende";
  const license = metadata.LicenseShortName?.value ? ` · ${metadata.LicenseShortName.value}` : "";
  return { url: info.thumburl, credit: `${artist}${license}`, link: info.descriptionurl };
}

function firstUsablePhoto(candidates, priority) {
  return new Promise((resolve, reject) => {
    let remaining = candidates.length;
    let lastError = new Error("No usable photo");
    if (!remaining) return reject(lastError);
    for (const candidate of candidates) {
      preload(candidate.url, priority, 7000).then(() => resolve(candidate)).catch(error => {
        lastError = error;
        if (--remaining === 0) reject(lastError);
      });
    }
  });
}

async function verifyPhoto(photo, priority) {
  try {
    await preload(photo.url, priority, 7000);
    return photo;
  } catch (error) {
    if (!photo.fallbacks?.length) throw error;
    return firstUsablePhoto(photo.fallbacks, priority);
  }
}

async function fetchPhoto(species, priority = "auto") {
  try { return await verifyPhoto(await fetchINaturalist(species), priority); }
  catch { return verifyPhoto(await fetchCommons(species), priority); }
}

function prefetchImage(index) {
  if (index >= state.queue.length || state.photos[index] || state.prefetches.has(index)) return;
  const species = state.queue[index];
  const roundToken = state.roundToken;
  const task = fetchPhoto(species, "low").then(photo => {
    if (roundToken === state.roundToken && state.queue[index]?.id === species.id) state.photos[index] = photo;
    return photo;
  }).catch(() => null);
  state.prefetches.set(index, task);
  task.finally(() => {
    if (state.prefetches.get(index) === task) state.prefetches.delete(index);
  });
}

function warmImages(index, photo) {
  prefetchImage(index + 1);
  const warmVariants = () => photo.variants?.slice(1).forEach(item => preload(item.url, "low").catch(() => {}));
  if ("requestIdleCallback" in window) window.requestIdleCallback(warmVariants, { timeout: 1200 });
  else window.setTimeout(warmVariants, 250);
}

function displayPhoto(photo) {
  const current = photo.variants?.[photo.variantIndex] || photo;
  elements.image.src = current.url;
  elements.image.alt = "Fundfoto der zu bestimmenden Art";
  elements.image.hidden = false;
  elements.imageLoader.hidden = true;
  elements.imageCredit.textContent = current.credit;
  elements.sourceLink.href = photo.link;
  const action = photo.variantIndex < (photo.variants?.length || 1) - 1 ? "Nächste Ansicht" : "Anderes Foto";
  elements.newImage.setAttribute("aria-label", action);
  elements.newImage.title = action;
  elements.expandImage.disabled = false;
}

function openImageViewer({ url, alt, credit = "", link = "https://www.inaturalist.org" }) {
  if (!url) return;
  const token = ++viewerToken;
  elements.imageViewerImage.src = url;
  elements.imageViewerImage.alt = alt;
  elements.imageViewerCredit.textContent = credit;
  elements.imageViewerSource.href = link;
  elements.imageViewerLoader.hidden = true;
  if (typeof elements.imageViewer.showModal === "function") elements.imageViewer.showModal();
  else elements.imageViewer.setAttribute("open", "");

  const fullUrl = fullPhotoUrl(url);
  if (fullUrl === url) return;
  const full = new Image();
  elements.imageViewerLoader.hidden = false;
  full.onload = () => {
    if (token !== viewerToken || !elements.imageViewer.open) return;
    elements.imageViewerImage.src = fullUrl;
    elements.imageViewerLoader.hidden = true;
  };
  full.onerror = () => { if (token === viewerToken) elements.imageViewerLoader.hidden = true; };
  full.src = fullUrl;
}

function closeImageViewer() {
  viewerToken++;
  if (typeof elements.imageViewer.close === "function") elements.imageViewer.close();
  else elements.imageViewer.removeAttribute("open");
  elements.imageViewerImage.removeAttribute("src");
}

function openQuizImage() {
  const photo = state.photos[state.index];
  const current = photo?.variants?.[photo.variantIndex] || photo;
  if (!current) return;
  const species = state.queue[state.index];
  openImageViewer({ url: current.url, alt: species.german, credit: current.credit, link: photo.link });
}

async function nextImage() {
  const species = state.queue[state.index];
  const photo = state.photos[state.index];
  if (!photo?.variants || photo.variantIndex >= photo.variants.length - 1) return loadImage(species, true);
  const next = photo.variants[++photo.variantIndex];
  elements.newImage.disabled = true;
  try {
    await preload(next.url);
    rememberImage(species, next.url);
    displayPhoto(photo);
  } finally {
    elements.newImage.disabled = false;
  }
}

async function loadImage(species = state.queue[state.index], force = false) {
  const token = ++state.imageToken;
  const questionIndex = state.index;
  elements.image.hidden = true;
  elements.imageError.hidden = true;
  elements.imageLoader.hidden = false;
  elements.imageCredit.textContent = "Fotoquelle wird geladen ...";
  elements.sourceLink.href = "https://www.inaturalist.org";
  elements.newImage.disabled = true;
  elements.expandImage.disabled = true;
  const cached = state.photos[questionIndex];
  if (cached && !force) {
    displayPhoto(cached);
    warmImages(questionIndex, cached);
    elements.newImage.disabled = false;
    return;
  }
  try {
    let photo = !force ? state.photos[questionIndex] || await state.prefetches.get(questionIndex) : null;
    if (!photo) photo = await fetchPhoto(species, "high");
    if (token !== state.imageToken) return;
    rememberImage(species, photo.url);
    state.photos[questionIndex] = photo;
    displayPhoto(photo);
    warmImages(questionIndex, photo);
  } catch {
    if (token !== state.imageToken) return;
    elements.imageLoader.hidden = true;
    elements.imageError.hidden = false;
    elements.imageCredit.textContent = "Keine Bildquelle verfügbar";
    elements.sourceLink.href = `https://www.inaturalist.org/search?q=${encodeURIComponent(imageQuery(species))}`;
  } finally {
    if (token === state.imageToken) elements.newImage.disabled = false;
  }
}

function preload(url, priority = "auto", timeout = 10000) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.onload = image.onerror = null;
      image.removeAttribute("src");
      reject(new Error("Image timeout"));
    }, timeout);
    image.fetchPriority = priority;
    image.decoding = "async";
    image.onload = () => { window.clearTimeout(timer); resolve(); };
    image.onerror = error => { window.clearTimeout(timer); reject(error); };
    image.src = url;
  });
}

function answeredCount() {
  return state.responses.reduce((total, response) => total + Boolean(response), 0);
}

function showResults({ endedEarly = false } = {}) {
  stopSessionTimer();
  showView("results");
  const total = answeredCount();
  const percent = total ? Math.round(state.score / total * 100) : 0;
  const covered = state.sessionCoverage.size;
  const coverage = state.sessionPoolSize ? Math.round(covered / state.sessionPoolSize * 100) : 0;
  elements.resultsKicker.textContent = endedEarly ? "Sitzung beendet" : "Runde beendet";
  elements.resultsTitle.textContent = state.endless || endedEarly ? "Sitzungsstatistik" : "Dein Ergebnis";
  elements.resultPercent.textContent = `${percent} %`;
  elements.resultDetail.textContent = `${state.score} von ${total} Fragen richtig`;
  elements.resultQuestions.textContent = total;
  elements.resultCoverage.textContent = `${coverage} %`;
  elements.resultRepeats.textContent = Math.max(0, total - covered);
  if (sessionStart) {
    const secs = Math.round((Date.now() - sessionStart) / 1000);
    elements.resultTime.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} min`;
  } else {
    elements.resultTime.textContent = "";
  }
  elements.resultMessage.textContent = total === 0 ? "Noch keine Frage beantwortet." :
    percent >= 90 ? "Sehr sicher. Eine neue Runde hält die Namen frisch." :
    percent >= 70 ? "Solide Runde. Wiederhole jetzt am besten nur die Fehler." :
    "Guter Anfang. Kurze Runden mit Fehlerwiederholung bringen am meisten.";
  const uniqueMistakes = [...new Map(state.roundMistakes.map(item => [item.id, item])).values()];
  elements.mistakeReview.hidden = uniqueMistakes.length === 0;
  elements.repeatMistakes.hidden = uniqueMistakes.length === 0;
  elements.mistakeList.replaceChildren(...uniqueMistakes.map(species => {
    const item = document.createElement("li");
    item.innerHTML = `<strong>${escapeHtml(species.german)}</strong><em>${escapeHtml(species.latin)}</em>`;
    return item;
  }));
  elements.repeatMistakes.onclick = () => startQuiz({ species: uniqueMistakes });
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]);
}

function startSessionTimer() {
  sessionStart = Date.now();
  if (sessionTimerId) clearInterval(sessionTimerId);
  sessionTimerId = setInterval(() => {
    const secs = Math.floor((Date.now() - sessionStart) / 1000);
    elements.sessionTimer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  }, 500);
}

function stopSessionTimer() {
  if (sessionTimerId) { clearInterval(sessionTimerId); sessionTimerId = null; }
  if (sessionStart) {
    const secs = Math.floor((Date.now() - sessionStart) / 1000);
    elements.sessionTimer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  }
}

function exportProgress() {
  const data = {
    stats: state.stats,
    streak: state.streak,
    taxa: Object.fromEntries(state.taxa.entries()),
    exported: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pflichtarten-lernstand-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importProgress(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.stats) { state.stats = data.stats; saveStats(); }
      if (data.streak) { state.streak = data.streak; saveStreak(); }
      if (data.taxa) { state.taxa = new Map(Object.entries(data.taxa)); saveTaxa(); }
      updateHeader();
      alert("Lernstand erfolgreich importiert.");
    } catch { alert("Datei konnte nicht gelesen werden."); }
  };
  reader.readAsText(file);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  if (elements.themeToggle) elements.themeToggle.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) applyTheme(saved);
  else if (elements.themeToggle) {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    elements.themeToggle.textContent = dark ? "Light Mode" : "Dark Mode";
  }
}

elements.setupForm.addEventListener("submit", event => { event.preventDefault(); startQuiz(); });
elements.inputAnswer.addEventListener("submit", gradeInput);
elements.hintButton.addEventListener("click", revealHint);
elements.revealButton.addEventListener("click", revealAnswer);
elements.previousButton.addEventListener("click", previousQuestion);
elements.nextButton.addEventListener("click", nextQuestion);
elements.newImage.addEventListener("click", nextImage);
elements.expandImage.addEventListener("click", openQuizImage);
elements.image.addEventListener("click", openQuizImage);
elements.imageViewerClose.addEventListener("click", closeImageViewer);
elements.imageViewer.addEventListener("click", event => { if (event.target === elements.imageViewer) closeImageViewer(); });
elements.imageViewer.addEventListener("close", () => {
  viewerToken++;
  elements.imageViewerImage.removeAttribute("src");
});
elements.imageViewer.querySelector(".image-viewer-stage").addEventListener("click", event => {
  if (event.target === event.currentTarget) closeImageViewer();
});
elements.mistakesStart.addEventListener("click", () => startQuiz({ mistakesOnly: true }));
elements.taxonomyToggle.addEventListener("click", toggleTaxonomyFilter);
elements.markCurrent.addEventListener("change", () => {
  updateCurrentStudy({ marked: elements.markCurrent.checked });
  updateAvailableCount();
});
elements.noteToggle.addEventListener("click", () => setNoteOpen(elements.noteToggle.getAttribute("aria-expanded") !== "true"));
elements.speciesNote.addEventListener("input", saveCurrentNote);
elements.speciesNote.addEventListener("blur", flushNoteSave);
$$('[data-taxonomy-all]').forEach(button => button.addEventListener("click", () => setTaxonomyGroup(button.dataset.taxonomyAll, true)));
$$('[data-taxonomy-none]').forEach(button => button.addEventListener("click", () => setTaxonomyGroup(button.dataset.taxonomyNone, false)));
$("#quit-button").addEventListener("click", () => { flushNoteSave(); showResults({ endedEarly: true }); });
$("#back-home").addEventListener("click", () => { flushNoteSave(); stopSessionTimer(); showView("setup"); updateHeader(); });
elements.homeButton.addEventListener("click", () => { flushNoteSave(); stopSessionTimer(); showView("setup"); updateHeader(); });
elements.setupForm.addEventListener("change", updateAvailableCount);
window.addEventListener("pagehide", flushNoteSave);

// show/hide input fields sub-mode based on answer mode
$$('input[name="mode"]').forEach(radio => radio.addEventListener("change", () => {
  elements.inputFieldsLabel.hidden = radio.value !== "input" || !radio.checked;
}));

// keyboard shortcuts: A-D / 1-4 for single choice
document.addEventListener("keydown", event => {
  if (elements.quiz.hidden || state.mode !== "choice" || state.answered) {
    // Enter to proceed when answered
    if (event.key === "Enter" && !elements.quiz.hidden && state.answered &&
        ![elements.nextButton, elements.previousButton].includes(document.activeElement)) {
      event.preventDefault();
      nextQuestion();
    }
    return;
  }
  const keys = ["a", "b", "c", "d", "1", "2", "3", "4"];
  const idx = keys.indexOf(event.key.toLowerCase());
  if (idx >= 0) {
    const optionIndex = idx % 4;
    const button = elements.choiceAnswer.querySelectorAll("button")[optionIndex];
    if (button) { event.preventDefault(); button.click(); }
  }
});

// export / import
elements.exportButton.addEventListener("click", exportProgress);
elements.importButton.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", () => {
  if (elements.importFile.files[0]) importProgress(elements.importFile.files[0]);
});

// dark mode toggle
elements.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  const isDark = current === "dark" || (!current && window.matchMedia("(prefers-color-scheme: dark)").matches);
  applyTheme(isDark ? "light" : "dark");
});

// browse / stats navigation handled by extras.js

const installButton = $("#install-button");
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installButton.hidden = true;
});
window.addEventListener("appinstalled", () => { installButton.hidden = true; });

// PWA only works on https or localhost, file mode stays supported
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker
    .register("./service-worker.js", { updateViaCache: "none" })
    .then(registration => registration.update())
    .catch(() => {}));
}

renderTaxonomyFilters();
initTheme();
updateHeader();
