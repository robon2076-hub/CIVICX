(() => {
  const locked = document.getElementById("ai-locked");
  const workspace = document.getElementById("ai-workspace");
  const launcher = document.getElementById("civicx-chat-launcher");
  let wasAuthenticated = false;

  function updateAccess(state) {
    const authenticated = Boolean(state.user);
    locked.hidden = authenticated;
    workspace.hidden = !authenticated;
    if (authenticated && !wasAuthenticated) {
      window.setTimeout(() => {
        if (workspace.hidden) return;
        launcher.click();
      }, 0);
    }
    wasAuthenticated = authenticated;
  }

  window.CivicXAuth.onChange(updateAccess);
  window.CivicXAuth.ready.catch((error) => {
    console.error("[CivicX AI page] Authentication state could not be restored", error);
    document.getElementById("ai-locked").querySelector("p:not(.page-overline)").textContent =
      "Account status could not be checked. Reload the page and try again.";
  });
})();
