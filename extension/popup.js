const reportInput = document.getElementById("report-json");
const message = document.getElementById("message");
const fillButton = document.getElementById("fill-form");
const allowedFields = new Set([
  "id", "category", "description", "location", "coordinates", "city",
  "department", "portal", "officialPortalUrl"
]);

function parseReport(value) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Paste a CivicX report object.");
  }
  if (Object.keys(parsed).some((key) => !allowedFields.has(key))) {
    throw new Error("The pasted data has fields this extension does not accept.");
  }
  if (typeof parsed.description !== "string" || typeof parsed.location !== "string" ||
      typeof parsed.category !== "string" || parsed.portal !== "CPGRAMS") {
    throw new Error("This does not look like a CivicX CPGRAMS report.");
  }
  return parsed;
}

fillButton.addEventListener("click", async () => {
  message.textContent = "";
  fillButton.disabled = true;
  try {
    const report = parseReport(reportInput.value);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || new URL(tab.url).hostname !== "pgportal.gov.in" ||
        !new URL(tab.url).pathname.toLowerCase().includes("lodgegrievance")) {
      throw new Error("Open the official CPGRAMS Lodge Public Grievance form first.");
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "CIVICX_FILL_FIELDS", report });
    if (!response?.ok) throw new Error(response?.message || "No supported form fields were found.");
    message.textContent = `${response.filled} field(s) filled. Review everything and submit on CPGRAMS yourself.`;
  } catch (error) {
    message.textContent = error.message || "Could not fill this page.";
  } finally {
    fillButton.disabled = false;
  }
});
