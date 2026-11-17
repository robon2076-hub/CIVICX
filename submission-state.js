(function (root, factory) {
  const submissionState = factory();
  if (typeof module === "object" && module.exports) module.exports = submissionState;
  else root.CivicXSubmissionState = submissionState;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const AWAITING_VERIFICATION = "Awaiting official verification";

  function isOfficiallyAccepted(report) {
    const acceptance = report && report.officialSubmission;
    return Boolean(
      acceptance &&
      acceptance.status === "accepted" &&
      acceptance.verified === true &&
      typeof acceptance.registrationNumber === "string" &&
      acceptance.registrationNumber === report.registrationNumber
    );
  }

  function recordUserEnteredNumber(report, registrationNumber) {
    return {
      ...report,
      registrationNumber,
      status: AWAITING_VERIFICATION,
      submissionState: "awaiting_official_verification",
      statusSource: "user-entered; not verified by CivicX"
    };
  }

  function normalizeStoredReport(report) {
    if (isOfficiallyAccepted(report)) return report;
    if (report.status !== "Filed") return report;
    return {
      ...report,
      status: AWAITING_VERIFICATION,
      submissionState: "awaiting_official_verification",
      statusSource: "legacy user-entered status; not verified by CivicX"
    };
  }

  return {
    AWAITING_VERIFICATION,
    isOfficiallyAccepted,
    recordUserEnteredNumber,
    normalizeStoredReport
  };
});
