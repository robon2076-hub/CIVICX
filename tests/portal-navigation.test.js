const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "portal-navigation.js"),
  "utf8"
);
const portalSessionSource = fs.readFileSync(
  path.join(__dirname, "..", "portal-session.js"),
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
  let currentUser = null;
  const authListeners = [];
  const authorityClickListeners = [];
  const authorityEntry = {
    hidden: true,
    href: "authority.html",
    addEventListener(type, listener) {
      if (type === "click") authorityClickListeners.push(listener);
    }
  };
  const ownerEntry = { hidden: true };
  const localValues = new Map([["civicx.portal-entry.opened.authority.user-1", "1"]]);
  const sessionValues = new Map([["civicx.portal-entry.opened.owner.user-1", "1"]]);
  let isOwner = false;
  const authModes = [];
  const redirects = [];
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
    location: {
      assign(url) {
        redirects.push(url);
      }
    },
    CivicXAuth: {
      ready: Promise.resolve({ client }),
      get user() {
        return currentUser;
      },
      async open(mode) {
        authModes.push(mode);
      },
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
    authorityClickListeners,
    authModes,
    redirects,
    localValues,
    sessionValues,
    setIsOwner(value) {
      isOwner = value;
    },
    sync(state) {
      currentUser = state.user;
      onAuthChange(state);
    }
  }));
}

test("Authority link stays visible for signed-out and signed-in users while Owner remains server-confirmed", async () => {
  const navigation = await createNavigation();

  navigation.sync({ user: null, client: navigation.client });
  assert.equal(navigation.authorityEntry.hidden, false);
  assert.equal(navigation.ownerEntry.hidden, true);

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
  assert.equal(navigation.authorityEntry.hidden, false);
  assert.equal(navigation.ownerEntry.hidden, true);
});

test("signed-out Authority click opens sign-in and returns to Authority after authentication", async () => {
  const navigation = await createNavigation();
  navigation.sync({ user: null, client: navigation.client });
  let prevented = false;

  await navigation.authorityClickListeners[0]({
    preventDefault() {
      prevented = true;
    }
  });
  assert.equal(prevented, true);
  assert.deepEqual(navigation.authModes, ["login"]);
  assert.deepEqual(navigation.redirects, []);

  navigation.sync({ user: { id: "citizen" }, client: navigation.client });
  assert.deepEqual(navigation.redirects, ["authority.html"]);
});

test("all site navigation bars include Authority and server-checked Owner links", () => {
  for (const page of ["index.html", "dashboard.html", "community.html", "ai.html", "authority.html", "owner.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
    assert.match(html, /<a\b[^>]*data-authority-entry[^>]*>Authority<\/a>/);
    assert.doesNotMatch(html.match(/<a\b[^>]*data-authority-entry[^>]*>/)?.[0] || "", /\shidden(?:\s|>)/);
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

test("Authority unlock key is cleared on sign-out and is not restored after signing back in", () => {
  let onAuthChange;
  const window = {
    CivicXAuth: {
      onChange(listener) {
        onAuthChange = listener;
      }
    }
  };
  vm.runInNewContext(portalSessionSource, { window });

  window.CivicXPortalSession.sync("authority-user");
  window.CivicXPortalSession.set("authority", "authority-user", "master-key");
  assert.equal(window.CivicXPortalSession.get("authority", "authority-user"), "master-key");

  onAuthChange({ user: null });
  onAuthChange({ user: { id: "authority-user" } });
  assert.equal(window.CivicXPortalSession.get("authority", "authority-user"), "");
});
