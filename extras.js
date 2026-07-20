// browse + stats view logic — loaded after app.js via defer

const BROWSE_PAGE = 24;
const BROWSE_IMAGE_CONCURRENCY = 4;
let browseOffset = 0;
let browseFilter = "all";
let browseSearch = "";
let browseObserver = null;
let browseGeneration = 0;
let browseImageActive = 0;
let browseImageQueue = [];
let browseSearchTimer;
const browsePhotoCache = new Map();
let statsSort = { key: "name", direction: 1 };

function browseFiltered() {
  const q = browseSearch.toLowerCase();
  return SPECIES.filter(item => {
    if (browseFilter === "plant" && item.group !== "plant") return false;
    if (browseFilter === "animal" && item.group !== "animal") return false;
    if (browseFilter === "taxon" && item.kind !== "taxon") return false;
    if (browseFilter === "marked" && !getStat(item).marked) return false;
    if (q) {
      const hay = `${item.german} ${item.latin} ${(item.germanAliases || []).join(" ")} ${(item.latinAliases || []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderBrowsePage() {
  const items = browseFiltered();
  const slice = items.slice(browseOffset, browseOffset + BROWSE_PAGE);
  const frag = document.createDocumentFragment();

  for (const item of slice) {
    const stat = getStat(item);
    const card = document.createElement("div");
    card.className = "browse-card";
    card.dataset.id = item.id;
    card.dataset.generation = browseGeneration;

    const imgWrap = document.createElement("div");
    imgWrap.className = "browse-card-img";
    const placeholder = document.createElement("span");
    placeholder.className = "browse-placeholder";
    placeholder.textContent = "Foto laden …";
    imgWrap.appendChild(placeholder);
    card.appendChild(imgWrap);

    const body = document.createElement("div");
    body.className = "browse-card-body";
    body.innerHTML = `<strong>${escapeHtml(item.german)}</strong><em>${escapeHtml(item.latin)}</em>`;

    const feat = FEATURES[item.id];
    if (feat) {
      const p = document.createElement("p");
      p.textContent = feat;
      body.appendChild(p);
    }

    const level = document.createElement("span");
    level.className = `browse-card-level l${stat.level}`;
    level.textContent = stat.seen === 0 ? "neu" : `Lv ${stat.level}`;
    body.appendChild(level);

    const mark = document.createElement("label");
    mark.className = "browse-card-mark";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = stat.marked;
    cb.addEventListener("change", () => {
      stat.marked = cb.checked;
      state.stats[item.id] = stat;
      saveStats();
      updateHeader();
    });
    mark.appendChild(cb);
    mark.appendChild(document.createTextNode("merken"));
    body.appendChild(mark);

    card.appendChild(body);
    frag.appendChild(card);
  }

  elements.browseGrid.appendChild(frag);
  browseOffset += slice.length;
  elements.browseMore.hidden = browseOffset >= items.length;

  // lazy-load images for newly added cards
  lazyLoadBrowseImages();
}

function lazyLoadBrowseImages() {
  if (!("IntersectionObserver" in window)) {
    elements.browseGrid.querySelectorAll(".browse-card:not([data-img-loaded])").forEach(queueBrowseCardImage);
    return;
  }
  if (!browseObserver) {
    browseObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        browseObserver.unobserve(entry.target);
        queueBrowseCardImage(entry.target);
      }
    }, { rootMargin: "180px" });
  }
  elements.browseGrid.querySelectorAll(".browse-card:not([data-img-loaded])").forEach(card => browseObserver.observe(card));
}

function queueBrowseCardImage(card) {
  if (card.dataset.imgQueued) return;
  card.dataset.imgQueued = "1";
  browseImageQueue.push(card);
  pumpBrowseImages();
}

function pumpBrowseImages() {
  while (browseImageActive < BROWSE_IMAGE_CONCURRENCY && browseImageQueue.length) {
    const card = browseImageQueue.shift();
    const generation = Number(card.dataset.generation);
    if (!card.isConnected || generation !== browseGeneration) continue;
    browseImageActive++;
    loadBrowseCardImage(card).finally(() => {
      if (generation !== browseGeneration) return;
      browseImageActive--;
      pumpBrowseImages();
    });
  }
}

async function loadBrowseCardImage(card) {
  const item = SPECIES.find(species => species.id === card.dataset.id);
  if (!item || !card.isConnected) return;
  card.dataset.imgLoaded = "1";
  const generation = Number(card.dataset.generation);
  const imgWrap = card.querySelector(".browse-card-img");

  try {
    let photo = browsePhotoCache.get(item.id);
    if (!photo) {
      const taxon = await resolveTaxon(item);
      photo = taxon.default_photo && {
        url: browsePhotoUrl(taxon.default_photo.medium_url || taxon.default_photo.url),
        credit: taxon.default_photo.attribution || "iNaturalist-Mitwirkende",
        link: `https://www.inaturalist.org/taxa/${taxon.id}`
      };
      if (!photo) photo = await fetchCommons(item);
      browsePhotoCache.set(item.id, photo);
    }
    if (!card.isConnected || generation !== browseGeneration) return;
    card._photo = photo;
    showBrowseImg(imgWrap, photo.url, item.german, () => recoverBrowseCardImage(card, item, generation));
    addBrowsePhotoActions(card, item);
  } catch {
    if (card.isConnected && generation === browseGeneration) {
      setBrowsePlaceholder(imgWrap, "Ersatzfoto wird geladen …");
      recoverBrowseCardImage(card, item, generation);
    }
  }
}

async function recoverBrowseCardImage(card, item, generation) {
  if (card.dataset.imgRecovering || !card.isConnected || generation !== browseGeneration) return;
  card.dataset.imgRecovering = "1";
  const imgWrap = card.querySelector(".browse-card-img");
  setBrowsePlaceholder(imgWrap, "Ersatzfoto wird geladen …");
  try {
    const photo = await fetchPhoto(item, "low");
    if (!card.isConnected || generation !== browseGeneration) return;
    card._photo = photo;
    browsePhotoCache.set(item.id, photo);
    showBrowseImg(imgWrap, photo.url, item.german);
    addBrowsePhotoActions(card, item);
  } catch {
    if (card.isConnected && generation === browseGeneration) setBrowsePlaceholder(imgWrap, "Kein Foto verfügbar");
  } finally {
    delete card.dataset.imgRecovering;
  }
}

function setBrowsePlaceholder(imgWrap, text) {
  let placeholder = imgWrap.querySelector(".browse-placeholder");
  if (!placeholder) {
    placeholder = document.createElement("span");
    placeholder.className = "browse-placeholder";
    imgWrap.prepend(placeholder);
  }
  placeholder.textContent = text;
}

function showBrowseImg(imgWrap, url, name, onError = null) {
  const old = imgWrap.querySelector("img");
  if (old) old.remove();
  const img = document.createElement("img");
  img.loading = "eager";
  img.decoding = "async";
  img.fetchPriority = "high";
  img.alt = name;
  img.onload = () => {
    imgWrap.querySelector(".browse-placeholder")?.remove();
    img.classList.add("loaded");
  };
  img.onerror = () => {
    img.remove();
    setBrowsePlaceholder(imgWrap, onError ? "Ersatzfoto wird geladen …" : "Kein Foto verfügbar");
    if (onError) onError();
  };
  imgWrap.appendChild(img);
  img.src = url;
}

function setBrowseActionLabel(button, label) {
  button.setAttribute("aria-label", label);
  button.title = label;
}

function addBrowsePhotoActions(card, item) {
  if (card.querySelector(".browse-image-tools")) return;
  const tools = document.createElement("div");
  tools.className = "browse-image-tools";
  tools.setAttribute("aria-label", "Bildsteuerung");

  const change = document.createElement("button");
  change.type = "button";
  change.className = "browse-image-tool";
  change.innerHTML = '<span aria-hidden="true">↻</span>';
  setBrowseActionLabel(change, card._photo?.variants?.length > 1 ? "Nächste Ansicht" : "Anderes Foto");
  change.addEventListener("click", async event => {
    event.stopPropagation();
    if (change.disabled) return;
    change.disabled = true;
    const imgWrap = card.querySelector(".browse-card-img");
    const photo = card._photo;
    if (photo?.variants && photo.variantIndex < photo.variants.length - 1) {
      photo.variantIndex++;
      const next = photo.variants[photo.variantIndex];
      showBrowseImg(imgWrap, next.url, item.german, () => recoverBrowseCardImage(card, item, Number(card.dataset.generation)));
      setBrowseActionLabel(change, photo.variantIndex < photo.variants.length - 1 ? "Nächste Ansicht" : "Anderes Foto");
      change.disabled = false;
      return;
    }
    try {
      const fresh = await fetchPhoto(item, "high");
      if (!card.isConnected) return;
      card._photo = fresh;
      browsePhotoCache.set(item.id, fresh);
      showBrowseImg(imgWrap, fresh.url, item.german, () => recoverBrowseCardImage(card, item, Number(card.dataset.generation)));
      setBrowseActionLabel(change, fresh.variants?.length > 1 ? "Nächste Ansicht" : "Anderes Foto");
    } catch {
      if (card.isConnected) setBrowseActionLabel(change, "Noch einmal versuchen");
    } finally {
      if (card.isConnected) change.disabled = false;
    }
  });

  const expand = document.createElement("button");
  expand.type = "button";
  expand.className = "browse-image-tool";
  expand.innerHTML = '<span aria-hidden="true">⛶</span>';
  setBrowseActionLabel(expand, "Bild vergrößern");
  const open = () => {
    const photo = card._photo;
    const current = photo?.variants?.[photo.variantIndex] || photo;
    openImageViewer({ url: current?.url, alt: item.german, credit: current?.credit, link: photo?.link });
  };
  expand.addEventListener("click", event => { event.stopPropagation(); open(); });
  card.querySelector(".browse-card-img").addEventListener("click", event => {
    if (!event.target.closest("button")) open();
  });
  tools.append(change, expand);
  card.querySelector(".browse-card-img").appendChild(tools);
}

function resetBrowse() {
  browseGeneration++;
  // stale requests can finish, dont block fresh results
  browseImageActive = 0;
  browseImageQueue = [];
  browseOffset = 0;
  browseObserver?.disconnect();
  browseObserver = null;
  elements.browseGrid.replaceChildren();
  renderBrowsePage();
}

function initBrowse() {
  elements.browseBack.addEventListener("click", () => showView("setup"));
  elements.browseSearch.addEventListener("input", () => {
    window.clearTimeout(browseSearchTimer);
    browseSearchTimer = window.setTimeout(() => {
      browseSearch = elements.browseSearch.value.trim();
      resetBrowse();
    }, 180);
  });
  elements.browseMore.addEventListener("click", renderBrowsePage);
  for (const btn of elements.browseGrid.parentElement.querySelectorAll(".browse-filter")) {
    btn.addEventListener("click", () => {
      for (const b of btn.parentElement.children) b.classList.remove("active");
      btn.classList.add("active");
      browseFilter = btn.dataset.filter;
      resetBrowse();
    });
  }
  // reset browse when opening via setup button
  elements.browseButton.addEventListener("click", () => {
    showView("browse");
    resetBrowse();
  });
}

// ─── Stats view ───

function renderStats() {
  const values = SPECIES.map(getStat);
  const seen = values.filter(s => s.seen > 0).length;
  const mastered = values.filter(s => s.level >= 3).length;
  const due = values.filter(s => s.mistake).length;
  const totalCorrect = values.reduce((sum, s) => sum + s.correct, 0);
  const totalAnswers = values.reduce((sum, s) => sum + s.seen, 0);
  const accuracy = totalAnswers ? Math.round(totalCorrect / totalAnswers * 100) : 0;

  elements.statTotal.textContent = seen;
  elements.statMastered.textContent = mastered;
  elements.statDue.textContent = due;
  elements.statAccuracy.textContent = `${accuracy} %`;

  if (state.streak.count > 1) {
    elements.statStreak.hidden = false;
    elements.statStreak.innerHTML = `<strong>${state.streak.count} Tage</strong> in Folge gelernt — weiter so!`;
  } else {
    elements.statStreak.hidden = true;
  }

  // weakest species: seen > 0, sorted by level asc then wrong desc
  const weakest = SPECIES
    .map(item => ({ item, stat: getStat(item) }))
    .filter(({ stat }) => stat.seen > 0)
    .sort((a, b) => a.stat.level - b.stat.level || b.stat.wrong - a.stat.wrong)
    .slice(0, 10);

  elements.weakestList.replaceChildren(...weakest.map(({ item, stat }) => {
    const li = document.createElement("li");
    li.innerHTML = `<div><strong>${escapeHtml(item.german)}</strong><em>${escapeHtml(item.latin)}</em></div><span class="weak-level">Lv ${stat.level} · ${stat.wrong}f</span>`;
    return li;
  }));

  const rows = SPECIES.map(item => ({ item, stat: getStat(item) }));
  const value = row => statsSort.key === "name" ? row.item.german :
    statsSort.key === "level" ? (row.stat.seen ? row.stat.level : -1) : row.stat[statsSort.key];
  rows.sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    const result = typeof av === "string" ? av.localeCompare(bv, "de") : av - bv;
    return result * statsSort.direction || a.item.german.localeCompare(b.item.german, "de");
  });
  updateStatsSortHeaders();

  elements.statsTbody.replaceChildren(...rows.map(({ item, stat }) => {
    const tr = document.createElement("tr");
    if (stat.marked) tr.classList.add("marked");
    tr.innerHTML = `<td><strong>${escapeHtml(item.german)}</strong><em>${escapeHtml(item.latin)}</em></td><td>${stat.seen === 0 ? "—" : stat.level}</td><td>${stat.seen}</td><td>${stat.correct}</td><td>${stat.wrong}</td>`;
    return tr;
  }));
}

function updateStatsSortHeaders() {
  elements.statsView.querySelectorAll("th button[data-sort]").forEach(button => {
    const active = button.dataset.sort === statsSort.key;
    button.querySelector("span").textContent = active ? (statsSort.direction === 1 ? "↑" : "↓") : "";
    const th = button.closest("th");
    if (active) th.setAttribute("aria-sort", statsSort.direction === 1 ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  });
}

function initStats() {
  elements.statsBack.addEventListener("click", () => showView("setup"));
  elements.statsButton.addEventListener("click", () => {
    showView("stats");
    renderStats();
  });
  elements.statsView.querySelectorAll("th button[data-sort]").forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.sort;
    statsSort = { key, direction: statsSort.key === key ? -statsSort.direction : key === "name" ? 1 : -1 };
    renderStats();
  }));
}

// init on load
initBrowse();
initStats();
