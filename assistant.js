(() => {
  if (document.getElementById("civicx-assistant")) return;

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const messages = [];
  let selectedFile = null;
  let selectedCategory = "";
  let previewUrl = "";
  let busy = false;

  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  const root = make("aside", "cx-assistant", "");
  root.id = "civicx-assistant";
  root.setAttribute("aria-label", "Civic X Assistant");

  const launcher = make("button", "cx-assistant-launcher", "✧");
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open Civic X Assistant");
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "cx-assistant-panel");

  const panel = document.createElement("dialog");
  panel.className = "cx-assistant-panel";
  panel.id = "cx-assistant-panel";
  panel.setAttribute("aria-labelledby", "cx-assistant-title");

  const header = make("header", "cx-assistant-header");
  const titleGroup = make("div", "cx-assistant-heading");
  const title = make("h2", "", "Civic X Assistant");
  title.id = "cx-assistant-title";
  titleGroup.append(title, make("p", "", "Prepare a civic issue report"));
  const closeButton = make("button", "cx-assistant-close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close Civic X Assistant");
  header.append(titleGroup, closeButton);

  const notice = make("p", "cx-assistant-notice",
    "Your photo and message are sent to the AI service for analysis. Photos are processed in memory and are not saved by Civic X.");
  const log = make("div", "cx-assistant-messages");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-relevant", "additions text");

  const welcome = make("div", "cx-assistant-welcome");
  welcome.append(make("p", "", "Hi, I can help prepare a civic issue report or explain how to use this website."));
  const quickReplies = make("div", "cx-assistant-quick-replies");
  quickReplies.setAttribute("aria-label", "Quick replies");
  const reportQuickReply = make("button", "", "Report an issue");
  reportQuickReply.type = "button";
  reportQuickReply.dataset.quickReply = "report";
  const photoQuickReply = make("button", "", "Upload a photo");
  photoQuickReply.type = "button";
  photoQuickReply.dataset.quickReply = "photo";
  const trackQuickReply = make("button", "", "Track my report");
  trackQuickReply.type = "button";
  trackQuickReply.dataset.quickReply = "track";
  const helpQuickReply = make("button", "", "How does this work?");
  helpQuickReply.type = "button";
  helpQuickReply.dataset.quickReply = "help";
  quickReplies.append(reportQuickReply, photoQuickReply, trackQuickReply, helpQuickReply);
  welcome.append(quickReplies);

  const attachment = make("div", "cx-assistant-attachment");
  attachment.hidden = true;
  const preview = document.createElement("img");
  preview.alt = "Selected civic issue photo preview";
  const attachmentName = make("span", "", "");
  const removeAttachment = make("button", "cx-assistant-remove-attachment", "×");
  removeAttachment.type = "button";
  removeAttachment.setAttribute("aria-label", "Remove selected photo");
  attachment.append(preview, attachmentName, removeAttachment);

  const form = make("form", "cx-assistant-form");
  const fileLabel = make("label", "cx-assistant-attach", "＋");
  fileLabel.htmlFor = "cx-assistant-file";
  fileLabel.setAttribute("aria-label", "Choose or take a civic issue photo");
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.id = "cx-assistant-file";
  fileInput.accept = "image/jpeg,image/png,image/webp";
  fileInput.setAttribute("capture", "environment");
  fileInput.className = "cx-assistant-file-input";
  const inputLabel = make("label", "cx-assistant-sr-only", "Message the Civic X Assistant");
  inputLabel.htmlFor = "cx-assistant-input";
  const input = document.createElement("textarea");
  input.id = "cx-assistant-input";
  input.rows = 2;
  input.maxLength = 1200;
  input.placeholder = "Describe what you noticed…";
  const send = make("button", "cx-assistant-send", "Send");
  send.type = "submit";
  form.append(fileLabel, fileInput, inputLabel, input, send);
  const status = make("p", "cx-assistant-status", "You review every suggestion before using the report form.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  panel.append(header, notice, welcome, log, attachment, form, status);
  root.append(launcher, panel);
  document.body.append(root);
  if (document.getElementById("dashboard-floating-ai")) {
    document.body.classList.add("cx-has-dashboard-chat");
  }

  function scrollToLatest() {
    log.scrollTop = log.scrollHeight;
  }

  function addMessage(role, text, keepInHistory = true) {
    const bubble = make("div", `cx-assistant-message cx-assistant-message--${role}`, text);
    log.append(bubble);
    if (keepInHistory && ["user", "assistant"].includes(role)) {
      messages.push({ role, content: text });
      if (messages.length > 10) messages.splice(0, messages.length - 10);
    }
    scrollToLatest();
    return bubble;
  }

  function openPanel() {
    if (!panel.open) panel.showModal();
    launcher.setAttribute("aria-expanded", "true");
    window.setTimeout(() => input.focus(), 0);
  }

  function closePanel() {
    if (panel.open) panel.close();
  }

  function setAttachment(file) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    selectedFile = file;
    previewUrl = file ? URL.createObjectURL(file) : "";
    if (!file) {
      attachment.hidden = true;
      fileInput.value = "";
      return;
    }
    preview.src = previewUrl;
    attachmentName.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
    attachment.hidden = false;
  }

  function addManualReportButton(text, category = "") {
    const action = make("button", "cx-assistant-inline-action", "Report manually");
    action.type = "button";
    action.addEventListener("click", () => openReportForm({
      category,
      description: text.trim()
    }));
    const wrapper = make("div", "cx-assistant-message cx-assistant-message--assistant");
    wrapper.append(action);
    log.append(wrapper);
    scrollToLatest();
  }

  function renderCategoryChips(categories) {
    if (!Array.isArray(categories) || categories.length === 0) return;
    const group = make("div", "cx-assistant-category-list");
    group.setAttribute("aria-label", "Choose a report category");
    categories.forEach((category) => {
      const chip = make("button", "", category);
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(selectedCategory === category));
      chip.addEventListener("click", () => {
        selectedCategory = category;
        group.querySelectorAll("button").forEach((button) => {
          button.setAttribute("aria-pressed", String(button.textContent === category));
        });
        input.placeholder = `Describe the ${category} issue…`;
        input.focus();
        status.textContent = `${category} selected. Add a description, then send it for analysis.`;
      });
      group.append(chip);
    });
    const wrapper = make("div", "cx-assistant-message cx-assistant-message--assistant");
    wrapper.append(group);
    log.append(wrapper);
    scrollToLatest();
  }

  function addSuggestedReport(analysis) {
    const card = make("article", "cx-assistant-report-card");
    const heading = make("h3", "", "Suggested report");
    const details = make("dl", "");
    const fields = [
      ["Category", analysis.category],
      ["Title", analysis.title],
      ["Description", analysis.description],
      ["Observed", new Date(analysis.date_observed).toLocaleString()],
      ["Severity", `${analysis.severity} — ${analysis.severity_reason}`]
    ];
    if (analysis.location_hint) fields.push(["Visible location clue", analysis.location_hint]);
    fields.forEach(([label, value]) => {
      const term = make("dt", "", label);
      const description = make("dd", "", value);
      details.append(term, description);
    });
    const useButton = make("button", "cx-assistant-use-report", "Use this to report");
    useButton.type = "button";
    useButton.addEventListener("click", () => {
      const description = `Suggested title: ${analysis.title}\nSuggested severity: ${analysis.severity}\n\n${analysis.description}`;
      openReportForm({ category: analysis.category, description });
    });
    card.append(heading, details, useButton);
    const wrapper = make("div", "cx-assistant-message cx-assistant-message--assistant");
    wrapper.append(card);
    log.append(wrapper);
    scrollToLatest();
  }

  function openReportForm(draft) {
    const reportDraft = {
      category: typeof draft.category === "string" ? draft.category : "",
      description: typeof draft.description === "string" ? draft.description.slice(0, 2500) : "",
      expiresAt: Date.now() + 5 * 60_000
    };
    if (window.location.pathname.endsWith("dashboard.html")) {
      window.dispatchEvent(new CustomEvent("civicx-assistant-report-draft", { detail: reportDraft }));
      return;
    }
    if (typeof BroadcastChannel !== "function" || !window.crypto?.getRandomValues) {
      addMessage("assistant", "This browser cannot transfer the draft privately. It remains visible here; copy it and open the Dashboard to report manually.");
      return;
    }

    const tokenBytes = new Uint8Array(16);
    window.crypto.getRandomValues(tokenBytes);
    const token = [...tokenBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const channel = new BroadcastChannel(`civicx-assistant-report-${token}`);
    const dashboard = window.open(`dashboard.html?assistant-draft=${token}`, "_blank");
    if (!dashboard) {
      channel.close();
      addMessage("assistant", "Your browser blocked the Dashboard tab. The suggested report remains visible here; copy its category and description, then open the Dashboard manually.");
      return;
    }

    let pendingDraft = reportDraft;
    const timeout = window.setTimeout(() => {
      channel.close();
      pendingDraft = null;
      addMessage("assistant", "The Dashboard did not receive the draft. It remains visible here; copy the category and description into the report form.");
    }, 15000);
    channel.onmessage = (event) => {
      if (event.data?.type === "ready" && pendingDraft) {
        channel.postMessage({ type: "draft", draft: pendingDraft });
        return;
      }
      if (event.data?.type === "received") {
        window.clearTimeout(timeout);
        pendingDraft = null;
        channel.close();
      }
    };
  }

  function waitForDialog(dialog) {
    if (dialog.open) return Promise.resolve(true);
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!dialog.open) return;
        observer.disconnect();
        window.clearTimeout(timeout);
        resolve(true);
      });
      observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        resolve(dialog.open);
      }, 10000);
    });
  }

  function isValidReportDraft(draft) {
    return draft && typeof draft === "object" &&
      typeof draft.category === "string" && draft.category.length <= 160 &&
      typeof draft.description === "string" && draft.description.length <= 2500 &&
      Number.isFinite(draft.expiresAt) && draft.expiresAt > Date.now();
  }

  function openExistingReportForm(draft) {
    if (!isValidReportDraft(draft)) {
      status.textContent = "The draft expired before the report form opened. No report was submitted.";
      return;
    }
    const auth = window.CivicXAuth;
    const trigger = document.querySelector("[data-open-report]");
    const dialog = document.getElementById("report-dialog");
    if (!auth || !trigger || !dialog) return;

    let started = false;
    let loginRequested = false;
    let unsubscribe = () => {};
    const openAndFill = async () => {
      started = true;
      unsubscribe();
      trigger.click();
      if (!await waitForDialog(dialog)) {
        status.textContent = "The existing report form could not be opened. No report was submitted.";
        return;
      }
      const category = document.getElementById("report-category");
      const description = document.getElementById("report-description");
      if (category && draft.category && [...category.options].some((option) => option.value === draft.category)) {
        category.value = draft.category;
        category.dispatchEvent(new Event("input", { bubbles: true }));
        category.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (description && draft.description) {
        description.value = draft.description;
        description.dispatchEvent(new Event("input", { bubbles: true }));
        description.dispatchEvent(new Event("change", { bubbles: true }));
        description.focus();
      }
    };
    const handleAuthChange = (state) => {
      if (started) return;
      if (state.user && state.reportsReady) {
        void openAndFill();
        return;
      }
      if (!state.user && state.configured && !loginRequested) {
        loginRequested = true;
        trigger.click();
      }
    };

    void auth.ready.then(() => {
      unsubscribe = auth.onChange(handleAuthChange);
      if (started) unsubscribe();
    });
  }

  function receiveReportDraft() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("assistant-draft");
    if (!token) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
    if (!/^[0-9a-f]{32}$/i.test(token) || typeof BroadcastChannel !== "function") return;
    const channel = new BroadcastChannel(`civicx-assistant-report-${token}`);
    const timeout = window.setTimeout(() => channel.close(), 30000);
    channel.onmessage = (event) => {
      if (event.data?.type !== "draft" || !isValidReportDraft(event.data.draft)) return;
      window.clearTimeout(timeout);
      channel.postMessage({ type: "received" });
      channel.close();
      openExistingReportForm(event.data.draft);
    };
    channel.postMessage({ type: "ready" });
  }

  window.addEventListener("civicx-assistant-report-draft", (event) => {
    if (isValidReportDraft(event.detail)) openExistingReportForm(event.detail);
  });

  async function sendMessage(event) {
    event.preventDefault();
    if (busy) return;
    const message = input.value.trim();
    if (!message && !selectedFile) {
      input.focus();
      status.textContent = "Type a short description or choose a photo.";
      return;
    }
    const requestHistory = messages.slice(-9);
    addMessage("user", message || "Please analyze this photo.");
    const typing = addMessage("assistant", "Civic X Assistant is typing…", false);
    typing.classList.add("cx-assistant-typing");
    busy = true;
    send.disabled = true;
    status.textContent = "Analyzing your message. This may take a moment.";
    try {
      const body = new FormData();
      body.append("message", message);
      body.append("history", JSON.stringify(requestHistory));
      body.append("category", selectedCategory);
      if (selectedFile) body.append("image", selectedFile);
      let response;
      try {
        response = await fetch("/api/assistant/analyze", { method: "POST", body });
      } catch {
        throw new Error("This feature needs the CIVICX server. Your message and photo are still here.");
      }
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : null;
      typing.remove();
      if (response.status === 404 || !contentType.includes("application/json") || !payload) {
        throw new Error("This feature needs the CIVICX server. Your message and photo are still here.");
      }
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error || "The assistant is temporarily unavailable. Try again or report manually.");
      }
      const analysis = payload.analysis;
      addMessage("assistant", analysis.user_message);
      if (payload.fallback) {
        if (analysis.follow_up_questions.length) {
          addMessage("assistant", analysis.follow_up_questions.join("\n"));
        }
        renderCategoryChips(payload.categories);
        status.textContent = "Choose a category and add any missing details. No report has been submitted.";
      } else if (payload.suggested_report) {
        addSuggestedReport(analysis);
        status.textContent = "This is only a draft. Review and submit it yourself in the report form.";
        input.value = "";
        selectedCategory = "";
        setAttachment(null);
      } else {
        status.textContent = "No report was created. Ask another website question or describe a civic issue.";
        input.value = "";
        setAttachment(null);
      }
    } catch (error) {
      typing.remove();
      addMessage("assistant", error.message || "The assistant is unavailable. Your message and photo are still here.");
      addManualReportButton(message, selectedCategory);
      status.textContent = "Your message and selected photo remain in this chat.";
    } finally {
      busy = false;
      send.disabled = false;
      scrollToLatest();
    }
  }

  launcher.addEventListener("click", openPanel);
  closeButton.addEventListener("click", closePanel);
  panel.addEventListener("close", () => {
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  });
  form.addEventListener("submit", (event) => void sendMessage(event));
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0] || null;
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAttachment(null);
      status.textContent = "Choose a JPG, PNG, or WEBP photo.";
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAttachment(null);
      status.textContent = "That photo is over 5 MB. Choose a smaller image.";
      return;
    }
    setAttachment(file);
    status.textContent = "Photo selected. It will be sent only for this analysis.";
  });
  removeAttachment.addEventListener("click", () => {
    setAttachment(null);
    status.textContent = "Photo removed.";
  });
  quickReplies.addEventListener("click", (event) => {
    const action = event.target.closest("[data-quick-reply]")?.dataset.quickReply;
    if (action === "report") {
      input.value = "I want to report a civic issue.";
      input.focus();
    } else if (action === "photo") {
      fileInput.click();
    } else if (action === "track") {
      window.location.assign("dashboard.html#my-reports");
    } else if (action === "help") {
      input.value = "How does this website help me prepare and track a civic report?";
      input.focus();
    }
  });

  receiveReportDraft();
})();
