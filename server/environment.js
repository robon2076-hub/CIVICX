const WEATHER_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const AIR_ENDPOINT = "https://air-quality-api.open-meteo.com/v1/air-quality";
const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

function validCoordinate(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function createEnvironmentService(options = {}) {
  const fetchImpl = options.fetch || fetch;
  const now = options.now || Date.now;
  const cache = new Map();

  async function getJson(url, cacheKey, ttl) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now()) return cached.value;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw new Error("The data provider returned an error.");
      const value = await response.json();
      cache.set(cacheKey, { value, expiresAt: now() + ttl });
      return value;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function weather(latitude, longitude) {
    const lat = validCoordinate(latitude, -90, 90);
    const lon = validCoordinate(longitude, -180, 180);
    if (lat === null || lon === null) throw new TypeError("Enter valid map coordinates.");
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      timezone: "auto",
      forecast_days: "5",
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
      hourly: "temperature_2m,precipitation_probability,precipitation,weather_code",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum"
    });
    const key = `weather:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    return getJson(`${WEATHER_ENDPOINT}?${params}`, key, 10 * 60 * 1000);
  }

  async function airQuality(latitude, longitude) {
    const lat = validCoordinate(latitude, -90, 90);
    const lon = validCoordinate(longitude, -180, 180);
    if (lat === null || lon === null) throw new TypeError("Enter valid map coordinates.");
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      timezone: "auto",
      forecast_days: "3",
      past_days: "2",
      current: "us_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone",
      hourly: "us_aqi,pm2_5,pm10"
    });
    const key = `air:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    return getJson(`${AIR_ENDPOINT}?${params}`, key, 15 * 60 * 1000);
  }

  async function geocode(query) {
    const name = String(query || "").trim();
    if (name.length < 2 || name.length > 80 || /[\r\n<>]/.test(name)) {
      throw new TypeError("Enter a city or locality name between 2 and 80 characters.");
    }
    const params = new URLSearchParams({
      name,
      count: "6",
      language: "en",
      format: "json",
      countryCode: "IN"
    });
    return getJson(`${GEOCODING_ENDPOINT}?${params}`, `geocode:${name.toLowerCase()}`, 60 * 60 * 1000);
  }

  return { weather, airQuality, geocode };
}

function registerEnvironmentRoutes(app, service = createEnvironmentService()) {
  app.get("/api/environment/weather", async (request, response) => {
    try {
      response.json(await service.weather(request.query.lat, request.query.lon));
    } catch (error) {
      const isInputError = error instanceof TypeError;
      response.status(isInputError ? 400 : 503).json({
        message: isInputError ? error.message : "Weather information is temporarily unavailable."
      });
    }
  });

  app.get("/api/environment/air-quality", async (request, response) => {
    try {
      response.json(await service.airQuality(request.query.lat, request.query.lon));
    } catch (error) {
      const isInputError = error instanceof TypeError;
      response.status(isInputError ? 400 : 503).json({
        message: isInputError ? error.message : "Air-quality information is temporarily unavailable."
      });
    }
  });

  app.get("/api/environment/geocode", async (request, response) => {
    try {
      response.json(await service.geocode(request.query.q));
    } catch (error) {
      const isInputError = error instanceof TypeError;
      response.status(isInputError ? 400 : 503).json({
        message: isInputError ? error.message : "Location search is temporarily unavailable."
      });
    }
  });
}

module.exports = { createEnvironmentService, registerEnvironmentRoutes, validCoordinate };
