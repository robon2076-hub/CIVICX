(() => {
  const query = new URLSearchParams(window.location.search);
  const registrationInput = document.getElementById("track-registration");
  const result = document.getElementById("track-result");
  const error = document.getElementById("track-error");
  const saveForm = document.getElementById("save-status-form");
  const saveButton = document.querySelector("#save-status-form button[type='submit']");
  const officialCpgramsBtn = document.getElementById("official-cpgrams-btn");

  const statusLabels = {
    not_checked: "Not checked on CPGRAMS yet",
    registered: "Registered",
    submitted: "Submitted",
    verified: "Verified",
    assigned: "Assigned to Department",
    under_review: "Under Review",
    in_progress: "In Progress",
    resolved: "Resolved",
    closed: "Closed",
    rejected: "Rejected"
  };

  const fields = {
    status: document.getElementById("track-status"),
    remarks: document.getElementById("track-remarks"),
    date: document.getElementById("track-date"),
    document: document.getElementById("track-document")
  };

  let currentRecord = null;
  let currentUserId = null;

  function setError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  function validRegistrationNumber(value) {
    return /^[\p{L}\p{N}][\p{L}\p{N}./_-]{1,79}$/u.test(value);
  }

  function validOfficialDocument(value) {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname.includes("pgportal.gov.in");
    } catch {
      return false;
    }
  }

  function isResolvedStatus(status) {
    const s = String(status || "").toLowerCase().trim();
    return s === "resolved" || s === "closed" || s === "fixed";
  }

  function getStepIndex(status) {
    const s = String(status || "").toLowerCase().trim();
    if (s === "resolved" || s === "closed") return 4;
    if (s.includes("progress")) return 3;
    if (s.includes("assigned")) return 2;
    if (s.includes("verified") || s.includes("review")) return 1;
    return 0; // Submitted / Prepared
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }

  function showResult(record, regNumber) {
    result.replaceChildren();
    if (!record) {
      const cleanNum = escapeHtml(regNumber);
      result.innerHTML = `
        <div class="track-resolution-banner is-not-found">
          <span class="resolution-icon">❓</span>
          <div>
            <strong class="resolution-title">Report Reference Not Found in Your Account</strong>
            <p>No report or saved official reference in your signed-in account matches <strong>${cleanNum}</strong>.</p>
          </div>
        </div>
        <div class="track-details-grid">
          <div class="track-detail-item">
            <span>Reference entered</span>
            <strong>${cleanNum}</strong>
          </div>
          <div class="track-detail-item">
            <span>Privacy</span>
            <strong>Other accounts' reports are never displayed.</strong>
          </div>
        </div>
        <p class="track-status-note">A CivicX reference is not an official government complaint number.</p>
      `;
      result.hidden = false;
      return;
    }

    const currentStatus = record.status || record.portal_status || "Submitted";
    const resolved = isResolvedStatus(currentStatus);
    const stepIndex = getStepIndex(currentStatus);

    const steps = [
      "1. Submitted",
      "2. Verified",
      "3. Assigned",
      "4. In Progress",
      "5. Resolved"
    ];

    const timelineHtml = `
      <div class="track-timeline-wrap" aria-label="Complaint progress">
        <div class="track-stepper">
          ${steps.map((step, idx) => `
            <div class="track-step ${idx <= stepIndex ? "is-complete" : ""} ${idx === stepIndex ? "is-current" : ""}">
              <div class="track-step-circle">${idx < stepIndex ? "✓" : idx + 1}</div>
              <span class="track-step-label">${step}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;

    const bannerHtml = resolved
      ? `
        <div class="track-resolution-banner is-resolved">
          <span class="resolution-icon">✓</span>
          <div>
            <div class="resolution-badge-row">
              <span class="status-chip is-resolved-chip">RECORDED: RESOLVED</span>
              <span class="resolution-confirmed-tag">Citizen-recorded</span>
            </div>
            <strong class="resolution-title">This report is recorded as RESOLVED</strong>
            <p>Check the official portal for current details. Statuses saved by a citizen are not independently verified by CivicX.</p>
          </div>
        </div>
      `
      : `
        <div class="track-resolution-banner is-open">
          <span class="resolution-icon">⏳</span>
          <div>
            <div class="resolution-badge-row">
              <span class="status-chip is-open-chip">STATUS: NOT RESOLVED</span>
              <span class="stage-tag">Current stage: ${escapeHtml(currentStatus)}</span>
            </div>
            <strong class="resolution-title">This report is not recorded as resolved</strong>
            <p>The status shown here may be citizen-recorded; CivicX does not independently verify authority updates.</p>
          </div>
        </div>
      `;

    const { civicXReference, officialRegistration } = window.CivicXReports.getReportReferences(record);
    const referenceMarkup = civicXReference
      ? `<div class="track-detail-item">
          <span>CivicX report reference — not an official government complaint number</span>
          <div class="copyable-reg">
            <strong>${escapeHtml(civicXReference)}</strong>
            <button type="button" class="tiny-copy-btn" id="copy-reg-btn" title="Copy CivicX reference">Copy</button>
          </div>
        </div>
        ${officialRegistration ? `<div class="track-detail-item">
          <span>Official CPGRAMS registration number</span>
          <strong>${escapeHtml(officialRegistration)}</strong>
        </div>` : ""}
        `
      : `<div class="track-detail-item">
          <span>Official CPGRAMS registration number</span>
          <div class="copyable-reg">
            <strong>${escapeHtml(officialRegistration || record.id)}</strong>
            <button type="button" class="tiny-copy-btn" id="copy-reg-btn" title="Copy official CPGRAMS reference">Copy</button>
          </div>
        </div>`;
    const canRecordCpgramsStatus = !civicXReference || Boolean(officialRegistration);
    const detailsHtml = `
      <div class="track-details-card">
        <h3>Complaint Details</h3>
        <div class="track-details-grid">
          ${referenceMarkup}
          <div class="track-detail-item">
            <span>Issue category</span>
            <strong>${escapeHtml(record.category || "Civic Issue")}</strong>
          </div>
          <div class="track-detail-item">
            <span>Location & City</span>
            <strong>${escapeHtml(record.location || "Local area")} ${record.city ? `(${escapeHtml(record.city.split(",")[0])})` : ""}</strong>
          </div>
          <div class="track-detail-item">
            <span>Date reported</span>
            <strong>${escapeHtml(record.date || "Recent")}</strong>
          </div>
          <div class="track-detail-item">
            <span>Priority</span>
            <span class="priority-badge ${String(record.priority || "").toLowerCase()}">${escapeHtml(record.priority || "Medium")}</span>
          </div>
          <div class="track-detail-item">
            <span>Department in charge</span>
            <strong>${escapeHtml(record.department || "Municipal Division")}</strong>
          </div>
        </div>
        ${record.description ? `
          <div class="track-desc-box">
            <span>Description:</span>
            <p>${escapeHtml(record.description)}</p>
          </div>
        ` : ""}
        ${record.historyEvents?.length ? `
          <div class="track-desc-box">
            <span>Saved issue history</span>
            <ol class="track-history-list">${record.historyEvents.map((item) => `
              <li><strong>${escapeHtml(item.summary)}</strong><small>${escapeHtml(item.actor_kind || "citizen")} · ${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString() : "")}</small>${item.details ? `<p>${escapeHtml(item.details)}</p>` : ""}</li>
            `).join("")}</ol>
          </div>
        ` : ""}
      </div>
    `;

    const cpgramsPanelHtml = `
      <div class="track-cpgrams-feature-panel">
        <div class="cpgrams-feature-top">
          <span class="cpgrams-symbol">🏛️</span>
          <div>
            <strong>Check Live Status on CPGRAMS</strong>
            <p>You can verify government action on this complaint directly on the central CPGRAMS portal.</p>
          </div>
        </div>
        <div class="cpgrams-feature-actions">
          <a class="button button-primary" href="https://pgportal.gov.in/Status" target="_blank" rel="noopener noreferrer">
            Open CPGRAMS Tracker (pgportal.gov.in/Status) ↗
          </a>
          ${canRecordCpgramsStatus
            ? `<button class="button button-secondary" type="button" id="toggle-save-form-btn">Record a status update</button>`
            : `<p class="track-status-note">A CivicX reference is not a CPGRAMS registration number. Save the official CPGRAMS reference from the report details before recording a CPGRAMS status.</p>`}
        </div>
      </div>
    `;

    result.innerHTML = bannerHtml + timelineHtml + detailsHtml + cpgramsPanelHtml;
    result.hidden = false;

    // Attach copy button
    const copyBtn = document.getElementById("copy-reg-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(civicXReference || officialRegistration || record.id);
          copyBtn.textContent = "Copied!";
          window.setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
        } catch {
          copyBtn.textContent = "Copied";
        }
      });
    }

    // Toggle save status update form
    const toggleBtn = document.getElementById("toggle-save-form-btn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        saveForm.hidden = !saveForm.hidden;
        if (!saveForm.hidden) {
          saveForm.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }

    // Prepopulate save form fields
    fields.status.value = record.portal_status && record.portal_status !== "not_checked"
      ? record.portal_status.toLowerCase().replace(/\s+/g, "_")
      : "";
    fields.remarks.value = record.status_remarks || "";
    fields.date.value = record.status_date || "";
    fields.document.value = record.official_document_url || "";
  }

  async function findRecord(registrationNumber) {
    setError("");
    const cleanNum = registrationNumber.trim();
    if (!validRegistrationNumber(cleanNum)) {
      setError("Please enter a valid registration number.");
      return;
    }

    try {
      await window.CivicXAuth?.ready;
      const client = window.CivicXAuth?.client;
      const user = window.CivicXAuth?.user;
      if (!client || !user) {
        setError("Sign in to track your own CivicX reports. Private report references are never available to guests.");
        document.querySelector("[data-civicx-auth-trigger]")?.click();
        return;
      }
      if (client && user) {
        const accountReports = await window.CivicXReports.listForUser(client, user.id);
        const matchedReport = window.CivicXReports.findOwnedReport(accountReports, user.id, cleanNum);
        if (matchedReport) {
          currentRecord = {
            id: matchedReport.id,
            ownerId: matchedReport.ownerId,
            civicReport: true,
            civicx_reference: matchedReport.id,
            officialRegistration: matchedReport.officialRegistration || null,
            registration_number: matchedReport.officialRegistration || null,
            report_id: matchedReport.id,
            title: matchedReport.title,
            category: matchedReport.category,
            location: matchedReport.location,
            city: matchedReport.city,
            date: matchedReport.date,
            status: matchedReport.portalStatus || matchedReport.status,
            portal_status: matchedReport.portalStatus || "not_checked",
            status_remarks: matchedReport.portalStatusRemarks,
            status_date: matchedReport.portalStatusDate,
            official_document_url: matchedReport.portalDocumentUrl,
            priority: matchedReport.priority,
            description: matchedReport.description,
            department: "Municipal administration",
            historyEvents: matchedReport.events,
            is_resolved: isResolvedStatus(matchedReport.portalStatus || matchedReport.status)
          };
          showResult(currentRecord, cleanNum);
          return;
        }
        const { data, error: lookupError } = await client.from("complaint_tracking")
          .select("id,report_id,city,portal,registration_number,portal_status,status_remarks,status_date,official_document_url,checked_at,updated_at")
          .eq("user_id", user.id)
          .eq("portal", "CPGRAMS")
          .eq("registration_number", cleanNum)
          .maybeSingle();
        if (data && !lookupError) {
          currentRecord = data;
          showResult({
            id: data.report_id || data.registration_number,
            registration_number: data.registration_number,
            report_id: data.report_id,
            city: data.city || "India",
            status: data.portal_status || "Submitted",
            portal_status: data.portal_status,
            status_remarks: data.status_remarks,
            status_date: data.status_date,
            official_document_url: data.official_document_url,
            is_resolved: isResolvedStatus(data.portal_status)
          }, cleanNum);
          return;
        }
      }
    } catch (lookupError) {
      console.error("[CivicX tracking] Account lookup failed", {
        code: lookupError.code || "UNKNOWN",
        message: lookupError.message
      });
      setError("Could not retrieve account tracking data. Check your connection and database setup, then try again.");
      return;
    }

    // The result is intentionally account-scoped; guest/demo records are never returned.
    currentRecord = null;
    showResult(null, cleanNum);
  }

  // Handle tracking form submit
  document.getElementById("track-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const registrationNumber = registrationInput.value.trim();
    if (!registrationNumber) {
      setError("Please enter a registration number.");
      return;
    }
    await findRecord(registrationNumber);
  });

  // Handle saving status update
  saveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentIsCivicXReport = Boolean(currentRecord?.civicReport || currentRecord?.civicx_reference);
    const savedOfficialRegistration = currentRecord?.officialRegistration ||
      currentRecord?.official_registration || "";
    const regNum = currentIsCivicXReport
      ? savedOfficialRegistration.trim()
      : (registrationInput.value.trim() || currentRecord?.registration_number || "").trim();
    const selectedStatus = fields.status.value;
    const documentUrl = fields.document.value.trim();

    if (currentIsCivicXReport && !savedOfficialRegistration) {
      setError("A CivicX reference is not an official CPGRAMS number. Save the official CPGRAMS reference from the report details first.");
      return;
    }
    if (window.CivicXReports.isCivicXReference(regNum)) {
      setError("CivicX report references cannot be saved as CPGRAMS registration numbers.");
      return;
    }
    if (!regNum || !selectedStatus) {
      setError("Enter a registration number and select the current status.");
      return;
    }
    if (!validOfficialDocument(documentUrl)) {
      setError("Official document link must be a valid https://pgportal.gov.in link.");
      return;
    }

    saveButton.disabled = true;
    setError("");
    let statusSaved = false;
    try {
      await window.CivicXAuth?.ready;
      const client = window.CivicXAuth?.client;
      const user = window.CivicXAuth?.user;
      if (!client || !user) {
        setError("Sign in to save status updates to your private account.");
        document.querySelector("[data-civicx-auth-trigger]")?.click();
        return;
      }
      if (!window.CivicXAuth.trackingReady) {
        setError(window.CivicXAuth.trackingSetupMessage || "Private complaint tracking is not configured.");
        return;
      }

      const now = new Date().toISOString();
      const displayStatus = statusLabels[selectedStatus] || selectedStatus;
      const updatedRecord = {
        ...(currentRecord || {}),
        id: currentRecord?.id || regNum,
        registration_number: regNum,
        officialRegistration: currentIsCivicXReport ? savedOfficialRegistration : undefined,
        report_id: currentRecord?.civicReport ? currentRecord.id : currentRecord?.report_id || null,
        city: currentRecord?.city || "India",
        status: displayStatus,
        portal_status: displayStatus,
        status_remarks: fields.remarks.value.trim() || null,
        status_date: fields.date.value || null,
        official_document_url: documentUrl || null,
        checked_at: now,
        updated_at: now,
        is_resolved: isResolvedStatus(displayStatus)
      };
      const { error: saveError } = await client.from("complaint_tracking").upsert({
        user_id: user.id,
        report_id: updatedRecord.report_id,
        city: updatedRecord.city,
        portal: "CPGRAMS",
        registration_number: regNum,
        portal_status: displayStatus,
        status_remarks: updatedRecord.status_remarks,
        status_date: updatedRecord.status_date,
        official_document_url: updatedRecord.official_document_url,
        checked_at: now,
        updated_at: now
      }, { onConflict: "user_id,portal,registration_number" });
      if (saveError) throw saveError;
      statusSaved = true;

      if (currentRecord?.civicReport && currentRecord.ownerId === user.id) {
        const historyEvent = await window.CivicXReports.appendCitizenEvent(
          client,
          user.id,
          currentRecord.id,
          "citizen_status_check",
          "Citizen-recorded official portal status",
          updatedRecord.status_remarks,
          {
            status: displayStatus,
            status_date: updatedRecord.status_date,
            official_document_url: updatedRecord.official_document_url
          }
        );
        updatedRecord.historyEvents = [...(currentRecord.historyEvents || []), historyEvent];
      }
      currentRecord = updatedRecord;
      showResult(updatedRecord, regNum);
      saveForm.hidden = true;
      result.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (saveError) {
      console.error("[CivicX tracking] Status update could not be fully saved", {
        code: saveError.code || "UNKNOWN",
        message: saveError.message
      });
      setError(statusSaved
        ? "The status was saved, but its report-history entry could not be saved. Retry to record the history."
        : "The status was not saved to your account. Check your connection and tracking migration, then try again.");
      if (statusSaved && currentRecord) {
        currentRecord.portal_status = statusLabels[selectedStatus] || selectedStatus;
        currentRecord.status_remarks = fields.remarks.value.trim() || null;
        currentRecord.status_date = fields.date.value || null;
        currentRecord.official_document_url = documentUrl || null;
        showResult(currentRecord, regNum);
      }
    } finally {
      saveButton.disabled = false;
    }
  });

  // Handle query parameter
  if (query.has("registration")) {
    const val = query.get("registration").slice(0, 80).trim();
    if (val) {
      registrationInput.value = val;
      findRecord(val);
    }
  }
})();