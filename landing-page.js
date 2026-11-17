(() => {
  let signedIn = false;
  let initialized = false;
  window.CivicXAuth.ready.then((state) => {
    signedIn = Boolean(state.user);
    initialized = true;
  }).catch((error) => {
    console.error("[CivicX landing] Authentication state could not be restored", error);
  });

  window.CivicXAuth.onChange((state) => {
    const nowSignedIn = Boolean(state.user);
    if (!initialized) {
      signedIn = nowSignedIn;
      return;
    }
    if (!signedIn && nowSignedIn) window.location.assign("dashboard.html");
    signedIn = nowSignedIn;
  });
})();
