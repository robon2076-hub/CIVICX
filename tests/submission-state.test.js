const test = require("node:test");
const assert = require("node:assert/strict");
const submissionState = require("../submission-state");

test("a user-entered portal number is not an official filing", () => {
  const report = submissionState.recordUserEnteredNumber(
    { id: "CX-100", status: "Prepared (awaiting user filing)" },
    "PG-100"
  );
  assert.equal(report.registrationNumber, "PG-100");
  assert.equal(report.status, "Awaiting official verification");
  assert.equal(report.submissionState, "awaiting_official_verification");
  assert.equal(submissionState.isOfficiallyAccepted(report), false);
});

test("legacy locally filed labels are downgraded unless verified acceptance exists", () => {
  const legacy = submissionState.normalizeStoredReport({
    id: "CX-101",
    registrationNumber: "PG-101",
    status: "Filed",
    statusSource: "registration number entered by the user"
  });
  assert.equal(legacy.status, "Awaiting official verification");
  assert.equal(submissionState.isOfficiallyAccepted(legacy), false);
});

test("only a matching verified official acceptance is considered filed", () => {
  const accepted = {
    registrationNumber: "KMC-123",
    officialSubmission: {
      status: "accepted",
      verified: true,
      registrationNumber: "KMC-123"
    }
  };
  assert.equal(submissionState.isOfficiallyAccepted(accepted), true);
  assert.equal(submissionState.isOfficiallyAccepted({
    ...accepted,
    officialSubmission: { ...accepted.officialSubmission, registrationNumber: "KMC-OTHER" }
  }), false);
});
