(() => {
  const status = document.getElementById("authority-status");
  const keyPanel = document.getElementById("authority-key-panel");
  const workspace = document.getElementById("authority-workspace");
  const reportList = document.getElementById("authority-report-list");
  const keyInput = document.getElementById("authority-master-key");
  const keyForm = document.getElementById("authority-key-form");
  const promotionPanel = document.getElementById("authority-jurisdiction-panel");
  const jurisdictionSelect = document.getElementById("authority-jurisdiction-select");
  const activateButton = document.getElementById("authority-activate");
  let user = null;
  let activeUserId = null;

  async function accessToken() {
    const { data, error } = await window.CivicXAuth.client.auth.getSession();
    if (error || !data.session?.access_token) throw new Error("Your signed-in session could not be verified. Sign in again.");
    return data.session.access_token;
  }

  async function api(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          "x-civicx-master-key": window.CivicXPortalSession.get("authority", user?.id),
          ...(options.headers || {})
        },
        cache: "no-store"
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error("This feature needs the CIVICX server. Public pages remain available.");
      }
      throw error;
    }
    const contentType = response.headers.get("content-type") || "";
    const result = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : null;
    if (response.status === 404 || !contentType.includes("application/json") || !result) {
      const error = new Error("This feature needs the CIVICX server. Public pages remain available.");
      error.status = response.status;
      throw error;
    }
    if (!response.ok || result.ok !== true) {
      const error = new Error(result.error || "The authority request could not be completed.");
      error.status = response.status;
      throw error;
    }
    return result.result;
  }

  function renderEvent(event, container) {
    const item = document.createElement("li");
    const summary = document.createElement("strong");
    summary.textContent = event.summary || event.event_type || "Report update";
    const detail = document.createElement("span");
    const actor = event.actor_user_id
      ? `Actor: ${event.actor_kind || "user"} ${event.actor_user_id}`
      : event.actor_kind;
    detail.textContent = [actor, event.details, event.created_at && new Date(event.created_at).toLocaleString()]
      .filter(Boolean).join(" · ");
    item.append(summary, detail);
    container.append(item);
  }

  async function showDetails(report, card) {
    const existing = card.querySelector(".portal-report-details");
    if (existing) {
      existing.remove();
      return;
    }
    try {
      const result = await api(`/api/portal/reports/${encodeURIComponent(report.id)}`);
      const details = document.createElement("section");
      details.className = "portal-report-details";
      const description = document.createElement("p");
      description.textContent = result.report.description || "No description was provided.";
      const history = document.createElement("ol");
      result.events.forEach((event) => renderEvent(event, history));
      details.append(description, history);
      if (result.report.hasAttachment) {
        const attachment = document.createElement("button");
        attachment.type = "button";
        attachment.className = "action-light compact-action";
        attachment.textContent = "Open private report attachment";
        attachment.addEventListener("click", async () => {
          attachment.disabled = true;
          try {
            const signed = await api(`/api/portal/reports/${encodeURIComponent(report.id)}/attachment`);
            const link = document.createElement("a");
            link.href = signed.signedUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "Open attachment (link expires in 60 seconds)";
            attachment.replaceWith(link);
          } catch (error) {
            status.textContent = error.message;
          } finally {
            attachment.disabled = false;
          }
        });
        details.append(attachment);
      }
      details.append(createActionForm(report));
      card.append(details);
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function createActionForm(report) {
    const form = document.createElement("form");
    form.className = "portal-action-form";
    const label = document.createElement("label");
    label.textContent = "Update status";
    const select = document.createElement("select");
    ["Pending", "Submitted", "Verified", "Assigned", "In progress", "Resolved", "Cannot be Resolved", "Closed", "Rejected"]
      .forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.selected = value === report.status ||
          (value === "Pending" && report.status === "Prepared (awaiting user filing)");
        select.append(option);
      });
    label.append(select);
    const note = document.createElement("textarea");
    note.required = true;
    note.maxLength = 2000;
    note.rows = 2;
    note.placeholder = "Required audit note describing the action";
    const evidence = document.createElement("input");
    evidence.type = "url";
    evidence.placeholder = "Optional HTTPS resolution evidence URL";
    evidence.maxLength = 1000;
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "action-dark compact-action";
    submit.textContent = "Save status";
    const reopen = document.createElement("button");
    reopen.type = "button";
    reopen.className = "action-light compact-action";
    reopen.textContent = "Reopen report";
    reopen.addEventListener("click", () => submitAction(report, "reopen", note.value, null));
    const addEvidence = document.createElement("button");
    addEvidence.type = "button";
    addEvidence.className = "action-light compact-action";
    addEvidence.textContent = "Add resolution evidence";
    addEvidence.addEventListener("click", () => submitAction(report, "resolution_evidence_add", note.value, evidence.value));
    const removeEvidence = document.createElement("button");
    removeEvidence.type = "button";
    removeEvidence.className = "action-light compact-action";
    removeEvidence.textContent = "Remove resolution evidence";
    removeEvidence.addEventListener("click", () => submitAction(report, "resolution_evidence_remove", note.value, null));
    form.append(label, note, evidence, submit, reopen, addEvidence, removeEvidence);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitAction(report, "status_update", note.value, null, select.value);
    });
    return form;
  }

  async function submitAction(report, action, details, evidenceUrl, nextStatus) {
    if (!details.trim()) {
      status.textContent = "An audit note is required for every authority action.";
      return;
    }
    const body = { action, details: details.trim() };
    if (action === "status_update") body.status = nextStatus;
    if (action === "resolution_evidence_add") body.evidenceUrl = evidenceUrl;
    try {
      await api(`/api/reports/${encodeURIComponent(report.id)}/authority-actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      status.textContent = "Authority action saved with an attributable audit-history entry.";
      await loadReports();
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function renderReport(report) {
    const card = document.createElement("article");
    card.className = "portal-report";
    const heading = document.createElement("div");
    heading.className = "portal-report-heading";
    const title = document.createElement("h3");
    title.textContent = report.title || report.id;
    const statusPill = document.createElement("span");
    statusPill.className = "report-status-pill";
    statusPill.textContent = report.status || "Unknown";
    heading.append(title, statusPill);
    const meta = document.createElement("p");
    meta.textContent = `${report.category} · ${report.location}, ${report.city} · Jurisdiction ${report.jurisdictionKey}`;
    const details = document.createElement("button");
    details.type = "button";
    details.className = "action-light compact-action";
    details.textContent = "View report history and actions";
    details.addEventListener("click", () => void showDetails(report, card));
    card.append(heading, meta, details);
    return card;
  }

  async function loadReports() {
    const requestUserId = user?.id;
    status.textContent = "Loading reports assigned to your verified jurisdiction…";
    try {
      const result = await api("/api/portal/reports");
      if (!requestUserId || user?.id !== requestUserId) return;
      if (result.role !== "authority") {
        workspace.hidden = true;
        status.textContent = "This account has owner access. ";
        const ownerLink = document.createElement("a");
        ownerLink.href = "owner.html";
        ownerLink.textContent = "Open the Owner Portal.";
        status.append(ownerLink);
        return;
      }
      reportList.replaceChildren(...result.reports.map(renderReport));
      workspace.hidden = false;
      status.textContent = `${result.reports.length} reports loaded for your active jurisdiction assignment(s).`;
    } catch (error) {
      if (!requestUserId || user?.id !== requestUserId) return;
      status.textContent = error.message;
      if ([401, 403].includes(error.status)) {
        window.CivicXPortalSession.clear("authority");
        workspace.hidden = true;
        promotionPanel.hidden = true;
        keyForm.hidden = false;
        keyPanel.hidden = false;
      }
    }
  }

  async function unlock(event) {
    event.preventDefault();
    const requestUserId = user?.id;
    window.CivicXPortalSession.set("authority", user?.id, keyInput.value);
    keyInput.value = "";
    status.textContent = "Verifying the Authority key…";
    try {
      const result = await api("/api/portal/authority/entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      if (!requestUserId || user?.id !== requestUserId) return;
      if (result.requiresJurisdiction) {
        jurisdictionSelect.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.disabled = true;
        placeholder.selected = true;
        placeholder.textContent = "Choose a municipal corporation";
        jurisdictionSelect.append(placeholder);
        result.jurisdictions.forEach((jurisdiction) => {
          const option = document.createElement("option");
          option.value = jurisdiction.jurisdictionKey;
          option.textContent = jurisdiction.displayName;
          jurisdictionSelect.append(option);
        });
        promotionPanel.hidden = false;
        keyForm.hidden = true;
        keyPanel.hidden = false;
        status.textContent = result.jurisdictions.length
          ? "Select the municipal corporation this authority account will serve."
          : "No active municipal corporations are available. Contact the site owner.";
        activateButton.disabled = result.jurisdictions.length === 0;
        return;
      }
      promotionPanel.hidden = true;
      keyForm.hidden = true;
      keyPanel.hidden = true;
      await loadReports();
    } catch (error) {
      if (!requestUserId || user?.id !== requestUserId) return;
      window.CivicXPortalSession.clear("authority");
      promotionPanel.hidden = true;
      keyForm.hidden = false;
      keyPanel.hidden = false;
      status.textContent = error.message;
    }
  }

  async function activateAuthority() {
    const requestUserId = user?.id;
    const jurisdictionKey = jurisdictionSelect.value;
    if (!jurisdictionKey) {
      status.textContent = "Choose a municipal corporation before continuing.";
      return;
    }
    activateButton.disabled = true;
    status.textContent = "Activating authority access…";
    try {
      const result = await api("/api/portal/authority/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jurisdictionKey })
      });
      if (!requestUserId || user?.id !== requestUserId) return;
      if (result.activated !== true) throw new Error("Authority access could not be activated.");
      promotionPanel.hidden = true;
      keyForm.hidden = true;
      keyPanel.hidden = true;
      await loadReports();
    } catch (error) {
      if (!requestUserId || user?.id !== requestUserId) return;
      window.CivicXPortalSession.clear("authority");
      promotionPanel.hidden = true;
      keyForm.hidden = false;
      keyPanel.hidden = false;
      status.textContent = error.message;
    } finally {
      activateButton.disabled = false;
    }
  }

  function syncAuth(state) {
    user = state.user;
    const userId = user?.id || null;
    const userChanged = activeUserId !== userId;
    window.CivicXPortalSession.sync(userId);
    if (userChanged) {
      keyInput.value = "";
      workspace.hidden = true;
      promotionPanel.hidden = true;
      keyForm.hidden = false;
      keyPanel.hidden = !user;
    }
    activeUserId = userId;
    document.getElementById("authority-account").textContent = user ? "Signed in" : "Not signed in";
    if (!user) {
      workspace.hidden = true;
      keyPanel.hidden = true;
      promotionPanel.hidden = true;
      status.textContent = "Sign in with an active authority account to continue.";
      return;
    }
    if (userChanged) status.textContent = "Enter the server-configured Authority key to continue.";
  }

  keyForm.addEventListener("submit", unlock);
  activateButton.addEventListener("click", () => void activateAuthority());
  document.getElementById("authority-refresh").addEventListener("click", () => void loadReports());
  window.CivicXAuth.onChange(syncAuth);
  window.CivicXAuth.ready.catch((error) => {
    console.error("[CivicX authority portal] Authentication could not be restored", error);
    status.textContent = "Account status could not be checked. Reload and try again.";
  });
})();
