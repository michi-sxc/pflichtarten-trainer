const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const elements = {
  setup: $("#setup-view"), quiz: $("#quiz-view"), results: $("#results-view"),
  setupForm: $("#setup-form"), choiceAnswer: $("#choice-answer"), inputAnswer: $("#input-answer"),
  inputSubmit: $("#input-answer button[type='submit']"),
  germanInput: $("#german-input"), latinInput: $("#latin-input"), feedback: $("#feedback"),
  feedbackLabel: $("#feedback-label"), answerGerman: $("#answer-german"), answerLatin: $("#answer-latin"),
  hintButton: $("#hint-button"), hintText: $("#hint-text"), revealButton: $("#reveal-button"),
  previousButton: $("#previous-button"), nextButton: $("#next-button"), newImage: $("#new-image"), image: $("#species-image"),
  imageLoader: $("#image-loader"), imageError: $("#image-error"), imageCredit: $("#image-credit"),
  sourceLink: $("#source-link"), questionKicker: $("#question-kicker"), questionTitle: $("#question-title"), progressText: $("#progress-text"),
  progressBar: $("#progress-bar"), scoreText: $("#score-text"), mastered: $("#mastered-count"),
  due: $("#due-count"), speciesCount: $("#species-count"), mistakesStart: $("#mistakes-start"),
  resultPercent: $("#result-percent"), resultDetail: $("#result-detail"), resultMessage: $("#result-message"),
  mistakeReview: $("#mistake-review"), mistakeList: $("#mistake-list"), repeatMistakes: $("#repeat-mistakes"),
  learningNote: $("#learning-note"), featureText: $("#feature-text"),
  comparisonBlock: $("#comparison-block"), comparisonList: $("#comparison-list")
};

const STORAGE_KEY = "pflichtarten-trainer-v1";
let installPrompt;
const state = {
  stats: loadStats(), queue: [], index: 0, score: 0, mode: "choice", scope: "all",
  smart: true, answered: false, hintUsed: false, roundMistakes: [], imageToken: 0,
  recentImages: new Map(), responses: [], options: [], photos: [], taxa: new Map()
};

function loadStats() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveStats() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.stats)); }
  catch { /* private mode can block storage, quiz still works */ }
}

function getStat(species) {
  return state.stats[species.id] || { seen: 0, correct: 0, wrong: 0, level: 0, mistake: false };
}

function updateHeader() {
  const values = SPECIES.map(getStat);
  elements.mastered.textContent = values.filter(item => item.level >= 3).length;
  const due = SPECIES.filter(item => getStat(item).mistake).length;
  elements.due.textContent = due;
  elements.mistakesStart.hidden = due === 0;
  elements.mistakesStart.textContent = `${due} Fehler wiederholen`;
  updateAvailableCount();
}

function currentScope() {
  return new FormData(elements.setupForm).get("scope") || "all";
}

function scopedSpecies(scope = currentScope()) {
  if (scope === "all") return SPECIES;
  if (scope === "taxon") return SPECIES.filter(item => item.kind === "taxon");
  if (scope === "animal") return SPECIES.filter(item => item.group === "animal" && item.kind === "species");
  return SPECIES.filter(item => item.group === scope);
}

function updateAvailableCount() {
  const scope = currentScope();
  const count = scopedSpecies().length;
  const labels = { all: "Arten und Tiergruppen", plant: "Pflanzenarten", animal: "Tierarten", taxon: "Tiergruppen" };
  elements.speciesCount.textContent = `${count} ${labels[scope]} in dieser Auswahl`;
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

function startQuiz({ mistakesOnly = false, species = null } = {}) {
  const form = new FormData(elements.setupForm);
  state.scope = form.get("scope") || "all";
  state.mode = form.get("mode") || "choice";
  state.smart = form.get("smart") === "on";
  const pool = species || scopedSpecies(state.scope).filter(item => !mistakesOnly || getStat(item).mistake);
  const countValue = form.get("count") || "20";
  const count = mistakesOnly || countValue === "all" ? pool.length : Math.min(Number(countValue), pool.length);
  state.queue = state.smart ? weightedSample(pool, count) : shuffle(pool).slice(0, count);
  state.index = 0;
  state.score = 0;
  state.roundMistakes = [];
  state.responses = [];
  state.options = [];
  state.photos = [];
  showView("quiz");
  renderQuestion();
}

function showView(name) {
  elements.setup.hidden = name !== "setup";
  elements.quiz.hidden = name !== "quiz";
  elements.results.hidden = name !== "results";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderQuestion() {
  if (state.index >= state.queue.length) return showResults();
  const species = state.queue[state.index];
  const response = state.responses[state.index];
  state.answered = Boolean(response);
  state.hintUsed = response?.hintUsed || false;
  elements.feedback.hidden = true;
  elements.learningNote.hidden = true;
  elements.hintText.hidden = true;
  elements.hintButton.hidden = state.answered;
  elements.revealButton.hidden = state.answered;
  elements.previousButton.disabled = state.index === 0;
  elements.questionKicker.textContent = species.group === "plant" ? "Pflanze bestimmen" : "Tier bestimmen";
  elements.progressText.textContent = `${state.index + 1} / ${state.queue.length}`;
  elements.scoreText.textContent = `${state.score} richtig`;
  elements.progressBar.style.width = `${(state.index / state.queue.length) * 100}%`;
  elements.choiceAnswer.hidden = state.mode !== "choice";
  elements.inputAnswer.hidden = state.mode !== "input";
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
  else {
    elements.germanInput.setAttribute("aria-invalid", String(!response.germanOk));
    elements.latinInput.setAttribute("aria-invalid", String(!response.latinOk));
  }
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

function gradeInput(event) {
  event.preventDefault();
  if (state.answered) return;
  const species = state.queue[state.index];
  const germanOk = acceptedNames(species.german, species.germanAliases).includes(normalize(elements.germanInput.value));
  const latinOk = acceptedNames(species.latin, species.latinAliases).includes(normalize(elements.latinInput.value));
  elements.germanInput.setAttribute("aria-invalid", String(!germanOk));
  elements.latinInput.setAttribute("aria-invalid", String(!latinOk));
  recordAnswer(germanOk && latinOk, {
    german: elements.germanInput.value,
    latin: elements.latinInput.value,
    germanOk,
    latinOk
  });
}

function recordAnswer(correct, detail = {}) {
  if (state.responses[state.index]) return;
  state.answered = true;
  const species = state.queue[state.index];
  state.responses[state.index] = { correct, hintUsed: state.hintUsed, ...detail };
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
  updateHeader();
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
  elements.progressBar.style.width = `${((state.index + 1) / state.queue.length) * 100}%`;
  elements.scoreText.textContent = `${state.score} richtig`;
  elements.nextButton.textContent = state.index + 1 === state.queue.length ? "Ergebnis ansehen" : "Nächste Frage";
  if (focusNext) elements.nextButton.focus();
}

function showLearningNote(species) {
  elements.learningNote.hidden = false;
  elements.featureText.textContent = FEATURES[species.id];
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
  state.index++;
  renderQuestion();
}

function previousQuestion() {
  if (state.index === 0) return;
  state.index--;
  renderQuestion();
}

function imageQuery(species) {
  return (species.imageName || species.latin).replace(/\s+agg\.?$/i, "");
}

function largerPhoto(url) {
  return url.replace(/\/(square|small|thumb)\./, "/large.");
}

function rememberImage(species, url) {
  const recent = state.recentImages.get(species.id) || [];
  state.recentImages.set(species.id, [...recent.filter(item => item !== url), url].slice(-8));
}

function cleanTaxonName(value) {
  return value.replace(/\b(agg|kl|f)\.?\b/gi, " ").replace(/[^\p{L}-]+/gu, " ").trim().toLowerCase();
}

async function resolveTaxon(species) {
  if (state.taxa.has(species.id)) return state.taxa.get(species.id);
  const names = [...new Set([imageQuery(species), species.latin, ...species.latinAliases].map(name =>
    name.replace(/\b(agg|kl|f)\.?\b/gi, " ").replace(/\s+/g, " ").trim()))];
  for (const name of names) {
    const params = new URLSearchParams({ q: name, per_page: "30" });
    const response = await fetch(`https://api.inaturalist.org/v1/taxa?${params}`);
    if (!response.ok) continue;
    const data = await response.json();
    const exact = data.results.find(taxon => cleanTaxonName(taxon.name) === cleanTaxonName(name));
    if (exact) {
      state.taxa.set(species.id, exact);
      return exact;
    }
  }
  throw new Error("No exact iNaturalist taxon");
}

async function fetchINaturalist(species) {
  const taxon = await resolveTaxon(species);
  const params = new URLSearchParams({
    taxon_id: String(taxon.id), photos: "true", quality_grade: "research", photo_license: "any",
    order_by: "random", per_page: "30"
  });
  const response = await fetch(`https://api.inaturalist.org/v1/observations?${params}`);
  if (response.ok) {
    const data = await response.json();
    const observations = data.results.filter(item => item.photos?.length &&
      (item.taxon?.id === taxon.id || item.taxon?.ancestor_ids?.includes(taxon.id)));
    const recent = state.recentImages.get(species.id) || [];
    // main photo shows the ID target more reliably than later habitat shots
    const photos = shuffle(observations.map(observation => ({ photo: observation.photos[0], observation })));
    const picked = photos.find(item => !recent.includes(largerPhoto(item.photo.url))) || photos[0];
    if (picked) {
      const url = largerPhoto(picked.photo.url);
      return {
        url,
        credit: picked.photo.attribution || "iNaturalist-Mitwirkende",
        link: picked.observation.uri || `https://www.inaturalist.org/observations/${picked.observation.id}`
      };
    }
  }
  if (taxon.default_photo?.url) {
    const url = largerPhoto(taxon.default_photo.medium_url || taxon.default_photo.url);
    return {
      url,
      credit: taxon.default_photo.attribution || "iNaturalist-Mitwirkende",
      link: `https://www.inaturalist.org/taxa/${taxon.id}`
    };
  }
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
    gsrnamespace: "6", gsrlimit: "20", prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "1400",
    format: "json", origin: "*"
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
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

function displayPhoto(photo) {
  elements.image.src = photo.url;
  elements.image.alt = "Fundfoto der zu bestimmenden Art";
  elements.image.hidden = false;
  elements.imageLoader.hidden = true;
  elements.imageCredit.textContent = photo.credit;
  elements.sourceLink.href = photo.link;
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
  const cached = state.photos[questionIndex];
  if (cached && !force) {
    displayPhoto(cached);
    elements.newImage.disabled = false;
    return;
  }
  try {
    let photo;
    try { photo = await fetchINaturalist(species); }
    catch { photo = await fetchCommons(species); }
    if (token !== state.imageToken) return;
    await preload(photo.url);
    if (token !== state.imageToken) return;
    rememberImage(species, photo.url);
    state.photos[questionIndex] = photo;
    displayPhoto(photo);
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

function preload(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = reject;
    image.src = url;
  });
}

function showResults() {
  showView("results");
  const total = state.queue.length;
  const percent = total ? Math.round(state.score / total * 100) : 0;
  elements.resultPercent.textContent = `${percent} %`;
  elements.resultDetail.textContent = `${state.score} von ${total} Fragen richtig`;
  elements.resultMessage.textContent = percent >= 90 ? "Sehr sicher. Eine neue Runde hält die Namen frisch." :
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

elements.setupForm.addEventListener("submit", event => { event.preventDefault(); startQuiz(); });
elements.inputAnswer.addEventListener("submit", gradeInput);
elements.hintButton.addEventListener("click", revealHint);
elements.revealButton.addEventListener("click", revealAnswer);
elements.previousButton.addEventListener("click", previousQuestion);
elements.nextButton.addEventListener("click", nextQuestion);
elements.newImage.addEventListener("click", () => loadImage(undefined, true));
elements.mistakesStart.addEventListener("click", () => startQuiz({ mistakesOnly: true }));
$("#quit-button").addEventListener("click", () => { showView("setup"); updateHeader(); });
$("#back-home").addEventListener("click", () => { showView("setup"); updateHeader(); });
elements.setupForm.addEventListener("change", updateAvailableCount);
document.addEventListener("keydown", event => {
  if (event.key === "Enter" && !elements.quiz.hidden && state.answered &&
      ![elements.nextButton, elements.previousButton].includes(document.activeElement)) {
    event.preventDefault();
    nextQuestion();
  }
});

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
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}

updateHeader();
