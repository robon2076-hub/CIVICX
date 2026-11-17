(() => {
  const authorityEntries = Array.from(document.querySelectorAll("[data-authority-entry]"));
  const ownerEntries = Array.from(document.querySelectorAll("[data-owner-entry]"));
  const legacyUnlockPrefix = "civicx.portal-entry.opened.";
  let requestVersion = 0;
  let returnToAuthorityAfterSignIn = false;
  let currentUser = null;

  function showVerificationError(message) {
    const status = document.querySelectorAll("[data-civicx-auth-status]")[0] ||
      document.getElementById?.("authority-status") ||
      document.getElementById?.("owner-status");
    if (status) status.textContent = message;
  }

  function clearLegacyUnlockState() {
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[storageName];
        const keys = [];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key?.startsWith(legacyUnlockPrefix)) keys.push(key);
        }
        keys.forEach((key) => storage.removeItem(key));
      } catch {
        continue;
      }
    }
  }

  async function sync(state) {
    const version = ++requestVersion;
    const signedIn = Boolean(state.user?.id && state.client);
    currentUser = state.user || null;
    authorityEntries.forEach((entry) => { entry.hidden = false; });
    ownerEntries.forEach((entry) => {
      entry.hidden = true;
    });
    if (signedIn && returnToAuthorityAfterSignIn) {
      returnToAuthorityAfterSignIn = false;
      window.location.assign("authority.html");
      return;
    }
    if (!signedIn) return;

    try {
      const { data, error } = await state.client.auth.getSession();
      if (error || !data.session?.access_token) return;
      const response = await fetch("/api/portal/entry-status", {
        headers: { authorization: `Bearer ${data.session.access_token}` },
        cache: "no-store"
      });
      const contentType = response.headers?.get?.("content-type") || "";
      const result = await response.json().catch(() => null);
      if (version !== requestVersion) return;
      if (!response.ok || result?.ok !== true ||
          (contentType && !contentType.includes("application/json"))) {
        const message = response.status === 404 || !result ||
          (contentType && !contentType.includes("application/json"))
          ? "Owner access verification needs the CIVICX server. Public pages remain available."
          : result.error || "Portal navigation could not be verified.";
        throw new Error(message);
      }
      ownerEntries.forEach((entry) => {
        entry.hidden = result.result?.isOwner !== true;
      });
    } catch (error) {
      if (version === requestVersion) {
        showVerificationError(error instanceof TypeError
          ? "Owner access verification needs the CIVICX server. Public pages remain available."
          : error.message);
        console.error("[CivicX portal navigation] Owner entry verification failed", {
          message: error.message
        });
      }
    }
  }

  authorityEntries.forEach((entry) => {
    entry.addEventListener("click", async (event) => {
      if (currentUser?.id) return;
      event.preventDefault();
      await window.CivicXAuth.ready;
      if (window.CivicXAuth.user?.id) {
        window.location.assign("authority.html");
        return;
      }
      returnToAuthorityAfterSignIn = true;
      await window.CivicXAuth.open("login");
    });
  });

  window.CivicXAuth.onChange((state) => {
    void sync(state);
  });
  window.CivicXAuth.ready.then((state) => {
    state.client?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") clearLegacyUnlockState();
    });
  });
})();
