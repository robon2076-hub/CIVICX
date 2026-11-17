const test = require("node:test");
const assert = require("node:assert/strict");
const { createEnvironmentService } = require("../server/environment");

test("weather requests use real Open-Meteo forecast variables and cache responses", async () => {
  const urls = [];
  const service = createEnvironmentService({
    fetch: async (url) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ current: { temperature_2m: 31 } }) };
    },
    now: () => 1000
  });
  const first = await service.weather("22.57", "88.36");
  const second = await service.weather("22.57", "88.36");
  assert.deepEqual(first, second);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
  assert.match(urls[0], /apparent_temperature/);
  assert.match(urls[0], /precipitation_probability/);
});

test("air quality uses the provider's modelled AQI and particulate variables", async () => {
  let requestedUrl = "";
  const service = createEnvironmentService({
    fetch: async (url) => {
      requestedUrl = String(url);
      return { ok: true, json: async () => ({ current: { us_aqi: 42, pm2_5: 7 } }) };
    }
  });
  const result = await service.airQuality(22.57, 88.36);
  assert.equal(result.current.us_aqi, 42);
  assert.match(requestedUrl, /^https:\/\/air-quality-api\.open-meteo\.com\/v1\/air-quality\?/);
  assert.match(requestedUrl, /pm2_5/);
});

test("invalid coordinates and provider failures are not converted into fake readings", async () => {
  const service = createEnvironmentService({
    fetch: async () => ({ ok: false, json: async () => ({}) })
  });
  await assert.rejects(service.weather(999, 0), /valid map coordinates/);
  await assert.rejects(service.airQuality(0, 999), /valid map coordinates/);
  await assert.rejects(service.weather(22.57, 88.36), /provider returned an error/);
});
