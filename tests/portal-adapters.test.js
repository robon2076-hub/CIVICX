const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cpgrams = require("../server/adapters/cpgrams-assisted");
const { createEmailChannel } = require("../server/adapters/email-channel");

test("CPGRAMS adapter prepares an assisted filing and manual status check", async () => {
  const filing = await cpgrams.file({ id: "CX-100", status: "Prepared (awaiting user filing)" });
  const status = await cpgrams.checkStatus("PG-100");
  assert.equal(filing.mode, "assisted");
  assert.equal(filing.status, "Prepared (awaiting user filing)");
  assert.equal(status.mode, "manual");
  assert.equal(status.officialUrl, "https://pgportal.gov.in/Status");
});

test("email channel requires consent and a registry-approved recipient", async () => {
  let sendCount = 0;
  const channel = createEmailChannel({
    authorityEmails: ["grievances@municipality.gov.in"],
    send: async () => { sendCount += 1; }
  });
  await assert.rejects(channel.file({ id: "CX-100" }, { consent: false, recipient: "grievances@municipality.gov.in" }), /consent/);
  await assert.rejects(channel.file({ id: "CX-100" }, { consent: true, recipient: "other@example.com" }), /registry/);
  assert.equal(sendCount, 0);
});

test("email delivery logs only after a successful send", async () => {
  const log = [];
  const channel = createEmailChannel({
    authorityEmails: ["grievances@municipality.gov.in"],
    send: async ({ report }) => assert.equal(report.id, "CX-100"),
    logDelivery: async (entry) => log.push(entry)
  });
  const result = await channel.file({ id: "CX-100" }, { consent: true, recipient: "grievances@municipality.gov.in" });
  assert.equal(result.status, "Sent to authority (email)");
  assert.equal(log.length, 1);
  assert.deepEqual(Object.keys(log[0]).sort(), ["outcome", "payloadType", "recipient", "reportId", "sentAt"]);
});

test("the CPGRAMS extension leaves verification, attachments, and submission to the user", () => {
  const contentScript = fs.readFileSync(path.join(__dirname, "..", "extension", "content.js"), "utf8");
  assert.match(contentScript, /captcha\|otp/);
  assert.match(contentScript, /input:not\(\[type=hidden\]\):not\(\[type=file\]\)/);
  assert.doesNotMatch(contentScript, /\b(?:requestSubmit|submit)\s*\(/i);
});
