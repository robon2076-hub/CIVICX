(() => {
  const status = document.getElementById("owner-status");
  const keyPanel = document.getElementById("owner-key-panel");
  const workspace = document.getElementById("owner-workspace");
  const keyInput = document.getElementById("owner-master-key");
  const authoritySelect = document.getElementById("owner-authority-select");
  const jurisdictionSelect = document.getElementById("owner-jurisdiction-select");
  const authorityList = document.getElementById("owner-authority-list");
  const reportList = document.getElementById("owner-report-list");
  let configuration = null;
  let activeUserId = null;

  async function accessToken() {
    const { data, error } = await window.CivicXAuth.client.auth.getSession();
    if (error || !data.session?.access_token) throw new Error("Your signed-in session could not be verified. Sign in again.");
    return data.session.access_token;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        "x-civicx-master-key": window.CivicXPortalSession.get("owner", activeUserId),
        ...(options.headers || {})
      },
      cache: "no-store"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) {
      const error = new Error(result.error || "The owner request could not be completed.");
      error.status = response.status;
      throw error;
    }
    return result.result;
  }

  function populateAuthorities() {
    const active = configuration.authorities.filter((authority) => authority.is_active);
    authoritySelect.replaceChildren();
    active.forEach((authority) => {
      const option = document.createElement("option");
      option.value = authority.user_id;
      option.textContent = `Authority · ${authority.user_id}`;
      authoritySelect.append(option);
    });
    jurisdictionSelect.replaceChildren();
    configuration.jurisdictions.forEach((jurisdiction) => {
      const option = document.createElement("option");
      option.value = jurisdiction.jurisdiction_key;
      option.textContent = `${jurisdiction.display_name}${jurisdiction.is_active ? "" : " · inactive (will be removed)"}`;
      jurisdictionSelect.append(option);
    });
    renderAuthorityAssignments();
    changeAuthority();
  }

  function renderAuthorityAssignments() {
    authorityList.replaceChildren();
    configuration.authorities.forEach((authority) => {
      const row = document.createElement("p");
      const keys = configuration.assignments
        .filter((assignment) => assignment.authority_user_id === authority.user_id)
        .map((assignment) => assignment.jurisdiction_key);
      row.textContent = `${authority.is_active ? "Active" : "Inactive"} · ${authority.user_id} · ${keys.length ? keys.join(", ") : "No assigned jurisdiction"}`;
      authorityList.append(row);
    });
  }

  function renderReports(reports) {
    reportList.replaceChildren();
    reports.forEach((report) => {
      const card = document.createElement("article");
      card.className = "portal-report";
      const heading = document.createElement("div");
      heading.className = "portal-report-heading";
      const title = document.createElement("h3");
      title.textContent = report.title || report.id;
      const state = document.createElement("span");
      state.className = "report-status-pill";
      state.textContent = report.status || "Unknown";
      heading.append(title, state);
      const meta = document.createElement("p");
      meta.textContent = `${report.category} · ${report.location}, ${report.city} · ${report.jurisdictionKey || "Unassigned"}`;
      card.append(heading, meta);
      reportList.append(card);
    });
    if (!reports.length) reportList.textContent = "No reports are available.";
  }

  async function loadWorkspace() {
    const requestUserId = activeUserId;
    status.textContent = "Verifying owner allowlist and loading global configuration…";
    try {
      const [nextConfiguration, reports] = await Promise.all([
        api("/api/portal/owner/configuration"),
        api("/api/portal/reports")
      ]);
      if (activeUserId !== requestUserId || !requestUserId) return;
      if (!Array.isArray(nextConfiguration.authorities) ||
          !Array.isArray(nextConfiguration.assignments) ||
          !Array.isArray(nextConfiguration.jurisdictions) ||
          reports.role !== "owner") {
        throw new Error("This account does not have configured Owner portal access.");
      }
      configuration = nextConfiguration;
      populateAuthorities();
      renderReports(reports.reports);
      workspace.hidden = false;
      status.textContent = `${reports.reports.length} reports loaded across all jurisdictions.`;
    } catch (error) {
      if (activeUserId !== requestUserId || !requestUserId) return;
      status.textContent = error.message;
      if (error.status === 401 || error.status === 403) {
        window.CivicXPortalSession.clear("owner");
        workspace.hidden = true;
        keyPanel.hidden = false;
      }
    }
  }

  async function unlock(event) {
    event.preventDefault();
    const requestUserId = activeUserId;
    window.CivicXPortalSession.set("owner", requestUserId, keyInput.value);
    keyInput.value = "";
    keyPanel.hidden = true;
    await loadWorkspace();
    if (activeUserId !== requestUserId || !requestUserId) return;
    if (!window.CivicXPortalSession.get("owner", activeUserId)) keyPanel.hidden = false;
  }

  async function saveAssignments(event) {
    event.preventDefault();
    const authorityUserId = authoritySelect.value;
    if (!authorityUserId) {
      status.textContent = "Select an active municipal authority first.";
      return;
    }
    const jurisdictionKeys = Array.from(jurisdictionSelect.selectedOptions)
      .filter((option) => configuration.jurisdictions.some((item) =>
        item.jurisdiction_key === option.value && item.is_active))
      .map((option) => option.value);
    try {
      const result = await api(`/api/portal/owner/authorities/${encodeURIComponent(authorityUserId)}/jurisdictions`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jurisdictionKeys })
      });
      status.textContent = `Assignment saved. ${result.changedAssignments} jurisdiction change(s) were recorded in the audit history.`;
      await loadWorkspace();
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function changeAuthority() {
    if (!configuration) return;
    const assigned = new Set(configuration.assignments
      .filter((assignment) => assignment.authority_user_id === authoritySelect.value)
      .map((assignment) => assignment.jurisdiction_key));
    Array.from(jurisdictionSelect.options).forEach((option) => {
      option.selected = assigned.has(option.value) && configuration.jurisdictions
        .some((jurisdiction) => jurisdiction.jurisdiction_key === option.value && jurisdiction.is_active);
    });
  }

  document.getElementById("owner-key-form").addEventListener("submit", unlock);
  document.getElementById("owner-assignment-form").addEventListener("submit", saveAssignments);
  document.getElementById("owner-refresh").addEventListener("click", () => void loadWorkspace());
  authoritySelect.addEventListener("change", changeAuthority);
  window.CivicXAuth.onChange((state) => {
    const userId = state.user?.id || null;
    const userChanged = activeUserId !== userId;
    window.CivicXPortalSession.sync(userId);
    if (userChanged) {
      keyInput.value = "";
      workspace.hidden = true;
      keyPanel.hidden = !state.user;
    }
    activeUserId = userId;
    document.getElementById("owner-account").textContent = state.user ? "Signed in" : "Not signed in";
    if (!state.user) {
      configuration = null;
      workspace.hidden = true;
      keyPanel.hidden = true;
      status.textContent = "Sign in with an account on the server-side owner allowlist to continue.";
      return;
    }
    if (userChanged) status.textContent = "Enter the server-configured Owner key to continue.";
  });
  window.CivicXAuth.ready.catch((error) => {
    console.error("[CivicX owner portal] Authentication could not be restored", error);
    status.textContent = "Account status could not be checked. Reload and try again.";
  });
})();
