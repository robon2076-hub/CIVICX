(() => {
  const environment = window.CivicXEnvironment;
  const status = document.getElementById("air-status");
  const content = document.getElementById("air-content");
  let selectedLocation = environment.DEFAULT_LOCATION;
  try {
    const saved = JSON.parse(localStorage.getItem("civicx-selected-city-v1") || "null");
    if (saved && saved.name && Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude)) {
      selectedLocation = {
        name: saved.name.split(",")[0].trim(),
        latitude: saved.latitude,
        longitude: saved.longitude
      };
      const locInput = document.getElementById("air-location");
      if (locInput) locInput.value = selectedLocation.name;
    }
  } catch {}

  function aqiBand(value) {
    if (value <= 50) return { category: "Good", advice: "Air quality is considered satisfactory; unusually sensitive people may still wish to limit prolonged outdoor exertion.", className: "aqi-good" };
    if (value <= 100) return { category: "Moderate", advice: "Sensitive people may experience effects. Consider reducing prolonged outdoor exertion if you feel symptoms.", className: "aqi-moderate" };
    if (value <= 150) return { category: "Unhealthy for sensitive groups", advice: "Children, older adults, and people with heart or lung conditions may wish to reduce prolonged outdoor exertion.", className: "aqi-sensitive" };
    if (value <= 200) return { category: "Unhealthy", advice: "Everyone may begin to experience effects. Consider limiting prolonged or heavy outdoor exertion.", className: "aqi-unhealthy" };
    if (value <= 300) return { category: "Very unhealthy", advice: "Health alert: consider avoiding prolonged outdoor exertion and follow local public-health guidance.", className: "aqi-very-unhealthy" };
    return { category: "Hazardous", advice: "Health warning: reduce outdoor exposure and follow local public-health guidance.", className: "aqi-hazardous" };
  }

  function setMeasurement(id, value) {
    document.getElementById(id).textContent = Number.isFinite(value) ? `${Number(value).toFixed(value < 10 ? 1 : 0)}` : "Unavailable";
  }

  function renderTrend(hourly, currentTime) {
    const container = document.getElementById("air-trend");
    const start = hourly.time.findIndex((time) => time >= currentTime);
    const offset = Math.max(0, start - 24);
    const values = hourly.us_aqi.slice(offset, offset + 48).filter(Number.isFinite);
    const max = Math.max(1, ...values);
    container.replaceChildren();
    values.forEach((value, index) => {
      const bar = document.createElement("span");
      bar.className = "air-trend-bar";
      bar.style.height = `${Math.max(4, Math.round((value / max) * 100))}%`;
      bar.title = `${hourly.time[offset + index].replace("T", " ")} · US AQI ${Math.round(value)}`;
      container.append(bar);
    });
    container.setAttribute("aria-label", `Modelled AQI for ${values.length} hourly readings`);
  }

  async function loadAirQuality(location) {
    selectedLocation = location;
    content.hidden = true;
    status.textContent = "Loading air-quality estimate…";
    try {
      const params = new URLSearchParams({ lat: String(location.latitude), lon: String(location.longitude) });
      const data = await environment.getJson(`/api/environment/air-quality?${params}`);
      if (!data.current || !data.hourly) throw new Error("The provider did not return air-quality data.");
      const aqi = data.current.us_aqi;
      document.getElementById("air-place").textContent = location.name;
      document.getElementById("air-updated").textContent = `Model timestamp: ${data.current.time.replace("T", " ")} · ${data.timezone || "local timezone"}`;
      document.getElementById("aqi-card").className = "environment-aqi-card";
      if (Number.isFinite(aqi)) {
        const band = aqiBand(aqi);
        document.getElementById("aqi-card").classList.add(band.className);
        document.getElementById("air-aqi").textContent = Math.round(aqi);
        document.getElementById("air-category").textContent = band.category;
        document.getElementById("air-advice").textContent = band.advice;
      } else {
        document.getElementById("air-aqi").textContent = "Unavailable";
        document.getElementById("air-category").textContent = "No AQI value returned";
        document.getElementById("air-advice").textContent = "The provider did not return an AQI for this location.";
      }
      setMeasurement("air-pm25", data.current.pm2_5);
      setMeasurement("air-pm10", data.current.pm10);
      setMeasurement("air-co", data.current.carbon_monoxide);
      setMeasurement("air-no2", data.current.nitrogen_dioxide);
      setMeasurement("air-o3", data.current.ozone);
      renderTrend(data.hourly, data.current.time);
      content.hidden = false;
      status.textContent = "";
    } catch (error) {
      status.textContent = `${error.message} No live values are being shown.`;
    }
  }

  environment.setupLocationSearch({
    form: document.getElementById("air-search"),
    input: document.getElementById("air-location"),
    resultBox: document.getElementById("air-results"),
    status,
    useLocation: document.getElementById("air-use-location"),
    onChoose: loadAirQuality
  });
  loadAirQuality(selectedLocation);
})();
