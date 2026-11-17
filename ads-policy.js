(function (root, factory) {
  const policy = factory();
  if (typeof module === "object" && module.exports) module.exports = policy;
  else root.CivicXAdPolicy = policy;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const MAX_ADS_PER_PAGE = 2;
  return {
    MAX_ADS_PER_PAGE,
    canRenderAdSlots(count) {
      return Number.isInteger(count) && count >= 0 && count <= MAX_ADS_PER_PAGE;
    }
  };
});
