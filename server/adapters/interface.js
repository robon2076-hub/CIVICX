function assertPortalAdapter(adapter) {
  if (!adapter || typeof adapter.file !== "function" || typeof adapter.checkStatus !== "function") {
    throw new TypeError("Portal adapters must implement file() and checkStatus().");
  }
  return adapter;
}

module.exports = { assertPortalAdapter };
