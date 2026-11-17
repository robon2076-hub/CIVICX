(function (root, factory) {
  const jurisdictions = factory();
  if (typeof module === "object" && module.exports) module.exports = jurisdictions;
  else root.CivicXJurisdictions = jurisdictions;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const FALLBACK_CENTERS = {
    kolkata: [22.5726, 88.3639],
    howrah: [22.5958, 88.2636],
    "new delhi": [28.6139, 77.2090],
    delhi: [28.6139, 77.2090],
    mumbai: [19.0760, 72.8777],
    bengaluru: [12.9716, 77.5946],
    bangalore: [12.9716, 77.5946],
    chennai: [13.0827, 80.2707],
    hyderabad: [17.3850, 78.4867],
    pune: [18.5204, 73.8567],
    ahmedabad: [23.0225, 72.5714],
    jaipur: [26.9124, 75.7873],
    lucknow: [26.8467, 80.9462],
    chandigarh: [30.7333, 76.7794],
    surat: [21.1702, 72.8311],
    kochi: [9.9312, 76.2673],
    indore: [22.7196, 75.8577],
    patna: [25.5941, 85.1376],
    bhubaneswar: [20.2961, 85.8245],
    newdelhi: [28.6139, 77.2090],
    "new delhi(ncr)": [28.6139, 77.2090],
    newtown: [22.5958, 88.4798],
    "new town (rajarhat)": [22.5958, 88.4798]
  };

  function validCoordinates(latitude, longitude) {
    return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
      Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  }

  function baseCityName(value) {
    return String(value || "")
      .normalize("NFKC")
      .trim()
      .split(/[,\u2013\u2014-]/, 1)[0]
      .trim()
      .toLocaleLowerCase();
  }

  function getCenter(jurisdiction) {
    const rawLatitude = jurisdiction?.centerLatitude;
    const rawLongitude = jurisdiction?.centerLongitude;
    if (rawLatitude !== null && rawLatitude !== undefined && rawLatitude !== "" &&
        rawLongitude !== null && rawLongitude !== undefined && rawLongitude !== "") {
      const latitude = Number(rawLatitude);
      const longitude = Number(rawLongitude);
      if (validCoordinates(latitude, longitude)) return [latitude, longitude];
    }

    const names = [jurisdiction?.displayName, jurisdiction?.jurisdictionKey];
    for (const name of names) {
      const center = FALLBACK_CENTERS[baseCityName(name)];
      if (center) return center;
    }
    return null;
  }

  function angularDistance(latitude, longitude, center) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const lat1 = radians(latitude);
    const lat2 = radians(center[0]);
    const deltaLat = lat2 - lat1;
    const deltaLng = radians(center[1] - longitude);
    const a = Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function nearestJurisdiction(latitude, longitude, jurisdictions) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!validCoordinates(lat, lng) || !Array.isArray(jurisdictions)) return null;

    let nearest = null;
    let nearestDistance = Infinity;
    for (const jurisdiction of jurisdictions) {
      if (jurisdiction?.isActive === false) continue;
      const center = getCenter(jurisdiction);
      if (!center) continue;
      const distance = angularDistance(lat, lng, center);
      if (distance < nearestDistance) {
        nearest = jurisdiction;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  function defaultJurisdiction(jurisdictions) {
    if (!Array.isArray(jurisdictions)) return null;
    return jurisdictions.find((jurisdiction) =>
      baseCityName(jurisdiction.displayName) === "kolkata" ||
      baseCityName(jurisdiction.jurisdictionKey) === "kolkata"
    ) || jurisdictions[0] || null;
  }

  return Object.freeze({ defaultJurisdiction, getCenter, nearestJurisdiction });
});
