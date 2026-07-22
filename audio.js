const COMMONS_AUDIO_API = "https://commons.wikimedia.org/w/api.php";
const birdSoundPools = new Map();

function soundQueryNames(species) {
  return [...new Set([species.latin, ...species.latinAliases].map(name =>
    name.replace(/\b(agg|kl|f)\.?\b/gi, " ").replace(/\s+/g, " ").trim()))];
}

function soundLabelText(value) {
  return stripHtml(value || "").toLocaleLowerCase("de-DE").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss");
}

function classifySoundType(title, description) {
  const explicit = description.match(/(?:<b>|''')?\s*(?:type|typ)\s*:\s*(?:<\/b>|''')?\s*([^<\n]+)/i)?.[1] || "";
  const text = soundLabelText(explicit || `${title} ${description}`);
  if (/\b(juvenile|fledgling|nestling|young|begging|chick|immature|jungvogel|bettelruf|bettelnd|juvenil)\b/.test(text)) return "Jungvogelruf";
  const labels = [];
  if (/\b(song|singing|subsong|birdsong|gesang|balzgesang|singt)\b/.test(text)) labels.push("Gesang");
  if (/\b(call|calling|alarm|contact|flight call|ruf|rufe|ruft|warnruf|kontaktruf|flugruf)\b/.test(text)) labels.push("Ruf");
  return labels.length ? labels.join(" / ") : "Vogelstimme";
}

function playableSoundUrl(info) {
  const derivative = info.derivatives?.find(item => item.type === "audio/mpeg") ||
    info.derivatives?.find(item => item.type?.startsWith("audio/"));
  const url = derivative?.src || info.url;
  return url ? new URL(url, "https://commons.wikimedia.org").href : "";
}

function soundConfidence(page, expectedName, categoryMatch) {
  const info = page.videoinfo?.[0];
  const expected = cleanTaxonName(expectedName);
  const title = cleanTaxonName(page.title?.replace(/^File:/i, "") || "");
  const description = cleanTaxonName(stripHtml(info?.extmetadata?.ImageDescription?.value || ""));
  if (title.includes(expected)) return 3;
  if (description.includes(expected)) return 2;
  return categoryMatch ? 1 : 0;
}

function commonsSound(page, expectedName, categoryMatch = false) {
  const info = page.videoinfo?.[0];
  const description = info?.extmetadata?.ImageDescription?.value || "";
  const title = page.title?.replace(/^File:/i, "") || "";
  const confidence = soundConfidence(page, expectedName, categoryMatch);
  if (!info || !confidence) return null;
  const url = playableSoundUrl(info);
  if (!url) return null;
  const metadata = info.extmetadata || {};
  const artist = stripHtml(metadata.Artist?.value) || "Wikimedia-Commons-Mitwirkende";
  const license = metadata.LicenseShortName?.value ? ` · ${stripHtml(metadata.LicenseShortName.value)}` : "";
  return {
    url,
    type: classifySoundType(title, description),
    credit: `${artist}${license}`,
    link: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    confidence
  };
}

function commonsAudioParams(values) {
  return new URLSearchParams({
    action: "query", prop: "videoinfo",
    viprop: "url|derivatives|extmetadata|mime",
    viextmetadatafilter: "ImageDescription|Artist|LicenseShortName",
    maxlag: "5", format: "json", origin: "*", ...values
  });
}

async function fetchCommonsAudioPages(params) {
  let lastError = new Error("No Commons audio response");
  for (const delay of [0, 700, 1800]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      const response = await fetchWithTimeout(`${COMMONS_AUDIO_API}?${params}`, 10000);
      if (!response.ok) throw new Error(`Commons audio ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.code || "Commons API error");
      return Object.values(data.query?.pages || {});
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function fetchCommonsSounds(name) {
  const searches = [
    [commonsAudioParams({ generator: "search", gsrsearch: `intitle:\"${name}\" filetype:audio`, gsrnamespace: "6", gsrlimit: "10" }), false],
    [commonsAudioParams({ generator: "categorymembers", gcmtitle: `Category:Audio files of ${name}`, gcmnamespace: "6", gcmtype: "file", gcmlimit: "12" }), true],
    [commonsAudioParams({ generator: "search", gsrsearch: `\"${name}\" filetype:audio`, gsrnamespace: "6", gsrlimit: "10" }), false]
  ];
  const candidates = [];
  for (const [params, categoryMatch] of searches) {
    try {
      const pages = await fetchCommonsAudioPages(params);
      candidates.push(...pages.map(page => commonsSound(page, name, categoryMatch)).filter(Boolean));
    } catch { /* next search mode can still recover */ }
    if (candidates.filter(item => item.confidence >= 2).length >= 4) break;
  }
  return candidates;
}

async function fetchCommonsSpeciesSounds(species) {
  const candidates = [];
  for (const name of soundQueryNames(species)) {
    try { candidates.push(...await fetchCommonsSounds(name)); }
    catch { /* aliases below can still work */ }
    if (candidates.filter(item => item.confidence >= 2).length >= 4) break;
  }
  return candidates;
}

function iNaturalistSound(observation, sound) {
  const url = sound.file_url?.replace(/^http:/, "https:");
  if (!url) return null;
  const description = `${observation.description || ""} ${sound.attribution || ""}`;
  return {
    url,
    type: classifySoundType("", description),
    credit: sound.attribution || "iNaturalist-Mitwirkende",
    link: observation.uri || `https://www.inaturalist.org/observations/${observation.id}`,
    confidence: 3
  };
}

async function fetchINaturalistSounds(species) {
  const taxon = await resolveTaxon(species);
  const params = new URLSearchParams({
    taxon_id: String(taxon.id), sounds: "true", quality_grade: "research",
    order_by: "random", per_page: "20"
  });
  const response = await fetchWithTimeout(`https://api.inaturalist.org/v1/observations?${params}`, 10000);
  if (!response.ok) throw new Error("No iNaturalist audio response");
  const data = await response.json();
  return data.results.filter(observation => observation.taxon?.id === taxon.id ||
    observation.taxon?.ancestor_ids?.includes(taxon.id)).flatMap(observation =>
    (observation.sounds || []).map(sound => iNaturalistSound(observation, sound)).filter(Boolean));
}

function soundFormatScore(url) {
  return /\.(?:mp3|m4a|aac)(?:\?|$)/i.test(url) ? 2 : /\.(?:ogg|oga|webm)(?:\?|$)/i.test(url) ? 1 : 0;
}

async function fetchBirdSound(species) {
  let candidates = birdSoundPools.get(species.id);
  if (!candidates) {
    const sources = await Promise.allSettled([fetchCommonsSpeciesSounds(species), fetchINaturalistSounds(species)]);
    candidates = sources.flatMap(result => result.status === "fulfilled" ? result.value : []);
    // same transcode can surface via search and category
    candidates = [...candidates.reduce((items, item) => {
      const previous = items.get(item.url);
      if (!previous || item.confidence > previous.confidence) items.set(item.url, item);
      return items;
    }, new Map()).values()];
    if (candidates.length) birdSoundPools.set(species.id, candidates);
  }
  if (!candidates.length) throw new Error("No bird recording");
  const recent = state.recentSounds.get(species.id) || [];
  const fresh = candidates.filter(item => !recent.includes(item.url));
  // reliable and labeled first, weaker category hits remain load fallbacks
  const variants = shuffle(fresh.length ? fresh : candidates).sort((a, b) =>
    b.confidence - a.confidence || Number(b.type !== "Vogelstimme") - Number(a.type !== "Vogelstimme") ||
    soundFormatScore(b.url) - soundFormatScore(a.url));
  return { ...variants[0], variants, variantIndex: 0 };
}

function rememberSound(species, url) {
  const recent = state.recentSounds.get(species.id) || [];
  state.recentSounds.set(species.id, [...recent.filter(item => item !== url), url].slice(-8));
}

function currentSound(recording) {
  return recording?.variants?.[recording.variantIndex] || recording;
}

function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds)) return "–:––";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function resetAudioPosition() {
  elements.audioProgress.value = 0;
  elements.audioProgress.style.setProperty("--position", "0%");
  elements.audioCurrent.textContent = "0:00";
  elements.audioDuration.textContent = "–:––";
}

function setAudioPlaying(playing) {
  elements.audioStage.classList.toggle("playing", playing);
  elements.audioPlay.querySelector("span").textContent = playing ? "❚❚" : "▶";
  elements.audioPlay.setAttribute("aria-label", playing ? "Aufnahme pausieren" : "Aufnahme abspielen");
}

function displaySound(recording) {
  const sound = currentSound(recording);
  const species = state.queue[state.index];
  elements.audio.pause();
  setAudioPlaying(false);
  resetAudioPosition();
  elements.audioError.hidden = true;
  elements.audioType.textContent = sound.type;
  elements.audioStatus.textContent = "Bereit zum Abspielen";
  elements.audioCredit.textContent = sound.credit;
  elements.audioCredit.title = sound.credit;
  elements.audioSourceLink.href = sound.link;
  elements.audioPlay.disabled = false;
  elements.audioProgress.disabled = false;
  elements.audio.dataset.token = String(state.audioToken);
  elements.audio.src = sound.url;
  elements.audio.load();
  rememberSound(species, sound.url);
}

function showAudioFailure() {
  elements.audio.pause();
  setAudioPlaying(false);
  elements.audioError.hidden = false;
  elements.audioStatus.textContent = "Keine Aufnahme verfügbar";
  elements.audioCredit.textContent = "Keine Audioquelle verfügbar";
  elements.audioCredit.removeAttribute("title");
  elements.audioPlay.disabled = true;
  elements.audioProgress.disabled = true;
}

function tryNextSoundVariant() {
  const recording = state.sounds[state.index];
  if (!recording?.variants || recording.variantIndex >= recording.variants.length - 1) return false;
  recording.variantIndex++;
  displaySound(recording);
  return true;
}

async function loadSound(species = state.queue[state.index], force = false) {
  const token = ++state.audioToken;
  const questionIndex = state.index;
  elements.audio.pause();
  setAudioPlaying(false);
  resetAudioPosition();
  elements.audioError.hidden = true;
  elements.audioStatus.textContent = "Aufnahme wird geladen …";
  elements.audioCredit.textContent = "Aufnahmequelle wird geladen …";
  elements.audioSourceLink.href = "https://commons.wikimedia.org";
  elements.audioPlay.disabled = true;
  elements.audioProgress.disabled = true;
  elements.newAudio.disabled = true;
  const cached = state.sounds[questionIndex];
  if (cached && !force) {
    displaySound(cached);
    elements.newAudio.disabled = false;
    prefetchSound(questionIndex + 1);
    return;
  }
  try {
    let recording = !force ? await state.soundPrefetches.get(questionIndex) : null;
    if (!recording) recording = await fetchBirdSound(species);
    if (token !== state.audioToken) return;
    state.sounds[questionIndex] = recording;
    displaySound(recording);
    prefetchSound(questionIndex + 1);
  } catch {
    if (token === state.audioToken) showAudioFailure();
  } finally {
    if (token === state.audioToken) elements.newAudio.disabled = false;
  }
}

function prefetchSound(index) {
  if (index >= state.queue.length || state.sounds[index] || state.soundPrefetches.has(index)) return;
  const species = state.queue[index];
  const roundToken = state.roundToken;
  const task = fetchBirdSound(species).then(recording => {
    if (roundToken === state.roundToken && state.queue[index]?.id === species.id) state.sounds[index] = recording;
    return recording;
  }).catch(() => null);
  state.soundPrefetches.set(index, task);
  task.finally(() => {
    if (state.soundPrefetches.get(index) === task) state.soundPrefetches.delete(index);
  });
}

function prefetchQuestionMedia(index) {
  if (state.voiceMode) prefetchSound(index);
  else prefetchImage(index);
}

function renderQuestionMedia(species, response) {
  if (!state.voiceMode) {
    elements.audioStage.hidden = true;
    elements.imageStage.hidden = false;
    elements.photoCreditRow.hidden = false;
    elements.photoRevealLabel.hidden = true;
    loadImage(species);
    return;
  }
  elements.audioStage.hidden = false;
  const revealed = Boolean(response);
  elements.imageStage.hidden = !revealed;
  elements.photoCreditRow.hidden = !revealed;
  elements.photoRevealLabel.hidden = !revealed;
  loadSound(species);
  prefetchImage(state.index);
  if (revealed) loadImage(species);
}

function revealQuestionPhoto(species) {
  if (!state.voiceMode || !elements.imageStage.hidden) return;
  elements.imageStage.hidden = false;
  elements.photoCreditRow.hidden = false;
  elements.photoRevealLabel.hidden = false;
  loadImage(species);
}

function resetQuestionAudio() {
  state.audioToken++;
  elements.audio.pause();
  elements.audio.removeAttribute("src");
  elements.audio.load();
  setAudioPlaying(false);
  resetAudioPosition();
}

function updateAudioTimeline() {
  const duration = elements.audio.duration;
  elements.audioCurrent.textContent = formatAudioTime(elements.audio.currentTime);
  elements.audioDuration.textContent = formatAudioTime(duration);
  elements.audioProgress.value = Number.isFinite(duration) && duration > 0
    ? Math.round(elements.audio.currentTime / duration * 1000) : 0;
  elements.audioProgress.style.setProperty("--position", `${elements.audioProgress.value / 10}%`);
}

function initBirdAudio() {
  const heights = [32, 55, 78, 44, 67, 91, 58, 36, 73, 48, 86, 62, 38, 69, 95, 51, 76, 41, 83, 57, 34, 71, 89, 46, 64, 39, 81, 53, 74, 43, 66];
  elements.audioWave.replaceChildren(...heights.map((height, index) => {
    const bar = document.createElement("span");
    bar.style.setProperty("--height", `${height}%`);
    bar.style.setProperty("--delay", `${index % 7 * -80}ms`);
    return bar;
  }));
  elements.audioPlay.addEventListener("click", async () => {
    if (elements.audio.paused) {
      try { await elements.audio.play(); }
      catch { elements.audioStatus.textContent = "Wiedergabe nicht möglich"; }
    } else elements.audio.pause();
  });
  elements.audioProgress.addEventListener("input", () => {
    if (Number.isFinite(elements.audio.duration)) elements.audio.currentTime = elements.audioProgress.value / 1000 * elements.audio.duration;
  });
  elements.newAudio.addEventListener("click", () => loadSound(state.queue[state.index], true));
  elements.audio.addEventListener("loadedmetadata", () => {
    updateAudioTimeline();
    elements.audioStatus.textContent = "Bereit zum Abspielen";
  });
  elements.audio.addEventListener("timeupdate", updateAudioTimeline);
  elements.audio.addEventListener("play", () => {
    setAudioPlaying(true);
    elements.audioStatus.textContent = `${elements.audioType.textContent} läuft`;
  });
  elements.audio.addEventListener("pause", () => {
    setAudioPlaying(false);
    if (elements.audio.currentTime > 0 && !elements.audio.ended) elements.audioStatus.textContent = "Pausiert";
  });
  elements.audio.addEventListener("ended", () => {
    setAudioPlaying(false);
    elements.audioStatus.textContent = "Aufnahme beendet";
  });
  elements.audio.addEventListener("error", () => {
    if (!state.voiceMode || Number(elements.audio.dataset.token) !== state.audioToken) return;
    if (!tryNextSoundVariant()) showAudioFailure();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) elements.audio.pause(); });
}

initBirdAudio();
