const COMMONS_AUDIO_API = "https://commons.wikimedia.org/w/api.php";
const SPECTROGRAM_STORAGE_KEY = "pflichtarten-spectrograms-v2";
const birdSoundPools = new Map();
const spectrogramCache = loadStoredSpectrograms();
const SPECTROGRAM_COLUMNS = 360;
const SPECTROGRAM_ROWS = 72;
const SPECTROGRAM_FFT_SIZE = 512;
const SPECTROGRAM_WINDOWS = 3;
const AUDIO_PROGRESS_MAX = 100000;
let spectrogramToken = 0;
let audioFrameId = 0;

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

function playableSoundSource(info) {
  const derivative = info.derivatives?.find(item => item.type === "audio/mpeg") ||
    info.derivatives?.find(item => item.type?.startsWith("audio/"));
  const url = derivative?.src || info.url;
  if (!url) return null;
  const absoluteUrl = new URL(url, "https://commons.wikimedia.org").href;
  const original = info.derivatives?.find(item =>
    new URL(item.src, "https://commons.wikimedia.org").href === info.url);
  const duration = info.size && (original?.bandwidth || derivative?.bandwidth) ?
    info.size * 8 / (original?.bandwidth || derivative.bandwidth) : 0;
  return {
    url: absoluteUrl,
    duration,
    bytes: duration && derivative?.bandwidth ? duration * derivative.bandwidth / 8 : info.size || 0
  };
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
  const source = playableSoundSource(info);
  if (!source) return null;
  const metadata = info.extmetadata || {};
  const artist = stripHtml(metadata.Artist?.value) || "Wikimedia-Commons-Mitwirkende";
  const license = metadata.LicenseShortName?.value ? ` · ${stripHtml(metadata.LicenseShortName.value)}` : "";
  return {
    url: source.url,
    type: classifySoundType(title, description),
    credit: `${artist}${license}`,
    link: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    confidence,
    canAnalyze: true,
    durationEstimate: source.duration,
    bytesEstimate: source.bytes
  };
}

function commonsAudioParams(values) {
  return new URLSearchParams({
    action: "query", prop: "videoinfo",
    viprop: "url|derivatives|extmetadata|mime|size",
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
    if (candidates.filter(item => item.confidence >= 2).length >= 2) break;
  }
  return candidates;
}

async function fetchCommonsSpeciesSounds(species) {
  const candidates = [];
  for (const name of soundQueryNames(species)) {
    try { candidates.push(...await fetchCommonsSounds(name)); }
    catch { /* aliases below can still work */ }
    if (candidates.filter(item => item.confidence >= 2).length >= 2) break;
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
    confidence: 3,
    canAnalyze: false
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

function soundLengthScore(sound) {
  const duration = sound.durationEstimate;
  if (!duration) return 1;
  if (duration >= 3 && duration <= 90) return 3;
  return duration <= 180 ? 2 : 0;
}

function mergeSoundCandidates(...groups) {
  return [...groups.flat().reduce((items, item) => {
    const previous = items.get(item.url);
    if (!previous || item.confidence > previous.confidence) items.set(item.url, item);
    return items;
  }, new Map()).values()];
}

async function fetchBirdSound(species) {
  let candidates = birdSoundPools.get(species.id);
  if (!candidates) {
    const commons = await fetchCommonsSpeciesSounds(species).catch(() => []);
    candidates = mergeSoundCandidates(commons);
    if (!candidates.length) {
      candidates = mergeSoundCandidates(await fetchINaturalistSounds(species).catch(() => []));
    } else {
      // dont block first paint on a fallback source
      fetchINaturalistSounds(species).then(fallbacks =>
        birdSoundPools.set(species.id, mergeSoundCandidates(candidates, fallbacks))).catch(() => {});
    }
    if (candidates.length) birdSoundPools.set(species.id, candidates);
  }
  if (!candidates.length) throw new Error("No bird recording");
  const recent = state.recentSounds.get(species.id) || [];
  const fresh = candidates.filter(item => !recent.includes(item.url));
  // reliable and labeled first, weaker category hits remain load fallbacks
  const variants = shuffle(fresh.length ? fresh : candidates).sort((a, b) =>
    Number(b.canAnalyze && b.confidence >= 2) - Number(a.canAnalyze && a.confidence >= 2) ||
    b.confidence - a.confidence || Number(b.canAnalyze) - Number(a.canAnalyze) ||
    Number(b.type !== "Vogelstimme") - Number(a.type !== "Vogelstimme") ||
    soundLengthScore(b) - soundLengthScore(a) ||
    (a.bytesEstimate || Number.MAX_SAFE_INTEGER) - (b.bytesEstimate || Number.MAX_SAFE_INTEGER) ||
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

function updateSpectrogramProgress(progress) {
  const position = Math.max(0, Math.min(1, progress || 0));
  elements.audioSpectrum.style.setProperty("--position", `${position * 100}%`);
  elements.audioSpectrum.classList.toggle("has-progress", position > .002);
}

function setSpectrogramMask(mask) {
  for (const layer of [elements.audioSpectrumBase, elements.audioSpectrumPlayed]) {
    layer.style.webkitMaskImage = `url("${mask}")`;
    layer.style.maskImage = `url("${mask}")`;
  }
  elements.audioSpectrum.classList.remove("loading", "unavailable");
  elements.audioSpectrum.classList.add("ready");
  elements.audioSpectrumNote.hidden = true;
}

function showSpectrogramNote(text, unavailable = false) {
  for (const layer of [elements.audioSpectrumBase, elements.audioSpectrumPlayed]) {
    layer.style.removeProperty("-webkit-mask-image");
    layer.style.removeProperty("mask-image");
  }
  elements.audioSpectrum.classList.remove("ready");
  elements.audioSpectrum.classList.toggle("loading", !unavailable);
  elements.audioSpectrum.classList.toggle("unavailable", unavailable);
  elements.audioSpectrumNote.textContent = text;
  elements.audioSpectrumNote.hidden = false;
}

function resetSpectrogram(text = "Spektrogramm wird erstellt …") {
  spectrogramToken++;
  showSpectrogramNote(text);
  updateSpectrogramProgress(0);
}

function loadStoredSpectrograms() {
  try { return new Map(JSON.parse(localStorage.getItem(SPECTROGRAM_STORAGE_KEY) || "[]")); }
  catch { return new Map(); }
}

function cacheSpectrogram(url, mask) {
  spectrogramCache.set(url, mask);
  if (spectrogramCache.size > 12) spectrogramCache.delete(spectrogramCache.keys().next().value);
  // keep processed spectra, avoids another download and decode later
  try {
    const reusable = [...spectrogramCache].filter(([, value]) => value);
    localStorage.setItem(SPECTROGRAM_STORAGE_KEY, JSON.stringify(reusable));
  }
  catch { /* cache is optional */ }
}

function collectSpectrogramSamples(buffer) {
  const samples = new Float32Array(SPECTROGRAM_COLUMNS * SPECTROGRAM_WINDOWS * SPECTROGRAM_FFT_SIZE);
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, index) => buffer.getChannelData(index));
  for (let column = 0; column < SPECTROGRAM_COLUMNS; column++) {
    const regionStart = column / SPECTROGRAM_COLUMNS * buffer.length;
    const regionEnd = (column + 1) / SPECTROGRAM_COLUMNS * buffer.length;
    for (let sampleWindow = 0; sampleWindow < SPECTROGRAM_WINDOWS; sampleWindow++) {
      const center = regionStart + (sampleWindow + .5) / SPECTROGRAM_WINDOWS * (regionEnd - regionStart);
      const sourceStart = Math.max(0, Math.min(buffer.length - SPECTROGRAM_FFT_SIZE,
        Math.round(center - SPECTROGRAM_FFT_SIZE / 2)));
      const targetStart = (column * SPECTROGRAM_WINDOWS + sampleWindow) * SPECTROGRAM_FFT_SIZE;
      for (let index = 0; index < SPECTROGRAM_FFT_SIZE; index++) {
        let value = 0;
        for (const channel of channels) value += channel[sourceStart + index] || 0;
        samples[targetStart + index] = value / channels.length;
      }
    }
  }
  return samples;
}

function analyzeSpectrogram(samples, sampleRate) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("spectrogram-worker.js?v=3");
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.onerror = event => {
      worker.terminate();
      reject(new Error(event.message || "Spectrogram worker failed"));
    };
    worker.postMessage({
      samples,
      sampleRate,
      columns: SPECTROGRAM_COLUMNS,
      rows: SPECTROGRAM_ROWS,
      fftSize: SPECTROGRAM_FFT_SIZE,
      windows: SPECTROGRAM_WINDOWS
    }, [samples.buffer]);
  });
}

function spectrogramMask(values, columns, rows) {
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  const image = context.createImageData(columns, rows);
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const source = column * rows + row;
      const target = (row * columns + column) * 4;
      image.data[target + 3] = Math.round(values[source] * 255);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

async function renderSpectrogram(sound) {
  const token = ++spectrogramToken;
  const cached = spectrogramCache.get(sound.url);
  if (cached !== undefined) {
    if (cached) setSpectrogramMask(cached);
    else showSpectrogramNote("Spektrogramm für diese Quelle nicht verfügbar", true);
    return;
  }
  showSpectrogramNote("Spektrogramm wird erstellt …");
  if (!sound.canAnalyze || !window.Worker) {
    cacheSpectrogram(sound.url, null);
    if (token === spectrogramToken) showSpectrogramNote("Spektrogramm für diese Quelle nicht verfügbar", true);
    return;
  }
  try {
    const response = await fetchWithTimeout(sound.url, 20000);
    if (!response.ok) throw new Error(`Audio ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 24 * 1024 * 1024) throw new Error("Audio too large");
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineContext) throw new Error("No audio decoder");
    const buffer = await new OfflineContext(1, 1, 44100).decodeAudioData(bytes);
    const samples = collectSpectrogramSamples(buffer);
    const analysis = await analyzeSpectrogram(samples, buffer.sampleRate);
    const mask = spectrogramMask(analysis.values, analysis.columns, analysis.rows);
    cacheSpectrogram(sound.url, mask);
    if (token === spectrogramToken) setSpectrogramMask(mask);
  } catch {
    cacheSpectrogram(sound.url, null);
    if (token === spectrogramToken) showSpectrogramNote("Spektrogramm für diese Quelle nicht verfügbar", true);
  }
}

function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds)) return "–:––";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function resetAudioPosition() {
  stopAudioProgressLoop(false);
  elements.audioProgress.value = 0;
  elements.audioCurrent.textContent = "0:00";
  elements.audioDuration.textContent = "–:––";
  updateSpectrogramProgress(0);
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
  renderSpectrogram(sound);
  rememberSound(species, sound.url);
}

function showAudioFailure() {
  spectrogramToken++;
  showSpectrogramNote("Keine Aufnahme verfügbar", true);
  updateSpectrogramProgress(0);
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
  resetSpectrogram("Spektrogramm wird vorbereitet …");
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
  resetSpectrogram("Spektrogramm wird vorbereitet …");
  elements.audio.pause();
  elements.audio.removeAttribute("src");
  elements.audio.load();
  setAudioPlaying(false);
  resetAudioPosition();
}

function updateAudioTimeline() {
  const duration = elements.audio.duration;
  const progress = Number.isFinite(duration) && duration > 0
    ? Math.max(0, Math.min(1, elements.audio.currentTime / duration)) : 0;
  const currentLabel = formatAudioTime(elements.audio.currentTime);
  const durationLabel = formatAudioTime(duration);
  if (elements.audioCurrent.textContent !== currentLabel) elements.audioCurrent.textContent = currentLabel;
  if (elements.audioDuration.textContent !== durationLabel) elements.audioDuration.textContent = durationLabel;
  elements.audioProgress.value = Math.round(progress * AUDIO_PROGRESS_MAX);
  updateSpectrogramProgress(progress);
}

function stopAudioProgressLoop(sync = true) {
  if (audioFrameId) cancelAnimationFrame(audioFrameId);
  audioFrameId = 0;
  if (sync) updateAudioTimeline();
}

function startAudioProgressLoop() {
  if (audioFrameId) return;
  const tick = () => {
    if (elements.audio.paused || elements.audio.ended) {
      audioFrameId = 0;
      return;
    }
    updateAudioTimeline();
    audioFrameId = requestAnimationFrame(tick);
  };
  updateAudioTimeline();
  audioFrameId = requestAnimationFrame(tick);
}

function initBirdAudio() {
  elements.audioPlay.addEventListener("click", async () => {
    if (elements.audio.paused) {
      try { await elements.audio.play(); }
      catch { elements.audioStatus.textContent = "Wiedergabe nicht möglich"; }
    } else elements.audio.pause();
  });
  elements.audioProgress.addEventListener("input", () => {
    if (Number.isFinite(elements.audio.duration)) {
      elements.audio.currentTime = elements.audioProgress.value / AUDIO_PROGRESS_MAX * elements.audio.duration;
    }
    updateAudioTimeline();
  });
  elements.newAudio.addEventListener("click", () => loadSound(state.queue[state.index], true));
  elements.audio.addEventListener("loadedmetadata", () => {
    updateAudioTimeline();
    elements.audioStatus.textContent = "Bereit zum Abspielen";
  });
  // browser event is low-fps, keep as background fallback
  elements.audio.addEventListener("timeupdate", () => { if (!audioFrameId) updateAudioTimeline(); });
  elements.audio.addEventListener("play", () => {
    setAudioPlaying(true);
    startAudioProgressLoop();
    elements.audioStatus.textContent = `${elements.audioType.textContent} läuft`;
  });
  elements.audio.addEventListener("pause", () => {
    setAudioPlaying(false);
    stopAudioProgressLoop();
    if (elements.audio.currentTime > 0 && !elements.audio.ended) elements.audioStatus.textContent = "Pausiert";
  });
  elements.audio.addEventListener("ended", () => {
    setAudioPlaying(false);
    stopAudioProgressLoop();
    elements.audioStatus.textContent = "Aufnahme beendet";
  });
  elements.audio.addEventListener("error", () => {
    if (!state.voiceMode || Number(elements.audio.dataset.token) !== state.audioToken) return;
    if (!tryNextSoundVariant()) showAudioFailure();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) elements.audio.pause(); });
}

initBirdAudio();
