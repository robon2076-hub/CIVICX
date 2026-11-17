const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "portal-navigation.js"),
  "utf8"
);

function createStorage(values = new Map()) {
  return {
    get length() {
      return values.size;
    },
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    }
  };
}

function createNavigation() {
  let onAuthChange;
  const authListeners = [];
  const authorityEntry = { hidden: true };
  const ownerEntry = { hidden: true };
  const localValues = new Map([["civicx.portal-entry.opened.authority.user-1", "1"]]);
  const sessionValues = new Map([["civicx.portal-entry.opened.owner.user-1", "1"]]);
  let isOwner = false;
  const client = {
    auth: {
      async getSession() {
        return { data: { session: { access_token: "verified-session" } }, error: null };
      },
      onAuthStateChange(listener) {
        authListeners.push(listener);
      }
    }
  };
  const window = {
    localStorage: createStorage(localValues),
    sessionStorage: createStorage(sessionValues),
    CivicXAuth: {
      ready: Promise.resolve({ client }),
      onChange(listener) {
        onAuthChange = listener;
      }
    }
  };
  const document = {
    querySelectorAll(selector) {
      return selector === "[data-authority-entry]" ? [authorityEntry] : [ownerEntry];
    }
  };
  const fetchCalls = [];
  const fetch = async (url, options) => {
    fetchCalls.push([url, options]);
    return {
      ok: true,
      async json() {
        return { ok: true, result: { isOwner } };
      }
    };
  };

  vm.runInNewContext(source, {
    window,
    document,
    fetch,
    console: { error() {} }
  });
  return Promise.resolve().then(() => ({
    authorityEntry,
    ownerEntry,
    client,
    fetchCalls,
    authListeners,
    localValues,
    sessionValues,
    setIsOwner(value) {
      isOwner = value;
    },
    sync: onAuthChange
  }));
}

test("Authority link appears for any signed-in user and Owner link is server-confirmed", async () => {
  const navigation = await createNavigation();

  navigation.sync({ user: { id: "citizen", role: "citizen" }, client: navigation.client });
  await new Promise(setImmediate);
  assert.equal(navigation.authorityEntry.hidden, false);
  assert.equal(navigation.ownerEntry.hidden, true);
  assert.equal(navigation.fetchCalls[0][0], "/api/portal/entry-status");
  assert.equal(navigation.fetchCalls[0][1].headers.authorization, "Bearer verified-session");

  navigation.setIsOwner(true);
  navigation.sync({ user: { id: "owner", role: "citizen" }, client: navigation.client });
  await new Promise(setImmediate);
  assert.equal(navigation.ownerEntry.hidden, false);

  navigation.sync({ user: null, client: navigation.client });
  assert.equal(navigation.authorityEntry.hidden, true);
  assert.equal(navigation.ownerEntry.hidden, true);
});

test("all site navigation bars load the server-checked portal links", () => {
  for (const page of ["index.html", "dashboard.html", "community.html", "ai.html", "authority.html", "owner.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
    assert.match(html, /data-authority-entry/);
    assert.match(html, /data-owner-entry/);
    assert.match(html, /portal-navigation\.js/);
  }
});

test("sign-in and sign-out clear legacy persisted portal-entry flags", async () => {
  const navigation = await createNavigation();
  await navigation.authListeners[0]("SIGNED_OUT");

  assert.equal(navigation.localValues.size, 0);
  assert.equal(navigation.sessionValues.size, 0);
});
