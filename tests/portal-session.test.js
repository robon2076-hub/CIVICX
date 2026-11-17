const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "portal-session.js"),
  "utf8"
);

test("portal keys exist only in memory and are cleared on sign-out and user changes", () => {
  let onAuthChange;
  const window = {
    CivicXAuth: {
      onChange(listener) {
        onAuthChange = listener;
      }
    }
  };
  vm.runInNewContext(source, { window });

  onAuthChange({ user: { id: "authority-1" } });
  window.CivicXPortalSession.set("authority", "authority-1", "authority-secret");
  window.CivicXPortalSession.set("owner", "authority-1", "owner-secret");
  assert.equal(window.CivicXPortalSession.get("authority", "authority-1"), "authority-secret");
  assert.equal(window.CivicXPortalSession.get("owner", "authority-1"), "owner-secret");

  onAuthChange({ user: null });
  assert.equal(window.CivicXPortalSession.get("authority", "authority-1"), "");
  assert.equal(window.CivicXPortalSession.get("owner", "authority-1"), "");

  onAuthChange({ user: { id: "authority-1" } });
  assert.equal(window.CivicXPortalSession.get("authority", "authority-1"), "");
  onAuthChange({ user: { id: "authority-2" } });
  assert.equal(window.CivicXPortalSession.get("authority", "authority-1"), "");
});
