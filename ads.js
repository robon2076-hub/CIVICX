(() => {
  const METRICS_KEY = "civicx-ad-metrics-v2";
  const LAST_AD_KEY = "civicx-last-ad-v2";
  const SESSION_LAST_AD_KEY = "civicx-session-last-ad-v2";
  const DISMISSED_PREFIX = "civicx-dismissed-ad-v2:";
  const allowedTypes = new Set(["image", "video"]);
  const slotNames = ["desktop-left", "desktop-right"];
  const pageName = window.location.pathname.split("/").pop() || "index.html";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let ads = [];
  let configurationError = null;
  let observer = null;

  function readMetrics() {
    try {
      const value = JSON.parse(localStorage.getItem(METRICS_KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (error) {
      return {};
    }
  }

  function writeMetric(adId, kind) {
    const metrics = readMetrics();
    const entry = metrics[adId] && typeof metrics[adId] === "object"
      ? metrics[adId]
      : { impressions: 0, clicks: 0 };
    entry[kind] = Number.isFinite(entry[kind]) ? entry[kind] + 1 : 1;
    metrics[adId] = entry;
    localStorage.setItem(METRICS_KEY, JSON.stringify(metrics));
    document.dispatchEvent(new CustomEvent("civicx:ad-metrics-updated"));
  }

  function safeLink(value) {
    try {
      const url = new URL(value, window.location.href);
      return ["https:", "http:"].includes(url.protocol) ? url.href : null;
    } catch (error) {
      return null;
    }
  }

  function safeAsset(value) {
    if (typeof value !== "string" || !value.trim() || /(^|[\\/])\.\.([\\/]|$)/.test(value)) return false;
    try {
      const url = new URL(value, window.location.href);
      return ["https:", "http:"].includes(url.protocol);
    } catch (error) {
      return false;
    }
  }

  function validAd(ad) {
    return ad && typeof ad.id === "string" && ad.id.trim() &&
      typeof ad.brand === "string" && ad.brand.trim() &&
      allowedTypes.has(ad.type) && safeAsset(ad.file) &&
      safeLink(ad.link) && typeof ad.headline === "string" &&
      Number.isFinite(Date.parse(`${ad.startDate}T00:00:00Z`)) &&
      Number.isFinite(Date.parse(`${ad.endDate}T23:59:59Z`)) && ad.startDate <= ad.endDate &&
      typeof ad.enabled === "boolean" && Number.isFinite(ad.weight) && ad.weight > 0;
  }

  function activeAds() {
    const today = new Date().toISOString().slice(0, 10);
    return ads.filter((ad) => ad.enabled && ad.startDate <= today && ad.endDate >= today);
  }

  function weightedChoice(candidates) {
    const total = candidates.reduce((sum, ad) => sum + ad.weight, 0);
    let remaining = Math.random() * total;
    for (const ad of candidates) {
      remaining -= ad.weight;
      if (remaining < 0) return ad;
    }
    return candidates[candidates.length - 1];
  }

  function selectAd(excludedIds = new Set()) {
    const eligible = activeAds();
    const available = eligible.filter((ad) => !excludedIds.has(ad.id));
    if (!available.length) return null;
    const previousId = sessionStorage.getItem(SESSION_LAST_AD_KEY) || localStorage.getItem(LAST_AD_KEY);
    const candidates = available.length > 1 ? available.filter((ad) => ad.id !== previousId) : available;
    const selected = weightedChoice(candidates);
    sessionStorage.setItem(SESSION_LAST_AD_KEY, selected.id);
    localStorage.setItem(LAST_AD_KEY, selected.id);
    return selected;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function creative(ad) {
    const url = safeLink(ad.link);
    const file = escapeHtml(ad.file);
    const brand = escapeHtml(ad.brand);
    const headline = escapeHtml(ad.headline);
    const media = ad.type === "video"
      ? `<video class="ad-creative" src="${file}" muted playsinline preload="none" aria-label="${brand} sponsored video"></video><button class="ad-mute" type="button" aria-label="Unmute video">Muted</button>`
      : `<img class="ad-creative" src="${file}" alt="" loading="lazy" decoding="async">`;
    return `<article class="ad-card" data-ad-id="${escapeHtml(ad.id)}">
      <button class="ad-close" type="button" aria-label="Close sponsored content">×</button>
      ${media}
      <div class="ad-copy"><span class="ad-label">Sponsored</span><span class="ad-brand">${brand}</span><a class="ad-headline" href="${url}" target="_blank" rel="noopener noreferrer sponsored">${headline} ↗</a></div>
    </article>`;
  }

  function visibleEnough(element) {
    if (!element.isConnected || element.closest("[hidden]")) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" &&
      rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.top < window.innerHeight;
  }

  function setupVideo(card) {
    const video = card.querySelector("video");
    const mute = card.querySelector(".ad-mute");
    if (!video || !mute) return;
    mute.addEventListener("click", () => {
      video.muted = !video.muted;
      mute.textContent = video.muted ? "Muted" : "Sound on";
      mute.setAttribute("aria-label", video.muted ? "Unmute video" : "Mute video");
    });
    if (reducedMotion || typeof IntersectionObserver !== "function") return;
    const videoObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && visibleEnough(card)) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.6 });
    videoObserver.observe(card);
    card.addEventListener("civicx:ad-dismiss", () => {
      video.pause();
      videoObserver.disconnect();
    }, { once: true });
  }

  function render() {
    const slots = slotNames.map((name) => document.querySelector(`[data-ad-slot="${name}"]`)).filter(Boolean);
    if (!window.CivicXAdPolicy?.canRenderAdSlots(slots.length) || !slots.length) return;
    if (!(window.location.pathname === "/" || window.location.pathname.endsWith("/index.html") || (window.CivicXAdConfig?.allowedPages || []).includes(pageName))) {
      slots.forEach((slot) => { slot.hidden = true; slot.replaceChildren(); });
      return;
    }
    if (sessionStorage.getItem(`${DISMISSED_PREFIX}${pageName}`) === "true") {
      slots.forEach((slot) => { slot.hidden = true; slot.replaceChildren(); });
      return;
    }
    const adsOutsideSlots = Array.from(document.querySelectorAll(".ad-card"))
      .filter((card) => !card.closest("[data-ad-slot]")).length;
    if (!window.CivicXAdPolicy.canRenderAdSlots(slots.length + adsOutsideSlots)) {
      slots.forEach((slot) => { slot.hidden = true; slot.replaceChildren(); });
      return;
    }
    const selectedIds = new Set();
    slots.forEach((slot) => {
      const ad = selectAd(selectedIds);
      if (!ad) {
        slot.hidden = true;
        slot.replaceChildren();
        return;
      }
      selectedIds.add(ad.id);
      slot.innerHTML = creative(ad);
      slot.hidden = false;
      const card = slot.querySelector(".ad-card");
      const close = card.querySelector(".ad-close");
      close.addEventListener("click", () => {
        sessionStorage.setItem(`${DISMISSED_PREFIX}${pageName}`, "true");
        card.dispatchEvent(new Event("civicx:ad-dismiss"));
        slots.forEach((item) => { item.hidden = true; item.replaceChildren(); });
      });
      card.querySelector("a").addEventListener("click", () => writeMetric(ad.id, "clicks"));
      setupVideo(card);
    });
    slots.forEach((slot) => observeImpression(slot.querySelector(".ad-card")));
    if (typeof IntersectionObserver !== "function") {
      window.setTimeout(() => {
        const nowVisible = slots.find(visibleEnough);
        if (nowVisible) recordImpression(nowVisible.querySelector(".ad-card"));
      }, 0);
    }
  }

  function recordImpression(card) {
    if (!card || card.dataset.impression === "recorded") return;
    card.dataset.impression = "recorded";
    writeMetric(card.dataset.adId, "impressions");
  }

  function observeImpression(card) {
    if (!card) return;
    if (typeof IntersectionObserver !== "function") {
      recordImpression(card);
      return;
    }
    observer ||= new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && visibleEnough(entry.target)) {
          recordImpression(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    observer.observe(card);
  }

  async function load() {
    try {
      const [configResponse, policyResponse] = await Promise.all([
        fetch("ads.config.json", { cache: "no-store" }),
        Promise.resolve(window.CivicXAdPolicy)
      ]);
      if (!configResponse.ok || !policyResponse) return;
      const config = await configResponse.json();
      if (!config || !Array.isArray(config.ads) || !Array.isArray(config.allowedPages)) {
        throw new Error("ads.config.json must contain allowedPages and ads arrays.");
      }
      const seen = new Set();
      ads = config.ads.filter((ad) => {
        if (!validAd(ad) || seen.has(ad.id)) return false;
        seen.add(ad.id);
        return true;
      });
      if (ads.length !== config.ads.length) throw new Error("ads.config.json contains an invalid or duplicate ad.");
      window.CivicXAdConfig = { allowedPages: config.allowedPages };
      render();
      document.dispatchEvent(new CustomEvent("civicx:ads-ready"));
    } catch (error) {
      configurationError = error.message || "Ad configuration could not be loaded.";
      document.dispatchEvent(new CustomEvent("civicx:ads-error"));
    }
  }

  window.CivicXAds = {
    getAds: () => ads.map((ad) => ({ ...ad })),
    getMetrics: () => readMetrics(),
    getConfigurationError: () => configurationError
  };
  load();
})();
