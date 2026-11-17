(() => {
  const HISTORY_KEY = "civicx-ai-chat-history-v1";
  const MAX_HISTORY_TURNS = 20;
  const panel = document.getElementById("civicx-chat-panel");
  const launcher = document.getElementById("civicx-chat-launcher");
  const closeButton = document.getElementById("civicx-chat-close");
  const newChatButton = document.getElementById("civicx-chat-new");
  const welcome = document.getElementById("civicx-chat-welcome");
  const messagesElement = document.getElementById("civicx-chat-messages");
  const form = document.getElementById("civicx-chat-form");
  const input = document.getElementById("civicx-chat-input");
  const sendButton = document.getElementById("civicx-chat-send");
  const fileInput = document.getElementById("civicx-chat-file");
  const attachmentPreview = document.getElementById("civicx-chat-attachment");
  const attachmentThumbnail = document.getElementById("civicx-chat-thumbnail");
  const attachmentLabel = document.getElementById("civicx-chat-attachment-label");
  const status = document.getElementById("civicx-chat-status");
  let busy = false;
  let preparingPhoto = false;
  let attachment = null;
  let attachmentWarning = "";
  let chatHistory = loadHistory();

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

  function loadHistory() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]");
      if (!Array.isArray(saved)) return [];
      const normalized = [];
      for (const turn of saved) {
        const role = turn?.role;
        const text = turn?.parts?.[0]?.text;
        const expectedRole = normalized.length % 2 === 0 ? "user" : "model";
        if (role !== expectedRole || !Array.isArray(turn.parts) ||
            turn.parts.length !== 1 || typeof text !== "string" ||
            !text.trim() || text.length > 2000) break;
        normalized.push({ role, parts: [{ text }] });
      }
      const completedTurns = normalized.length - (normalized.length % 2);
      return normalized.slice(Math.max(0, completedTurns - MAX_HISTORY_TURNS), completedTurns);
    } catch (error) {
      status.textContent = `Chat history could not be restored: ${error.message}`;
      return [];
    }
  }

  function saveHistory() {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(chatHistory));
      return true;
    } catch (error) {
      status.textContent = `Chat history could not be saved in this tab: ${error.message}`;
      return false;
    }
  }

  function appendInlineFormatting(container, text) {
    const pieces = text.split(/(\*\*[^*]+\*\*)/g);
    pieces.forEach((piece) => {
      if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) {
        const strong = document.createElement("strong");
        strong.textContent = piece.slice(2, -2);
        container.append(strong);
      } else {
        container.append(document.createTextNode(piece));
      }
    });
  }

  function renderFormattedText(container, text) {
    let paragraph = null;
    let list = null;
    const flushParagraph = () => {
      if (paragraph) container.append(paragraph);
      paragraph = null;
    };
    const flushList = () => {
      if (list) container.append(list);
      list = null;
    };
    String(text).split(/\r?\n/).forEach((line) => {
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        if (!list) list = document.createElement("ul");
        const item = document.createElement("li");
        appendInlineFormatting(item, bullet[1]);
        list.append(item);
        return;
      }
      flushList();
      if (!line.trim()) {
        flushParagraph();
        return;
      }
      if (!paragraph) paragraph = document.createElement("p");
      else paragraph.append(document.createElement("br"));
      appendInlineFormatting(paragraph, line);
    });
    flushParagraph();
    flushList();
  }

  function appendMessage(role, text, options = {}) {
    const message = document.createElement("article");
    message.className = `civicx-chat-message ${role}`;
    if (options.imageUrl) {
      const image = document.createElement("img");
      image.className = "civicx-chat-message-image";
      image.src = options.imageUrl;
      image.alt = "Locally redacted civic issue photo";
      message.append(image);
    }
    const content = document.createElement("div");
    content.className = "civicx-chat-message-content";
    if (role === "assistant") renderFormattedText(content, text);
    else {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      content.append(paragraph);
    }
    message.append(content);
    if (options.copy) {
      const copyButton = document.createElement("button");
      copyButton.className = "civicx-chat-copy";
      copyButton.type = "button";
      copyButton.textContent = "Copy";
      copyButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text);
          status.textContent = "Reply copied.";
        } catch (error) {
          status.textContent = `Could not copy the reply: ${error.message}`;
        }
      });
      message.append(copyButton);
    }
    messagesElement.append(message);
    messagesElement.scrollTop = messagesElement.scrollHeight;
    return message;
  }

  function appendTypingBubble() {
    const bubble = document.createElement("article");
    bubble.className = "civicx-chat-message assistant civicx-chat-typing";
    bubble.setAttribute("aria-label", "CivicX AI is typing");
    const label = document.createElement("span");
    label.textContent = "CivicX AI is typing";
    const dots = document.createElement("span");
    dots.className = "typing-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) dots.append(document.createElement("i"));
    bubble.append(label, dots);
    messagesElement.append(bubble);
    messagesElement.scrollTop = messagesElement.scrollHeight;
    return bubble;
  }

  function appendError(message, retry) {
    const bubble = document.createElement("article");
    bubble.className = "civicx-chat-message civicx-chat-error";
    const text = document.createElement("p");
    text.textContent = message;
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "civicx-chat-retry";
    retryButton.textContent = "Retry";
    retryButton.addEventListener("click", retry);
    bubble.append(text, retryButton);
    messagesElement.append(bubble);
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  function openChat() {
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    input.focus();
  }

  function closeChat() {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }

  function setBusy(value) {
    busy = value;
    input.disabled = value || preparingPhoto;
    sendButton.disabled = value || preparingPhoto;
    newChatButton.disabled = value || preparingPhoto;
    fileInput.disabled = value || preparingPhoto;
    document.getElementById("civicx-chat-remove-attachment").disabled = value || preparingPhoto;
  }

  function releaseAttachment() {
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    attachment = null;
    attachmentWarning = "";
    attachmentPreview.hidden = true;
    attachmentThumbnail.removeAttribute("src");
    fileInput.value = "";
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        const separator = dataUrl.indexOf(",");
        if (separator < 0) {
          reject(new Error("The redacted photo could not be encoded."));
          return;
        }
        resolve(dataUrl.slice(separator + 1));
      };
      reader.onerror = () => reject(reader.error || new Error("The redacted photo could not be read."));
      reader.readAsDataURL(file);
    });
  }

  async function prepareAttachment(file) {
    releaseAttachment();
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        !file.size || file.size > 8 * 1024 * 1024) {
      attachmentWarning = "I couldn't read the attached photo, so the reply will be based only on your text.";
      status.textContent = "Choose a JPG, PNG, or WebP photo up to 8 MB. You can still send a text description.";
      fileInput.value = "";
      return;
    }
    preparingPhoto = true;
    setBusy(busy);
    status.textContent = "Redacting faces and license plates on this device…";
    try {
      const privacy = await imagePrivacyReady;
      const redacted = await privacy.redactPhoto(file);
      const redactedFile = await privacy.applyManualRegions(redacted);
      const base64 = await fileToBase64(redactedFile);
      const previewUrl = URL.createObjectURL(redactedFile);
      attachment = { image: base64, mimeType: redactedFile.type, previewUrl };
      attachmentThumbnail.src = previewUrl;
      attachmentPreview.hidden = false;
      attachmentLabel.textContent = `Redacted preview ready (${redacted.faceCount} faces, ${redacted.plateCount} plates covered). Review before sending.`;
      status.textContent = "The original photo stays on this device. Only the redacted preview can be attached.";
    } catch (error) {
      attachmentWarning = "I couldn't read the attached photo, so the reply will be based only on your text.";
      status.textContent = `${error.message || "Photo privacy processing failed. The photo was not attached."} You can still send a text description.`;
    } finally {
      preparingPhoto = false;
      setBusy(busy);
      fileInput.value = "";
    }
  }

  function renderHistory() {
    if (!chatHistory.length) return;
    welcome.hidden = true;
    for (let index = 0; index < chatHistory.length; index += 2) {
      appendMessage("user", chatHistory[index].parts[0].text);
      appendMessage("assistant", chatHistory[index + 1].parts[0].text, { copy: true });
    }
  }

  async function requestReply(message, historyBefore, photo, historyText, photoWarning = "") {
    setBusy(true);
    status.textContent = "";
    const typing = appendTypingBubble();
    try {
      const body = { message, history: historyBefore };
      if (photo) {
        body.image = photo.image;
        body.mimeType = photo.mimeType;
      }
      const { data: sessionData, error: sessionError } = await window.CivicXAuth.client.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again to use CivicX AI.");
      let response;
      try {
        response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify(body)
        });
      } catch {
        throw new Error("This feature needs the CIVICX server. Your message is still available in the chat.");
      }
      const contentType = response.headers.get("content-type") || "";
      const result = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : null;
      if (response.status === 404 || !contentType.includes("application/json") || !result) {
        throw new Error("This feature needs the CIVICX server. Your message is still available in the chat.");
      }
      if (!response.ok || !result?.ok || typeof result.reply !== "string" || !result.reply.trim()) {
        const messageText = result?.error || result?.message ||
          `CivicX AI is temporarily unavailable (HTTP ${response.status}).`;
        throw new Error(messageText);
      }
      const replyText = photoWarning ? `${result.reply}\n\n${photoWarning}` : result.reply;

      typing.remove();
      appendMessage("assistant", replyText, { copy: true });
      chatHistory = [
        ...historyBefore,
        { role: "user", parts: [{ text: historyText }] },
        { role: "model", parts: [{ text: replyText }] }
      ].slice(-MAX_HISTORY_TURNS);
      const saved = saveHistory();
      if (attachment === photo) releaseAttachment();
      input.value = "";
      if (saved) status.textContent = "Chat history is stored only for this browser tab.";
    } catch (error) {
      typing.remove();
      const errorMessage = error.message || "CivicX AI could not answer. Please try again.";
      appendError(errorMessage, () => requestReply(message, historyBefore, photo, historyText, photoWarning));
      status.textContent = "No AI answer was generated. Your message was not added to chat history.";
    } finally {
      setBusy(false);
      if (!panel.hidden && !preparingPhoto) input.focus();
    }
  }

  async function sendMessage(message) {
    if (busy || preparingPhoto) return;
    const text = String(message || "").trim();
    const photo = attachment;
    if (!text) {
      status.textContent = "Type a short description of the issue. CivicX AI cannot identify it from a photo alone.";
      input.focus();
      return;
    }
    const prompt = text;
    const photoWarning = attachmentWarning;
    const historyBefore = chatHistory.slice();
    const historyText = photo
      ? `${prompt}\n[Photo attached as supporting evidence; not analyzed]`
      : photoWarning ? `${prompt}\n[Photo could not be read]` : prompt;
    welcome.hidden = true;
    appendMessage("user", prompt, { imageUrl: photo?.previewUrl });
    await requestReply(prompt, historyBefore, photo, historyText, photoWarning);
  }

  document.querySelectorAll("[data-chat-open]").forEach((button) => {
    button.addEventListener("click", openChat);
  });
  document.querySelectorAll("[data-chat-prompt]").forEach((button) => {
    button.addEventListener("click", () => sendMessage(button.dataset.chatPrompt || ""));
  });
  closeButton.addEventListener("click", closeChat);
  newChatButton.addEventListener("click", () => {
    if (busy || preparingPhoto) return;
    chatHistory = [];
    let message = "Started a new chat. History is stored only for this browser tab.";
    try {
      sessionStorage.removeItem(HISTORY_KEY);
    } catch (error) {
      message = `The previous chat could not be cleared from this tab: ${error.message}`;
    }
    messagesElement.replaceChildren();
    welcome.hidden = false;
    input.value = "";
    releaseAttachment();
    status.textContent = message;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });
  fileInput.addEventListener("change", () => {
    prepareAttachment(fileInput.files?.[0]);
  });
  document.getElementById("civicx-chat-remove-attachment").addEventListener("click", releaseAttachment);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closeChat();
  });

  renderHistory();
})();
