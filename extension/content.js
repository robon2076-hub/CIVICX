function controlText(control) {
  const labels = control.labels ? Array.from(control.labels).map((label) => label.textContent || "") : [];
  return [
    control.getAttribute("aria-label") || "",
    control.getAttribute("placeholder") || "",
    control.name || "",
    control.id || "",
    ...labels
  ].join(" ").toLowerCase();
}

function findControl(controls, expression) {
  return controls.find((control) => expression.test(controlText(control)));
}

function setValue(control, value) {
  if (!control || !value) return false;
  if (control instanceof HTMLSelectElement) {
    const option = Array.from(control.options).find((item) =>
      item.textContent.trim().toLowerCase().includes(String(value).toLowerCase())
    );
    if (!option) return false;
    control.value = option.value;
  } else {
    control.value = value;
  }
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CIVICX_FILL_FIELDS") return;
  if (!window.location.pathname.toLowerCase().includes("lodgegrievance")) {
    sendResponse({ ok: false, message: "Open the CPGRAMS Lodge Public Grievance form first." });
    return;
  }
  const report = message.report;
  if (!report || report.portal !== "CPGRAMS") {
    sendResponse({ ok: false, message: "Invalid CivicX report data." });
    return;
  }
  const controls = Array.from(document.querySelectorAll("textarea, input:not([type=hidden]):not([type=file]), select"))
    .filter((control) => !control.disabled && !control.readOnly &&
      !/captcha|otp|password|mobile|phone|email|name/i.test(controlText(control)));
  let filled = 0;
  filled += Number(setValue(findControl(controls, /grievance|complaint|description|brief/i), report.description));
  filled += Number(setValue(findControl(controls, /location|address|place|district|locality/i), report.location));
  const categoryControl = findControl(controls, /category|subject|sector|issue.?type/i);
  filled += Number(setValue(categoryControl, report.category));
  const departmentControl = findControl(controls, /ministry|department|organisation/i);
  filled += Number(setValue(departmentControl, report.department));
  sendResponse({
    ok: filled > 0,
    filled,
    message: filled ? "" : "No supported form fields were found. Use the copy fallback."
  });
});
