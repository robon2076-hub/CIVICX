(() => {
  const environment = window.CivicXEnvironment;
  const status = document.getElementById("weather-status");
  const content = document.getElementById("weather-content");
  let selectedLocation = environment.DEFAULT_LOCATION;
  try {
    const saved = JSON.parse(localStorage.getItem("civicx-selected-city-v1") || "null");
    if (saved && saved.name && Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude)) {
      selectedLocation = {
        name: saved.name.split(",")[0].trim(),
        latitude: saved.latitude,
        longitude: saved.longitude
      };
      const locInput = document.getElementById("weather-location");
      if (locInput) locInput.value = selectedLocation.name;
    }
  } catch {}

  const weatherLabels = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Drizzle",
    55: "Dense drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Rain showers",
    81: "Rain showers", 82: "Heavy rain showers", 95: "Thunderstorm",
    96: "Thunderstorm with hail", 99: "Thunderstorm with hail"
  };

  function temperature(value) {
    return Number.isFinite(value) ? `${Math.round(value)}°C` : "Unavailable";
  }

  function formatHour(value) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(value));
  }

  function formatDay(value) {
    return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
  }

  function renderHourly(hourly, currentTime) {
    const container = document.getElementById("weather-hourly");
    const start = hourly.time.findIndex((time) => time >= currentTime);
    const offset = Math.max(start, 0);
    container.replaceChildren();
    hourly.time.slice(offset, offset + 12).forEach((time, index) => {
      const position = offset + index;
      const card = document.createElement("article");
      card.className = "hourly-item";
      card.innerHTML = `<span>${formatHour(time)}</span><strong>${temperature(hourly.temperature_2m[position])}</strong><small>${hourly.precipitation_probability[position] ?? "—"}% rain chance</small>`;
      container.append(card);
    });
  }

  function renderDaily(daily) {
    const container = document.getElementById("weather-daily");
    container.replaceChildren();
    daily.time.forEach((day, index) => {
      const item = document.createElement("article");
      item.className = "forecast-item";
      item.innerHTML = `<strong>${formatDay(day)}</strong><span>${weatherLabels[daily.weather_code[index]] || "Conditions vary"}</span><span>${temperature(daily.temperature_2m_min[index])} / ${temperature(daily.temperature_2m_max[index])}</span><small>${daily.precipitation_probability_max[index] ?? "—"}% precipitation · ${daily.precipitation_sum[index] ?? "—"} mm</small>`;
      container.append(item);
    });
  }

  async function loadWeather(location) {
    selectedLocation = location;
    content.hidden = true;
    status.textContent = "Loading forecast…";
    try {
      const params = new URLSearchParams({ lat: String(location.latitude), lon: String(location.longitude) });
      const data = await environment.getJson(`/api/environment/weather?${params}`);
      if (!data.current || !data.hourly || !data.daily) throw new Error("The provider did not return a complete forecast.");
      document.getElementById("weather-place").textContent = location.name;
      document.getElementById("weather-updated").textContent = `Model update time: ${data.current.time.replace("T", " ")} · ${data.timezone || "local timezone"}`;
      document.getElementById("weather-temperature").textContent = temperature(data.current.temperature_2m);
      document.getElementById("weather-condition").textContent = weatherLabels[data.current.weather_code] || "Conditions vary";
      document.getElementById("weather-feels").textContent = temperature(data.current.apparent_temperature);
      document.getElementById("weather-humidity").textContent = Number.isFinite(data.current.relative_humidity_2m) ? `${data.current.relative_humidity_2m}%` : "Unavailable";
      document.getElementById("weather-wind").textContent = Number.isFinite(data.current.wind_speed_10m) ? `${Math.round(data.current.wind_speed_10m)} km/h` : "Unavailable";
      document.getElementById("weather-rain").textContent = Number.isFinite(data.current.precipitation) ? `${data.current.precipitation} mm` : "Unavailable";
      renderHourly(data.hourly, data.current.time);
      renderDaily(data.daily);
      content.hidden = false;
      status.textContent = "";
    } catch (error) {
      status.textContent = `${error.message} No live values are being shown.`;
    }
  }

  environment.setupLocationSearch({
    form: document.getElementById("weather-search"),
    input: document.getElementById("weather-location"),
    resultBox: document.getElementById("weather-results"),
    status,
    useLocation: document.getElementById("weather-use-location"),
    onChoose: loadWeather
  });
  loadWeather(selectedLocation);
})();
