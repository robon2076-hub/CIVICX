(() => {
  const authorityEntries = Array.from(document.querySelectorAll("[data-authority-entry]"));
  const ownerEntries = Array.from(document.querySelectorAll("[data-owner-entry]"));
  const legacyUnlockPrefix = "civicx.portal-entry.opened.";
  let requestVersion = 0;

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
    authorityEntries.forEach((entry) => {
      entry.hidden = !signedIn;
    });
    ownerEntries.forEach((entry) => {
      entry.hidden = true;
    });
    if (!signedIn) return;

    try {
      const { data, error } = await state.client.auth.getSession();
      if (error || !data.session?.access_token) return;
      const response = await fetch("/api/portal/entry-status", {
        headers: { authorization: `Bearer ${data.session.access_token}` },
        cache: "no-store"
      });
      const result = await response.json().catch(() => ({}));
      if (version !== requestVersion) return;
      if (!response.ok || result.ok !== true) {
        throw new Error(result.error || "Portal navigation could not be verified.");
      }
      ownerEntries.forEach((entry) => {
        entry.hidden = result.result?.isOwner !== true;
      });
    } catch (error) {
      if (version === requestVersion) {
        console.error("[CivicX portal navigation] Owner entry verification failed", {
          message: error.message
        });
      }
    }
  }

  window.CivicXAuth.onChange((state) => {
    void sync(state);
  });
  window.CivicXAuth.ready.then((state) => {
    state.client?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") clearLegacyUnlockState();
    });
  });
})();
