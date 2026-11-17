(() => {
  const portals = new Set(["authority", "owner"]);
  const keys = new Map();
  let activeUserId = null;

  function sync(userId) {
    const nextUserId = typeof userId === "string" && userId ? userId : null;
    if (!nextUserId || nextUserId !== activeUserId) keys.clear();
    activeUserId = nextUserId;
  }

  function set(portal, userId, key) {
    if (!portals.has(portal) || userId !== activeUserId || typeof key !== "string") return;
    keys.set(portal, key);
  }

  function get(portal, userId) {
    if (!portals.has(portal) || userId !== activeUserId) return "";
    return keys.get(portal) || "";
  }

  function clear(portal) {
    if (portals.has(portal)) keys.delete(portal);
    else keys.clear();
  }

  window.CivicXPortalSession = Object.freeze({ clear, get, set, sync });
  window.CivicXAuth.onChange((state) => sync(state.user?.id));
})();
