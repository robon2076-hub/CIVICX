(() => {
  const DEFAULT_CENTER = [22.5726, 88.3639];
  const COMMUNITY_CROSSPOST_ENABLED = true;
  const guestMode = new URLSearchParams(window.location.search).get("guest") === "1";
  const elements = {
    accountCaption: document.getElementById("account-caption"),
    accountName: document.getElementById("account-name"),
    reportsStatus: document.getElementById("reports-status"),
    reportsEmpty: document.getElementById("reports-empty"),
    reportsEmptyTitle: document.getElementById("reports-empty-title"),
    reportsEmptyCopy: document.getElementById("reports-empty-copy"),
    reportList: document.getElementById("report-list"),
    total: document.getElementById("summary-total"),
    pending: document.getElementById("summary-pending"),
    underReview: document.getElementById("summary-under-review"),
    resolved: document.getElementById("summary-resolved"),
    unresolved: document.getElementById("summary-unresolved"),
    disputed: document.getElementById("summary-disputed"),
    reopened: document.getElementById("summary-reopened"),
    aiWidget: document.getElementById("dashboard-floating-ai"),
    map: document.getElementById("dashboard-map"),
    mapCaption: document.getElementById("map-caption"),
    publicMapLegend: document.getElementById("public-map-legend"),
    publicMapStatus: document.getElementById("public-map-status"),
    mapRegion: document.getElementById("map-region-select"),
    detectMapRegion: document.getElementById("detect-map-region"),
    reportDialog: document.getElementById("report-dialog"),
    reportForm: document.getElementById("report-form"),
    reportError: document.getElementById("report-error"),
    reportCity: document.getElementById("report-city"),
    saveReport: document.getElementById("save-report"),
    latitude: document.getElementById("report-latitude"),
    longitude: document.getElementById("report-longitude"),
    selectedCoordinate: document.getElementById("selected-coordinate"),
    reportPhoto: document.getElementById("report-photo"),
    reportPhotoPreview: document.getElementById("report-photo-preview"),
    reportPhotoThumbnail: document.getElementById("report-photo-thumbnail"),
    reportPhotoStatus: document.getElementById("report-photo-status"),
    removeReportPhoto: document.getElementById("remove-report-photo"),
    communityChoice: document.getElementById("report-community-choice"),
    communityAvailability: document.getElementById("report-community-availability"),
    communityFields: document.getElementById("report-community-fields"),
    communityCategory: document.getElementById("report-community-category"),
    communityProfileFields: document.getElementById("report-community-profile-fields"),
    communityDisplayName: document.getElementById("report-community-display-name"),
    communityLocality: document.getElementById("report-community-locality"),
    communityProfileStatus: document.getElementById("report-community-profile-status"),
    communityPublicNotice: document.getElementById("report-community-public-notice")
  };
  let map = null;
  let reportMarkers = null;
  let publicMarkers = null;
  let publicMapAbortController = null;
  let publicMapReloadTimer = null;
  let publicMapRequestVersion = 0;
  let publicMapChannel = null;
  let publicMapChannelClient = null;
  let selectionMarker = null;
  let selectingLocation = false;
  let requestVersion = 0;
  let jurisdictions = [];
  let reportPhoto = null;
  let photoPreparing = false;
  let reportChannel = null;
  let reportChannelClient = null;
  let reportChannelUserId = null;
  let reports = [];
  let communityProfile = null;
  let communityProfileLoaded = false;
  let communityProfileLoading = false;
  let communityProfileError = false;
  let communityCategoryChanged = false;
  let pendingCrosspostReportId = "";
  let savingReport = false;
  const publicMapCategoryIcons = Object.freeze({
    "Road and Infrastructure": "⌁",
    "Garbage and Sanitation": "♲",
    "Water and Drainage": "≋",
    "Pollution and Environment": "♧",
    "Public Safety": "⚠",
    "Government Services": "▦",
    "General Civic Discussions": "◉",
    "Suggestions and Solutions": "✦"
  });

  const imagePrivacyReady = new Promise((resolve, reject) => {
    if (window.CivicXImagePrivacy) {
      resolve(window.CivicXImagePrivacy);
      return;
    }
    const timeout = window.setTimeout(
      () => reject(new Error("Local photo privacy tools did not start. No photo was uploaded.")),
      20000
    );
    window.addEventListener("civicx-image-privacy-ready", () => {
      window.clearTimeout(timeout);
      resolve(window.CivicXImagePrivacy);
    }, { once: true });
  });

  function initializeMap() {
    if (!window.L) {
      elements.mapCaption.textContent = "The map library did not load, so public report pins cannot be displayed.";
      elements.publicMapStatus.textContent = "Map unavailable. Refresh the page to try again.";
      return;
    }
    map = window.L.map(elements.map, { scrollWheelZoom: false }).setView(DEFAULT_CENTER, 12);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    reportMarkers = window.L.layerGroup().addTo(map);
    publicMarkers = window.L.layerGroup().addTo(map);
    renderPublicMapLegend();
    map.on("moveend", () => schedulePublicMapReload());
    map.on("click", (event) => {
      if (!selectingLocation) return;
      selectingLocation = false;
      map.getContainer().style.cursor = "";
      setCoordinates(event.latlng.lat, event.latlng.lng);
      elements.mapCaption.textContent = "Location selected. Your saved report pins remain private; Community-linked public pins are visible to everyone.";
      if (!elements.reportDialog.open) elements.reportDialog.showModal();
    });
    schedulePublicMapReload(0);
  }

  function setCoordinates(latitude, longitude) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new Error("Choose a valid point on the map.");
    }
    elements.latitude.value = String(lat);
    elements.longitude.value = String(lng);
    elements.selectedCoordinate.textContent = `Pinned at ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (map) {
      if (selectionMarker) selectionMarker.remove();
      selectionMarker = window.L.marker([lat, lng]).addTo(map);
      map.setView([lat, lng], Math.max(map.getZoom(), 14));
    }
  }

  function renderMarkers(items) {
    if (!map || !reportMarkers) return;
    reportMarkers.clearLayers();
    items.forEach((report) => {
      if (!Array.isArray(report.coordinates) || report.coordinates.length !== 2 ||
          !report.coordinates.every(Number.isFinite)) return;
      const marker = window.L.marker(report.coordinates);
      const popup = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = report.title;
      const status = document.createElement("p");
      status.textContent = report.status;
      popup.append(title, status);
      marker.bindPopup(popup).addTo(reportMarkers);
    });
  }

  function publicMapCategoryIcon(category) {
    const categories = window.CivicXCommunityPosts?.categories || [];
    const index = categories.indexOf(category);
    return publicMapCategoryIcons[category] || (index >= 0 ? String(index + 1) : "•");
  }

  function renderPublicMapLegend() {
    if (!elements.publicMapLegend) return;
    const categories = window.CivicXCommunityPosts?.categories || [];
    const items = categories.map((category) => {
      const item = document.createElement("span");
      item.className = "public-map-legend-item";
      const icon = document.createElement("span");
      icon.className = "public-map-legend-pin";
      icon.setAttribute("aria-hidden", "true");
      const glyph = document.createElement("span");
      glyph.textContent = publicMapCategoryIcon(category);
      icon.append(glyph);
      const label = document.createElement("span");
      label.textContent = category;
      item.append(icon, label);
      return item;
    });
    elements.publicMapLegend.replaceChildren(...items);
  }

  function clusterPublicReports(items) {
    const radius = 48;
    const parents = items.map((item, index) => index);
    const points = items.map((item) => map.latLngToLayerPoint([item.latitude, item.longitude]));
    const find = (index) => {
      if (parents[index] !== index) parents[index] = find(parents[index]);
      return parents[index];
    };
    const union = (first, second) => {
      const firstRoot = find(first);
      const secondRoot = find(second);
      if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot;
    };
    const cells = new Map();
    points.forEach((point, index) => {
      const cellX = Math.floor(point.x / radius);
      const cellY = Math.floor(point.y / radius);
      for (let x = cellX - 1; x <= cellX + 1; x += 1) {
        for (let y = cellY - 1; y <= cellY + 1; y += 1) {
          const neighbors = cells.get(`${x}:${y}`) || [];
          neighbors.forEach((neighbor) => {
            const dx = point.x - points[neighbor].x;
            const dy = point.y - points[neighbor].y;
            if (dx * dx + dy * dy <= radius * radius) union(index, neighbor);
          });
        }
      }
      const key = `${cellX}:${cellY}`;
      const cell = cells.get(key) || [];
      cell.push(index);
      cells.set(key, cell);
    });

    const groups = new Map();
    items.forEach((item, index) => {
      const rootIndex = find(index);
      const group = groups.get(rootIndex) || [];
      group.push(item);
      groups.set(rootIndex, group);
    });
    return [...groups.values()];
  }

  function publicMapPopup(report) {
    const postId = encodeURIComponent(report.communityPostId);
    const location = [report.locality, report.city].filter(Boolean).join(", ");
    const reportDate = new Date(report.date);
    const dateLabel = Number.isNaN(reportDate.getTime())
      ? "Date not available"
      : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(reportDate);
    const description = String(report.description || "").trim();
    const shortDescription = description.length > 360 ? `${description.slice(0, 357)}…` : description;
    const photo = report.hasPhoto
      ? `<img class="public-map-popup-photo" src="/api/public/map-reports/${postId}/photo" alt="Photo shared with this Community report" loading="lazy">`
      : "";
    return `<article class="public-map-popup">
      <strong class="public-map-popup-category">${escapeHtml(report.category)}</strong>
      <p class="public-map-popup-description">${escapeHtml(shortDescription)}</p>
      <p class="public-map-popup-meta">${escapeHtml(location)}</p>
      <p class="public-map-popup-meta">Status: ${escapeHtml(report.status)}</p>
      <p class="public-map-popup-meta">Date: ${escapeHtml(dateLabel)}</p>
      <p class="public-map-popup-meta">Community name: ${escapeHtml(report.displayName)}</p>
      ${photo}
      <a class="public-map-popup-link" href="community.html?post=${postId}#community-post-${postId}">Open Community post</a>
    </article>`;
  }

  function publicMapMarker(report) {
    const marker = window.L.marker([report.latitude, report.longitude], {
      icon: window.L.divIcon({
        className: "public-map-marker-container",
        html: `<span class="cx-public-map-pin" aria-hidden="true"><span>${escapeHtml(publicMapCategoryIcon(report.category))}</span></span>`,
        iconSize: [34, 40],
        iconAnchor: [17, 38],
        popupAnchor: [0, -36]
      }),
      title: `${report.category} · ${report.locality}, ${report.city}`
    });
    marker.bindPopup(publicMapPopup(report), { maxWidth: 280, minWidth: 220 });
    return marker;
  }

  function renderPublicMarkers(items) {
    if (!map || !publicMarkers) return;
    publicMarkers.clearLayers();
    const validReports = items.filter((report) =>
      Number.isFinite(report.latitude) && report.latitude >= -90 && report.latitude <= 90 &&
      Number.isFinite(report.longitude) && report.longitude >= -180 && report.longitude <= 180 &&
      typeof report.communityPostId === "string"
    );
    clusterPublicReports(validReports).forEach((group) => {
      if (group.length === 1) {
        publicMapMarker(group[0]).addTo(publicMarkers);
        return;
      }
      const locations = group.map((report) => [report.latitude, report.longitude]);
      const cluster = window.L.marker(window.L.latLngBounds(locations).getCenter(), {
        icon: window.L.divIcon({
          className: "public-map-cluster-container",
          html: `<span class="public-map-cluster" aria-label="${group.length} public reports">${group.length}</span>`,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        }),
        title: `${group.length} public reports; zoom in to separate pins`
      });
      const links = group.slice(0, 8).map((report) => {
        const postId = encodeURIComponent(report.communityPostId);
        const label = `${report.category} · ${report.locality}, ${report.city}`;
        return `<li><a href="community.html?post=${postId}#community-post-${postId}">${escapeHtml(label)}</a></li>`;
      }).join("");
      const remaining = group.length > 8 ? `<p>And ${group.length - 8} more reports.</p>` : "";
      cluster.bindPopup(`<strong>${group.length} public reports</strong><p>Zoom in to separate pins, or open a Community post:</p><ul>${links}</ul>${remaining}`);
      cluster.on("click", () => {
        const bounds = window.L.latLngBounds(locations);
        if (!bounds.isValid()) return;
        const southWest = bounds.getSouthWest();
        const northEast = bounds.getNorthEast();
        if (southWest.equals(northEast)) {
          map.setView(bounds.getCenter(), Math.min(map.getZoom() + 3, 19));
          return;
        }
        map.fitBounds(bounds.pad(0.25), { maxZoom: Math.min(map.getZoom() + 3, 19) });
      });
      cluster.addTo(publicMarkers);
    });
  }

  function schedulePublicMapReload(delay = 250) {
    if (!map) return;
    window.clearTimeout(publicMapReloadTimer);
    publicMapReloadTimer = window.setTimeout(() => { void loadPublicMapReports(); }, delay);
  }

  async function loadPublicMapReports() {
    if (!map || !publicMarkers) return;
    if (publicMapAbortController) publicMapAbortController.abort();
    const controller = new AbortController();
    publicMapAbortController = controller;
    const version = ++publicMapRequestVersion;
    const bounds = map.getBounds();
    const longitudeSpan = bounds.getEast() - bounds.getWest();
    const normalizeLongitude = (value) => ((value + 180) % 360 + 360) % 360 - 180;
    const query = new URLSearchParams({
      south: String(Math.max(-90, bounds.getSouth())),
      north: String(Math.min(90, bounds.getNorth())),
      west: String(longitudeSpan >= 360 ? -180 : normalizeLongitude(bounds.getWest())),
      east: String(longitudeSpan >= 360 ? 180 : normalizeLongitude(bounds.getEast()))
    });
    elements.publicMapStatus.textContent = "Loading public report pins for this map area…";
    try {
      const response = await fetch(`/api/public/map-reports?${query}`, {
        cache: "no-store",
        signal: controller.signal
      });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : null;
      if (response.status === 404 || !contentType.includes("application/json") || !payload) {
        const error = new Error("Public report pins need the CIVICX server.");
        error.serverUnavailable = true;
        throw error;
      }
      if (!response.ok || payload.ok !== true || !Array.isArray(payload.result?.reports)) {
        throw new Error(payload.error || "Public report pins could not be loaded.");
      }
      if (version !== publicMapRequestVersion) return;
      renderPublicMarkers(payload.result.reports);
      const count = payload.result.reports.length;
      elements.publicMapStatus.textContent = count
        ? `${count} public Community-linked report pin${count === 1 ? "" : "s"} in this map area.`
        : "No public Community-linked reports are visible in this map area.";
    } catch (error) {
      if (error.name === "AbortError" || version !== publicMapRequestVersion) return;
      console.error("[CivicX dashboard] Public report pins could not be loaded", {
        message: error.message || "UNKNOWN"
      });
      elements.publicMapStatus.textContent = error.serverUnavailable || error instanceof TypeError
        ? "Public report pins need the CIVICX server. You can still explore the map."
        : "Public report pins could not be loaded. Check the connection and database migration, then retry.";
    } finally {
      if (publicMapAbortController === controller) publicMapAbortController = null;
    }
  }

  function syncPublicMapChannel(state) {
    const client = state?.client;
    if (!client || typeof client.channel !== "function") {
      if (publicMapChannel && publicMapChannelClient) {
        void publicMapChannelClient.removeChannel(publicMapChannel);
      }
      publicMapChannel = null;
      publicMapChannelClient = null;
      return;
    }
    if (publicMapChannel && publicMapChannelClient === client) return;
    if (publicMapChannel && publicMapChannelClient) {
      void publicMapChannelClient.removeChannel(publicMapChannel);
    }
    publicMapChannelClient = client;
    publicMapChannel = client.channel("civicx-public-map-reports")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "community_posts"
      }, (change) => {
        if (change.new?.visibility === "published" || change.old?.visibility === "published") {
          schedulePublicMapReload();
        }
      })
      .subscribe();
  }

  function populateJurisdictionSelect(select) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.textContent = "Choose a registered jurisdiction";
    select.replaceChildren(placeholder);
    jurisdictions.forEach((jurisdiction) => {
      const option = document.createElement("option");
      option.value = jurisdiction.jurisdictionKey;
      option.textContent = jurisdiction.displayName;
      select.append(option);
    });
  }

  function selectedJurisdiction() {
    const key = elements.reportCity.value;
    return jurisdictions.find((jurisdiction) => jurisdiction.jurisdictionKey === key) || null;
  }

  function initializeCommunityCrosspost() {
    const community = window.CivicXCommunityPosts;
    const categoryPlaceholder = document.createElement("option");
    categoryPlaceholder.value = "";
    categoryPlaceholder.disabled = true;
    categoryPlaceholder.selected = true;
    categoryPlaceholder.textContent = "Choose a Community category";
    elements.communityCategory.replaceChildren(categoryPlaceholder);
    community.categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      elements.communityCategory.append(option);
    });

    const yesOption = elements.communityChoice.querySelector('option[value="yes"]');
    yesOption.disabled = !COMMUNITY_CROSSPOST_ENABLED;
    elements.communityAvailability.hidden = COMMUNITY_CROSSPOST_ENABLED;
    elements.communityAvailability.textContent = COMMUNITY_CROSSPOST_ENABLED
      ? ""
      : "Community cross-posting is disabled until the new database migration has been applied and confirmed.";

    elements.communityChoice.addEventListener("change", () => {
      if (elements.communityChoice.value === "yes" && !COMMUNITY_CROSSPOST_ENABLED) {
        elements.communityChoice.value = "no";
        return;
      }
      if (elements.communityChoice.value === "yes" && communityProfileError) {
        communityProfileError = false;
        communityProfileLoaded = false;
      }
      updateCommunityCrosspostFields();
    });
    elements.communityCategory.addEventListener("change", () => {
      communityCategoryChanged = true;
    });
    document.getElementById("report-category").addEventListener("change", () => {
      if (elements.communityChoice.value === "yes" && !communityCategoryChanged) {
        elements.communityCategory.value = community.defaultCategoryForReport(
          document.getElementById("report-category").value
        );
      }
    });
    updateCommunityCrosspostFields();
  }

  function updateCommunityCrosspostFields() {
    const selected = elements.communityChoice.value === "yes" && COMMUNITY_CROSSPOST_ENABLED;
    const needsProfileInput = selected && communityProfileLoaded && !communityProfile && !communityProfileError;
    elements.communityFields.hidden = !selected;
    elements.communityPublicNotice.hidden = !selected;
    elements.communityCategory.required = selected;
    elements.communityProfileFields.hidden = !selected || communityProfileLoading || Boolean(communityProfile);
    elements.communityDisplayName.required = needsProfileInput;
    elements.communityLocality.required = needsProfileInput;
    if (!selected) {
      elements.communityProfileStatus.textContent = "";
      return;
    }

    if (!communityCategoryChanged) {
      elements.communityCategory.value = window.CivicXCommunityPosts.defaultCategoryForReport(
        document.getElementById("report-category").value
      );
    }
    if (communityProfileLoading) {
      elements.communityProfileStatus.textContent = "Checking your saved Community profile…";
    } else if (communityProfileError) {
      elements.communityProfileStatus.textContent =
        "Your Community profile could not be loaded. Select No, then Yes to retry before submitting.";
    } else if (communityProfile) {
      elements.communityProfileStatus.textContent =
        "Using your saved Community display name and broad locality. The selected report city will be used.";
    } else if (communityProfileLoaded) {
      elements.communityProfileStatus.textContent =
        "Add a display name and broad locality. They will be saved only if the report and post both succeed.";
    }
    if (!communityProfileLoaded && !communityProfileLoading && !communityProfileError) {
      void loadCommunityProfile();
    }
  }

  async function loadCommunityProfile() {
    const client = window.CivicXAuth.client;
    const user = window.CivicXAuth.user;
    if (!client || !user) {
      communityProfileError = true;
      updateCommunityCrosspostFields();
      return;
    }
    communityProfileLoading = true;
    updateCommunityCrosspostFields();
    try {
      const { data, error } = await client.from("community_profiles")
        .select("display_name,city,locality")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      communityProfile = data || null;
      communityProfileLoaded = true;
      communityProfileError = false;
      elements.communityDisplayName.value = communityProfile?.display_name || "";
      elements.communityLocality.value = communityProfile?.locality || "";
    } catch (error) {
      communityProfileError = true;
      console.error("[CivicX dashboard] Community profile could not be loaded", {
        code: error.code || "UNKNOWN"
      });
    } finally {
      communityProfileLoading = false;
      updateCommunityCrosspostFields();
    }
  }

  function selectJurisdiction(key, centerMap = true) {
    const jurisdiction = jurisdictions.find((item) => item.jurisdictionKey === key);
    if (!jurisdiction) return false;
    elements.reportCity.value = jurisdiction.jurisdictionKey;
    elements.mapRegion.value = jurisdiction.jurisdictionKey;
    if (centerMap && map) {
      const center = window.CivicXJurisdictions.getCenter(jurisdiction);
      if (!center) {
        elements.mapCaption.textContent = `${jurisdiction.displayName} is registered, but its map center is not configured.`;
        return false;
      }
      map.setView(center, 12);
      elements.mapCaption.textContent = `Map centered on ${jurisdiction.displayName}. Community-linked pins are public; your own private report pins remain visible only to you.`;
    }
    return true;
  }

  async function loadJurisdictions() {
    try {
      const response = await fetch("/api/jurisdictions", { cache: "no-store" });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : null;
      if (response.status === 404 || !contentType.includes("application/json") || !payload) {
        const error = new Error("Registered city options need the CIVICX server.");
        error.serverUnavailable = true;
        throw error;
      }
      if (!response.ok || payload.ok !== true || !Array.isArray(payload.result?.jurisdictions)) {
        throw new Error(payload.error || "Registered city options could not be loaded.");
      }
      jurisdictions = payload.result.jurisdictions.filter((item) =>
        item && typeof item.jurisdictionKey === "string" &&
        typeof item.displayName === "string" && item.displayName.trim()
      );
      if (!jurisdictions.length) throw new Error("No active CivicX jurisdictions are registered yet.");
      populateJurisdictionSelect(elements.mapRegion);
      populateJurisdictionSelect(elements.reportCity);
      const preferred = window.CivicXJurisdictions.defaultJurisdiction(jurisdictions);
      if (preferred) selectJurisdiction(preferred.jurisdictionKey);
    } catch (error) {
      console.error("[CivicX dashboard] Jurisdictions could not be loaded", {
        message: error.message || "UNKNOWN"
      });
      elements.mapRegion.replaceChildren(new Option("Regions unavailable", ""));
      elements.reportCity.replaceChildren(new Option("Registered regions unavailable", ""));
      elements.mapCaption.textContent = error.serverUnavailable || error instanceof TypeError
        ? "Registered city selection needs the CIVICX server. You can still explore the map."
        : "Registered city selection is unavailable. Check the CivicX database migration and server configuration.";
    }
  }

  function syncReportChannel(state) {
    if (!state.user || !state.client || !state.reportsReady) {
      if (reportChannel && reportChannelClient) void reportChannelClient.removeChannel(reportChannel);
      reportChannel = null;
      reportChannelClient = null;
      reportChannelUserId = null;
      return;
    }
    if (reportChannel && reportChannelClient === state.client &&
        reportChannelUserId === state.user.id) return;
    if (reportChannel && reportChannelClient) void reportChannelClient.removeChannel(reportChannel);
    reportChannelClient = state.client;
    reportChannelUserId = state.user.id;
    reportChannel = state.client.channel(`civicx-report-updates-${state.user.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "civic_reports",
        filter: `user_id=eq.${state.user.id}`
      }, () => { void syncAuth(state); })
      .subscribe();
  }

  function formatDate(value) {
    if (!value) return "Date not available";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function eventDetails(event) {
    const parts = [];
    if (event.details) parts.push(event.details);
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    if (metadata.previous_status || metadata.status) {
      const change = metadata.previous_status
        ? `${metadata.previous_status} → ${metadata.status}`
        : String(metadata.status);
      parts.push(`Status: ${change}`);
    }
    if (metadata.evidence_url && /^https:\/\//i.test(metadata.evidence_url)) {
      parts.push(`Resolution evidence: ${metadata.evidence_url}`);
    }
    return parts.join(" · ");
  }

  function renderEvent(event) {
    const item = document.createElement("li");
    const copy = document.createElement("span");
    const summary = document.createElement("strong");
    summary.textContent = event.summary || event.event_type || "Report update";
    copy.append(summary);
    const details = eventDetails(event);
    if (details) {
      const detailLine = document.createElement("span");
      detailLine.textContent = ` — ${details}`;
      copy.append(detailLine);
    }
    const time = document.createElement("time");
    const actor = event.actor_kind ? `${event.actor_kind} · ` : "";
    time.textContent = `${actor}${formatDate(event.created_at)}`;
    copy.append(time);
    item.append(copy);
    return item;
  }

  function renderReport(report) {
    const details = document.createElement("details");
    details.className = "report-item";
    const summary = document.createElement("summary");
    const heading = document.createElement("span");
    heading.className = "report-item-heading";
    const title = document.createElement("strong");
    title.textContent = report.title;
    const meta = document.createElement("small");
    meta.textContent = `${report.category} · ${report.location} · ${formatDate(report.createdAt)}`;
    heading.append(title, meta);
    const badge = document.createElement("span");
    badge.className = "report-status-pill";
    badge.textContent = report.status;
    summary.append(heading, badge);
    const history = document.createElement("div");
    history.className = "report-events";
    const description = document.createElement("p");
    description.textContent = report.description;
    const timeline = document.createElement("ol");
    (report.events || []).forEach((event) => timeline.append(renderEvent(event)));
    if (!timeline.childElementCount) {
      const emptyEvent = document.createElement("li");
      emptyEvent.textContent = "No history entries are available for this report yet.";
      timeline.append(emptyEvent);
    }
    history.append(description, timeline);
    details.append(summary, history);
    return details;
  }

  function renderReports(items) {
    reports = items;
    elements.reportList.replaceChildren(...items.map(renderReport));
    const counts = CivicXReports.summarizeStatuses(items);
    elements.total.textContent = String(counts.total);
    elements.pending.textContent = String(counts.pending);
    elements.underReview.textContent = String(counts.underReview);
    elements.resolved.textContent = String(counts.resolved);
    elements.unresolved.textContent = String(counts.unresolved);
    elements.disputed.textContent = String(counts.disputed);
    elements.reopened.textContent = String(counts.reopened);
    elements.reportsEmpty.hidden = items.length > 0;
    if (!items.length) {
      elements.reportsEmptyTitle.textContent = "No reports yet";
      elements.reportsEmptyCopy.textContent = "Reports you prepare while signed in will appear here with their complete history.";
    }
    renderMarkers(items);
  }

  function showGuestState() {
    reports = [];
    elements.reportList.replaceChildren();
    elements.total.textContent = "—";
    elements.pending.textContent = "—";
    elements.underReview.textContent = "—";
    elements.resolved.textContent = "—";
    elements.unresolved.textContent = "—";
    elements.disputed.textContent = "—";
    elements.reopened.textContent = "—";
    elements.reportsStatus.textContent = guestMode
      ? "Guest mode is active. Sign in to retrieve account-linked reports."
      : "Log in to retrieve your account-linked reports.";
    elements.reportsEmpty.hidden = false;
    elements.reportsEmptyTitle.textContent = "Your reports are private to your account";
    elements.reportsEmptyCopy.textContent = "Log in to view reports from this or another device. Guest browsing does not save report data.";
    renderMarkers([]);
  }

  async function syncAuth(state) {
    const version = ++requestVersion;
    syncPublicMapChannel(state);
    if (!state.user || !state.client) {
      syncReportChannel(state);
      elements.aiWidget.hidden = true;
      elements.accountCaption.textContent = guestMode ? "Guest access" : "Not signed in";
      elements.accountName.textContent = guestMode ? "Browsing as a guest" : "Sign in to see your account";
      showGuestState();
      return;
    }

    syncReportChannel(state);
    elements.aiWidget.hidden = false;
    elements.accountCaption.textContent = state.user.email || "Signed in";
    elements.accountName.textContent = state.profile?.username || state.user.email || "Signed in to CivicX";
    elements.reportsStatus.textContent = "Loading your reports and complete histories from the database…";
    elements.reportsEmpty.hidden = true;
    if (!state.reportsReady) {
      elements.reportsStatus.textContent = state.reportsSetupMessage ||
        "The report database is not ready. Apply the CivicX report persistence migration.";
      elements.reportsEmpty.hidden = false;
      elements.reportsEmptyTitle.textContent = "Report storage needs setup";
      elements.reportsEmptyCopy.textContent = elements.reportsStatus.textContent;
      return;
    }
    try {
      const items = await window.CivicXReports.listForUser(state.client, state.user.id);
      if (version !== requestVersion) return;
      renderReports(items);
      elements.reportsStatus.textContent = items.length
        ? `Retrieved ${items.length} account-linked report${items.length === 1 ? "" : "s"} and their histories.`
        : "No reports have been submitted from this account yet.";
      elements.mapCaption.textContent = items.length
        ? "Public pins show Community-linked reports. Your own report pins remain private to your account."
        : "Public pins come from Community cross-posts. Your private report pins appear after you save a report.";
      if (!items.length) elements.reportsEmpty.hidden = false;
    } catch (error) {
      if (version !== requestVersion) return;
      console.error("[CivicX dashboard] Reports could not be retrieved", { code: error.code || "UNKNOWN", message: error.message });
      elements.reportsStatus.textContent = "Reports could not be retrieved. Check your connection and account, then retry.";
      elements.reportsEmpty.hidden = false;
      elements.reportsEmptyTitle.textContent = "Could not load reports";
      elements.reportsEmptyCopy.textContent = "Your records have not been deleted. Please reload or try signing in again.";
    }
  }

  function openAuth(mode) {
    const trigger = document.querySelector(`[data-civicx-auth-trigger][data-civicx-auth-mode="${mode}"]`);
    if (trigger) trigger.click();
  }

  async function openReportDialog() {
    await window.CivicXAuth.ready;
    if (!window.CivicXAuth.user) {
      openAuth("login");
      return;
    }
    if (!window.CivicXAuth.reportsReady) {
      elements.reportsStatus.textContent = window.CivicXAuth.reportsSetupMessage ||
        "Report storage is not configured. Your report was not saved.";
      return;
    }
    if (!jurisdictions.length) {
      elements.reportError.textContent = "Registered city options need the CIVICX server. You can still explore the map.";
      elements.reportError.hidden = false;
      elements.reportDialog.showModal();
      return;
    }
    elements.reportError.hidden = true;
    elements.reportDialog.showModal();
  }

  function beginPinSelection() {
    if (!map) {
      elements.reportError.textContent = "The map is unavailable. Reload the page and try again.";
      elements.reportError.hidden = false;
      return;
    }
    elements.reportDialog.close();
    selectingLocation = true;
    elements.mapCaption.textContent = "Choose the report location by clicking or tapping the map.";
    document.getElementById("city-map").scrollIntoView({ behavior: "smooth", block: "center" });
    map.getContainer().style.cursor = "crosshair";
  }

  function useCurrentLocation(button) {
    if (!navigator.geolocation) {
      elements.reportError.textContent = "This browser does not support location access. Choose a point on the map instead.";
      elements.reportError.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = "Finding location…";
    navigator.geolocation.getCurrentPosition((position) => {
      try {
        setCoordinates(position.coords.latitude, position.coords.longitude);
        const nearest = window.CivicXJurisdictions.nearestJurisdiction(
          position.coords.latitude,
          position.coords.longitude,
          jurisdictions
        );
        if (nearest) {
          selectJurisdiction(nearest.jurisdictionKey, false);
          elements.reportError.hidden = true;
        } else {
          elements.reportError.textContent = "Your location was pinned, but no registered city center is configured nearby. Choose a city from the list.";
          elements.reportError.hidden = false;
        }
      } catch (error) {
        elements.reportError.textContent = error.message;
        elements.reportError.hidden = false;
      }
      button.disabled = false;
      button.textContent = "Use my location";
    }, (error) => {
      elements.reportError.textContent = error.code === error.PERMISSION_DENIED
        ? "Location access was denied. Choose a point on the map instead."
        : "Your location could not be found. Choose a point on the map instead.";
      elements.reportError.hidden = false;
      button.disabled = false;
      button.textContent = "Use my location";
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  function detectNearestRegion(button) {
    if (!navigator.geolocation) {
      elements.mapCaption.textContent = "This browser does not support location access. Choose a registered city instead.";
      return;
    }
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "Detecting…";
    navigator.geolocation.getCurrentPosition((position) => {
      const nearest = window.CivicXJurisdictions.nearestJurisdiction(
        position.coords.latitude,
        position.coords.longitude,
        jurisdictions
      );
      if (nearest) selectJurisdiction(nearest.jurisdictionKey);
      else elements.mapCaption.textContent = "No active jurisdiction with a configured map center was found nearby.";
      button.disabled = false;
      button.textContent = originalText;
    }, (error) => {
      elements.mapCaption.textContent = error.code === error.PERMISSION_DENIED
        ? "Location access was denied. Choose a registered city from the list."
        : "Your location could not be found. Choose a registered city from the list.";
      button.disabled = false;
      button.textContent = originalText;
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  function clearReportPhoto() {
    if (reportPhoto?.previewUrl) URL.revokeObjectURL(reportPhoto.previewUrl);
    reportPhoto = null;
    elements.reportPhotoPreview.hidden = true;
    elements.reportPhotoThumbnail.removeAttribute("src");
    elements.reportPhoto.value = "";
    elements.removeReportPhoto.hidden = true;
  }

  async function prepareReportPhoto(file) {
    clearReportPhoto();
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        !file.size || file.size > 8 * 1024 * 1024) {
      elements.reportPhotoStatus.textContent = "Choose a JPG, PNG, or WebP photo up to 8 MB.";
      elements.reportPhotoPreview.hidden = false;
      return;
    }
    photoPreparing = true;
    elements.saveReport.disabled = true;
    elements.reportPhotoStatus.textContent = "Redacting faces and license plates on this device…";
    elements.reportPhotoPreview.hidden = false;
    try {
      const privacy = await imagePrivacyReady;
      const redacted = await privacy.redactPhoto(file);
      const redactedFile = await privacy.applyManualRegions(redacted);
      const previewUrl = URL.createObjectURL(redactedFile);
      reportPhoto = { file: redactedFile, previewUrl };
      elements.reportPhotoThumbnail.src = previewUrl;
      elements.reportPhotoStatus.textContent =
        `Redacted preview ready (${redacted.faceCount} faces and ${redacted.plateCount} plates covered).`;
      elements.removeReportPhoto.hidden = false;
    } catch (error) {
      elements.reportPhotoStatus.textContent = error.message || "Photo privacy processing failed. The photo was not attached.";
    } finally {
      photoPreparing = false;
      elements.saveReport.disabled = false;
      elements.reportPhoto.value = "";
    }
  }

  function reportTitle(description) {
    const words = description.trim().split(/\s+/);
    const title = (words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : description.trim()).slice(0, 200);
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  async function saveReport(event) {
    event.preventDefault();
    if (savingReport) return;
    elements.reportError.hidden = true;
    if (photoPreparing) {
      elements.reportError.textContent = "Wait for photo privacy processing to finish before saving.";
      elements.reportError.hidden = false;
      return;
    }
    const client = window.CivicXAuth.client;
    const user = window.CivicXAuth.user;
    if (!client || !user) {
      elements.reportError.textContent = "Log in before saving. Reports are stored in your account, not in this browser.";
      elements.reportError.hidden = false;
      return;
    }
    if (!window.CivicXAuth.reportsReady) {
      elements.reportError.textContent = window.CivicXAuth.reportsSetupMessage ||
        "Report storage is not ready. Your report has not been saved.";
      elements.reportError.hidden = false;
      return;
    }
    const crosspostRequested = elements.communityChoice.value === "yes";
    if (crosspostRequested && !COMMUNITY_CROSSPOST_ENABLED) {
      elements.reportError.textContent =
        "Community cross-posting is disabled until the database migration has been applied and confirmed.";
      elements.reportError.hidden = false;
      return;
    }
    if (crosspostRequested && (communityProfileLoading || !communityProfileLoaded || communityProfileError)) {
      elements.reportError.textContent =
        "Wait for your Community profile check to finish or retry it before saving.";
      elements.reportError.hidden = false;
      return;
    }
    const category = document.getElementById("report-category").value;
    const description = document.getElementById("report-description").value.trim();
    const location = document.getElementById("report-location").value.trim();
    const jurisdiction = selectedJurisdiction();
    const latitude = Number(elements.latitude.value);
    const longitude = Number(elements.longitude.value);
    if (!category || !description || !location || !jurisdiction) {
      elements.reportError.textContent = "Complete the issue type, description, location, and registered city.";
      elements.reportError.hidden = false;
      return;
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      elements.reportError.textContent = "Choose a point on the map or use your current location before saving.";
      elements.reportError.hidden = false;
      return;
    }
    const id = crosspostRequested
      ? (pendingCrosspostReportId || (pendingCrosspostReportId = `CX-${crypto.randomUUID()}`))
      : `CX-${crypto.randomUUID()}`;
    const area = location.split(",")[0].trim().slice(0, 120);
    const report = {
      id,
      ownerId: user.id,
      isMine: true,
      category,
      title: reportTitle(description),
      city: jurisdiction.displayName,
      jurisdictionKey: jurisdiction.jurisdictionKey,
      location,
      area,
      description,
      coordinates: [latitude, longitude],
      status: "Prepared (awaiting user filing)",
      priority: category === "Pothole" || category === "Water leakage" ? "High" : "Medium",
      registrationNumber: id,
      date: new Date().toLocaleString(),
      officialPortalUrl: "https://pgportal.gov.in/Home/LodgeGrievance"
    };
    const communityPost = crosspostRequested ? {
      category: elements.communityCategory.value,
      displayName: communityProfile?.display_name || elements.communityDisplayName.value.trim(),
      locality: communityProfile?.locality || elements.communityLocality.value.trim()
    } : null;
    savingReport = true;
    elements.saveReport.disabled = true;
    elements.saveReport.textContent = crosspostRequested ? "Saving and posting…" : "Saving…";
    try {
      let crosspostResult = null;
      if (crosspostRequested) {
        crosspostResult = await window.CivicXReports.createWithCommunity(
          client,
          user,
          report,
          reportPhoto?.file || null,
          communityPost,
          window.CivicXCommunityPosts
        );
      } else {
        await window.CivicXReports.create(client, user, report, reportPhoto?.file || null);
      }
      elements.reportDialog.close();
      elements.reportForm.reset();
      clearReportPhoto();
      elements.communityCategory.selectedIndex = 0;
      elements.communityDisplayName.value = "";
      elements.communityLocality.value = "";
      elements.latitude.value = "";
      elements.longitude.value = "";
      elements.selectedCoordinate.textContent = "A map point is required to save this report.";
      communityProfile = null;
      communityProfileLoaded = false;
      communityProfileLoading = false;
      communityProfileError = false;
      communityCategoryChanged = false;
      pendingCrosspostReportId = "";
      updateCommunityCrosspostFields();
      if (selectionMarker) {
        selectionMarker.remove();
        selectionMarker = null;
      }
      if (elements.mapRegion.value) selectJurisdiction(elements.mapRegion.value);
      await syncAuth({ client, user, reportsReady: true });
      elements.reportsStatus.textContent = crosspostRequested
        ? crosspostResult.alreadyCreated
          ? "Issue reported and already posted to the Civic X Community; no duplicate was created."
          : "Issue reported and posted to the Civic X Community."
        : "Issue reported and saved to your account.";
      document.getElementById("my-reports").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      console.error("[CivicX dashboard] Report was not saved", { code: error.code || "UNKNOWN", message: error.message });
      elements.reportError.textContent = crosspostRequested
        ? window.CivicXReports.communityCrosspostErrorMessage(error)
        : window.CivicXReports.saveErrorMessage(error);
      elements.reportError.hidden = false;
    } finally {
      savingReport = false;
      elements.saveReport.disabled = false;
      elements.saveReport.textContent = "Save report";
    }
  }

  initializeMap();
  initializeCommunityCrosspost();
  void loadJurisdictions();
  document.querySelectorAll("[data-open-report]").forEach((button) => button.addEventListener("click", openReportDialog));
  document.getElementById("choose-pin").addEventListener("click", beginPinSelection);
  document.getElementById("use-current-location").addEventListener("click", (event) => useCurrentLocation(event.currentTarget));
  elements.mapRegion.addEventListener("change", () => selectJurisdiction(elements.mapRegion.value));
  elements.reportCity.addEventListener("change", () => selectJurisdiction(elements.reportCity.value));
  elements.detectMapRegion.addEventListener("click", (event) => detectNearestRegion(event.currentTarget));
  elements.reportPhoto.addEventListener("change", () => void prepareReportPhoto(elements.reportPhoto.files?.[0]));
  elements.removeReportPhoto.addEventListener("click", clearReportPhoto);
  document.getElementById("cancel-report").addEventListener("click", () => elements.reportDialog.close());
  elements.reportForm.addEventListener("submit", saveReport);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && window.CivicXAuth.user) {
      void syncAuth({
        client: window.CivicXAuth.client,
        user: window.CivicXAuth.user,
        reportsReady: window.CivicXAuth.reportsReady
      });
    }
  });
  window.addEventListener("beforeunload", () => {
    if (reportChannel && reportChannelClient) void reportChannelClient.removeChannel(reportChannel);
    if (publicMapAbortController) publicMapAbortController.abort();
    if (publicMapChannel && publicMapChannelClient) void publicMapChannelClient.removeChannel(publicMapChannel);
    window.clearTimeout(publicMapReloadTimer);
    if (reportPhoto?.previewUrl) URL.revokeObjectURL(reportPhoto.previewUrl);
  });
  window.CivicXAuth.onChange((state) => { void syncAuth(state); });
  window.CivicXAuth.ready.catch((error) => {
    console.error("[CivicX dashboard] Authentication could not be restored", error);
    elements.reportsStatus.textContent = "Account status could not be checked. Reload and try again.";
  });
})();
