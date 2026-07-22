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

function commonsSound(page, expectedName) {
  const info = page.videoinfo?.[0];
  const description = info?.extmetadata?.ImageDescription?.value || "";
  const title = page.title?.replace(/^File:/i, "") || "";
  if (!info || !cleanTaxonName(title).includes(cleanTaxonName(expectedName))) return null;
  const url = playableSoundUrl(info);
  if (!url) return null;
  const metadata = info.extmetadata || {};
  const artist = stripHtml(metadata.Artist?.value) || "Wikimedia-Commons-Mitwirkende";
  const license = metadata.LicenseShortName?.value ? ` · ${stripHtml(metadata.LicenseShortName.value)}` : "";
  return {
    url,
    type: classifySoundType(title, description),
    credit: `${artist}${license}`,
    link: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`
  };
}

async function fetchCommonsSounds(name) {
  const params = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: `intitle:\"${name}\" filetype:audio`,
    gsrnamespace: "6", gsrlimit: "10", prop: "videoinfo",
    viprop: "url|derivatives|extmetadata|mime",
    viextmetadatafilter: "ImageDescription|Artist|LicenseShortName", format: "json", origin: "*"
  });
  const response = await fetchWithTimeout(`${COMMONS_AUDIO_API}?${params}`, 9000);
  if (!response.ok) throw new Error("No Commons audio response");
  const data = await response.json();
  return Object.values(data.query?.pages || {}).map(page => commonsSound(page, name)).filter(Boolean);
}

async function fetchBirdSound(species) {
  let candidates = birdSoundPools.get(species.id);
  if (!candidates) {
    candidates = [];
    for (const name of soundQueryNames(species)) {
      try { candidates.push(...await fetchCommonsSounds(name)); }
      catch { /* aliases below can still work */ }
      if (candidates.length >= 4) break;
    }
    candidates = [...new Map(candidates.map(item => [item.url, item])).values()];
    if (candidates.length) birdSoundPools.set(species.id, candidates);
  }
  if (!candidates.length) throw new Error("No bird recording");
  const labeled = candidates.filter(item => item.type !== "Vogelstimme");
  const pool = labeled.length ? labeled : candidates;
  const recent = state.recentSounds.get(species.id) || [];
  const fresh = pool.filter(item => !recent.includes(item.url));
  const variants = shuffle(fresh.length ? fresh : pool);
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
