(() => {
  const DEFAULT_LOCATION = { name: "Kolkata, West Bengal", latitude: 22.5726, longitude: 88.3639 };

  async function getJson(url) {
    let response;
    try {
      response = await fetch(url);
    } catch {
      throw new Error("This feature needs the CIVICX server. You can still browse other pages.");
    }
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : null;
    if (response.status === 404 || !contentType.includes("application/json") || !payload) {
      throw new Error("This feature needs the CIVICX server. You can still browse other pages.");
    }
    if (!response.ok) throw new Error(payload.message || "The information is temporarily unavailable.");
    return payload;
  }

  function locationName(location) {
    return [location.name, location.admin1, location.country].filter(Boolean).join(", ");
  }

  function showResults(resultBox, results, onChoose) {
    resultBox.replaceChildren();
    const locations = Array.isArray(results.results) ? results.results : [];
    if (!locations.length) {
      resultBox.textContent = "No matching Indian locations were found.";
      resultBox.hidden = false;
      return;
    }
    locations.forEach((location) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "environment-result-option";
      button.textContent = locationName(location);
      button.addEventListener("click", () => onChoose({
        name: locationName(location),
        latitude: location.latitude,
        longitude: location.longitude
      }));
      resultBox.append(button);
    });
    resultBox.hidden = false;
  }

  function setupLocationSearch({ form, input, resultBox, status, useLocation, onChoose }) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = input.value.trim();
      status.textContent = "Searching locations…";
      resultBox.hidden = true;
      try {
        const data = await getJson(`/api/environment/geocode?q=${encodeURIComponent(query)}`);
        showResults(resultBox, data, (location) => {
          resultBox.hidden = true;
          input.value = location.name;
          onChoose(location);
        });
        status.textContent = "";
      } catch (error) {
        status.textContent = error.message;
      }
    });
    useLocation.addEventListener("click", () => {
      if (!navigator.geolocation) {
        status.textContent = "Location access is not available in this browser.";
        return;
      }
      status.textContent = "Requesting your location…";
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resultBox.hidden = true;
          const location = {
            name: "Your current location",
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          input.value = location.name;
          onChoose(location);
        },
        () => { status.textContent = "Location permission was not granted. Search for a city or locality instead."; },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  window.CivicXEnvironment = {
    DEFAULT_LOCATION,
    getJson,
    setupLocationSearch,
    escapeHtml
  };
})();
