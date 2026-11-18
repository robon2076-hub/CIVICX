const test = require("node:test");
const assert = require("node:assert/strict");
const civicReports = require("../civicx-reports");

function sampleReport() {
  return {
    id: "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda",
    category: "Pothole",
    title: "Road damage near the crossing",
    city: "Kolkata",
    jurisdictionKey: "kolkata",
    location: "Park Circus, Kolkata",
    area: "Park Circus",
    description: "A deep pothole is slowing traffic near the crossing.",
    coordinates: [22.5398, 88.3651],
    status: "Prepared (awaiting user filing)",
    priority: "High",
    registrationNumber: "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda"
  };
}

test("report creation binds the row and private attachment path to the authenticated account", async () => {
  const uploaded = [];
  let inserted;
  const client = {
    storage: {
      from(bucket) {
        assert.equal(bucket, "civic-report-attachments");
        return {
          async upload(path, blob, options) {
            uploaded.push({ path, blob, options });
            return { error: null };
          }
        };
      }
    },
    from(table) {
      assert.equal(table, "civic_reports");
      return {
        insert(row) {
          inserted = row;
          return {
            select() {
              return {
                async single() {
                  return { data: { ...row, created_at: "2026-11-16T00:00:00.000Z" }, error: null };
                }
              };
            }
          };
        }
      };
    }
  };
  const user = { id: "4e2ebcc8-63ba-4dcf-a207-9a039a33a6c1" };
  const photo = new Blob(["private photo bytes"], { type: "image/jpeg" });
  const saved = await civicReports.create(client, user, sampleReport(), photo);

  assert.equal(inserted.user_id, user.id);
  assert.equal(inserted.id, sampleReport().id);
  assert.equal(inserted.jurisdiction_key, sampleReport().jurisdictionKey);
  assert.equal(inserted.photo_path, `${user.id}/${inserted.id}/issue-photo.jpg`);
  assert.equal(uploaded[0].path, inserted.photo_path);
  assert.equal(uploaded[0].options.contentType, "image/jpeg");
  assert.equal(saved.ownerId, user.id);
  assert.deepEqual(saved.coordinates, sampleReport().coordinates);
  assert.equal(saved.isMine, true);
});

test("a report insert failure removes its unattached private photo and does not return success", async () => {
  const removed = [];
  const insertError = new Error("database unavailable");
  const client = {
    storage: {
      from() {
        return {
          async upload() { return { error: null }; },
          async remove(paths) { removed.push(...paths); return { error: null }; }
        };
      }
    },
    from() {
      return {
        insert() {
          return {
            select() {
              return { async single() { return { data: null, error: insertError }; } };
            }
          };
        }
      };
    }
  };
  const user = { id: "4e2ebcc8-63ba-4dcf-a207-9a039a33a6c1" };

  await assert.rejects(
    civicReports.create(client, user, sampleReport(), new Blob(["photo"], { type: "image/jpeg" })),
    insertError
  );
  assert.deepEqual(removed, [`${user.id}/${sampleReport().id}/issue-photo.jpg`]);
});

test("report attachments must be JPEGs within the actual 10 MiB upload limit", async () => {
  let uploaded = false;
  const client = {
    storage: {
      from() {
        return { async upload() { uploaded = true; return { error: null }; } };
      }
    }
  };
  const user = { id: "4e2ebcc8-63ba-4dcf-a207-9a039a33a6c1" };

  await assert.rejects(
    civicReports.create(client, user, sampleReport(), new Blob(["png"], { type: "image/png" })),
    /compressed JPEG/
  );
  await assert.rejects(
    civicReports.create(client, user, sampleReport(), {
      type: "image/jpeg",
      size: 10 * 1024 * 1024 + 1
    }),
    /10 MiB/
  );
  assert.equal(uploaded, false);
});

test("CivicX references are distinguishable from official CPGRAMS references", () => {
  assert.equal(civicReports.isCivicXReference("CX-2418"), true);
  assert.equal(civicReports.isCivicXReference("cx-8f97e0ca-5275-4db4-b6ec-b924efa96cda"), true);
  assert.equal(civicReports.isCivicXReference("2026/11/1234"), false);
});

test("report reference lookup is restricted to the signed-in report owner", () => {
  const reports = [{
    id: "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda",
    ownerId: "account-1",
    registrationNumber: "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda",
    officialRegistration: null
  }, {
    id: "CX-other-report",
    ownerId: "account-2",
    registrationNumber: "CX-other-report",
    officialRegistration: null
  }];

  assert.equal(
    civicReports.findOwnedReport(reports, "account-1", "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda")?.id,
    "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda"
  );
  assert.equal(
    civicReports.findOwnedReport(reports, "account-1", "CX-other-report"),
    null
  );
  assert.equal(civicReports.findOwnedReport(reports, null, "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda"), null);
});

test("tracker reference formatting never presents a CivicX ID as an official CPGRAMS number", () => {
  assert.deepEqual(
    civicReports.getReportReferences({ id: "CX-2418" }),
    { civicXReference: "CX-2418", officialRegistration: null }
  );
  assert.deepEqual(
    civicReports.getReportReferences({
      id: "CX-2418",
      registration_number: "CX-2418",
      civicReport: true,
      officialRegistration: "2026/11/1234"
    }),
    { civicXReference: "CX-2418", officialRegistration: "2026/11/1234" }
  );
  assert.deepEqual(
    civicReports.getReportReferences({ id: "report-id", registration_number: "2026/11/1234" }),
    { civicXReference: null, officialRegistration: "2026/11/1234" }
  );
  assert.deepEqual(
    civicReports.getReportReferences({ id: "report-id", registration_number: "CX-2418" }),
    { civicXReference: "CX-2418", officialRegistration: null }
  );
});

test("database rows preserve report owner, current status, coordinates, and audit history", () => {
  const report = civicReports.toReport({
    id: "CX-report-1",
    user_id: "account-1",
    category: "Garbage",
    title: "Overflowing bin",
    city: "Delhi, India",
    location: "Market Road",
    area: "Market",
    description: "Waste is collecting around the public bin.",
    latitude: 28.6,
    longitude: 77.2,
    status: "In progress",
    priority: "Medium",
    registration_number: "CX-report-1",
    created_at: "2026-11-16T00:00:00.000Z"
  }, [{ event_type: "authority_action", summary: "Authority status update" }]);

  assert.equal(report.ownerId, "account-1");
  assert.equal(report.status, "In progress");
  assert.deepEqual(report.coordinates, [28.6, 77.2]);
  assert.equal(report.events[0].event_type, "authority_action");
});

test("dashboard status summary separates pending, review, resolved, disputed, and reopened reports", () => {
  const counts = civicReports.summarizeStatuses([
    { status: "Prepared (awaiting user filing)" },
    { status: "In progress" },
    { status: "Under review" },
    { status: "Resolved" },
    { status: "Resolution Disputed" },
    { status: "Reopened" },
    { status: "Unknown legacy status" }
  ]);

  assert.deepEqual(counts, {
    total: 7,
    pending: 2,
    underReview: 1,
    resolved: 1,
    disputed: 1,
    reopened: 1,
    unresolved: 0
  });
});

test("dashboard status summary counts authority reports marked cannot be resolved", () => {
  const counts = civicReports.summarizeStatuses([{ status: "Cannot be Resolved" }]);
  assert.equal(counts.unresolved, 1);
});

test("dashboard status summary recognizes the explicit pending authority status", () => {
  const counts = civicReports.summarizeStatuses([{ status: "Pending" }]);
  assert.equal(counts.pending, 1);
});

test("report-save errors identify database setup problems", () => {
  assert.match(
    civicReports.saveErrorMessage({
      code: "P0001",
      message: "Report jurisdiction must be assigned through a trusted administrative workflow."
    }),
    /Database setup incomplete/
  );
  assert.match(
    civicReports.saveErrorMessage({ code: "42501", message: "new row violates row-level security policy" }),
    /Database access denied/
  );
});

test("report-save errors distinguish database, session, location, photo, and network failures", () => {
  assert.match(civicReports.saveErrorMessage({ code: "PGRST205", message: "table not found" }), /Database setup incomplete/);
  assert.match(civicReports.saveErrorMessage({ code: "PGRST301", message: "JWT expired" }), /session expired|Not signed in/);
  assert.match(civicReports.saveErrorMessage(new TypeError("Failed to fetch")), /Check your connection/);
  assert.match(civicReports.saveErrorMessage({ photoUploadFailed: true, code: "42501" }), /Photo could not be saved/);
  assert.match(civicReports.saveErrorMessage({}, { locationMissing: true }), /Location is required/);
  assert.match(civicReports.saveErrorMessage({}, { cityMissing: true }), /City is required/);
});

test("photo analysis receives a bounded description context accepted by the AI endpoint", () => {
  const bounded = civicReports.limitDescriptionForPhotoAnalysis(` ${"a".repeat(240)} `);
  assert.equal(bounded.note.length, 200);
  assert.equal(bounded.truncated, true);
  assert.deepEqual(civicReports.limitDescriptionForPhotoAnalysis("  pothole near crossing  "), {
    note: "pothole near crossing",
    truncated: false
  });
});

test("report retrieval preserves saved reports and histories when optional portal tracking is unavailable", async () => {
  const savedRow = {
    id: "CX-report-1",
    user_id: "account-1",
    category: "Garbage",
    title: "Overflowing bin",
    city: "Delhi, India",
    location: "Market Road",
    area: "Market",
    description: "Waste is collecting around the public bin.",
    latitude: 28.6,
    longitude: 77.2,
    status: "In progress",
    priority: "Medium",
    registration_number: "CX-report-1",
    created_at: "2026-11-16T00:00:00.000Z"
  };
  const event = {
    report_id: "CX-report-1",
    actor_kind: "authority",
    event_type: "authority_action",
    summary: "Authority status update"
  };
  const client = {
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        order() { return query; },
        range() {
          if (table === "civic_reports") return Promise.resolve({ data: [savedRow], error: null });
          if (table === "civic_report_events") return Promise.resolve({ data: [event], error: null });
          return Promise.resolve({ data: null, error: { code: "PGRST205" } });
        }
      };
      return query;
    }
  };

  const reports = await civicReports.listForUser(client, "account-1");

  assert.equal(reports.length, 1);
  assert.equal(reports[0].id, "CX-report-1");
  assert.equal(reports[0].status, "In progress");
  assert.equal(reports[0].events[0].event_type, "authority_action");
});
