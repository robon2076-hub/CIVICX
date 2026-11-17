const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const policy = require("../ads-policy");

const root = path.resolve(__dirname, "..");

test("a page declares no more than two ad slots and the runtime policy enforces the same limit", () => {
  const pages = fs.readdirSync(root).filter((file) => file.endsWith(".html"));
  const counts = pages.map((file) => {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    const slotCount = (html.match(/data-ad-slot=/g) || []).length;
    assert.ok(policy.canRenderAdSlots(slotCount), `${file} declares more than two ad slots`);
    assert.doesNotMatch(html, /data-sponsor-slot|data-sponsor-click|sponsor-infeed-slot/);
    return slotCount;
  });
  assert.ok(counts.every((count) => count <= 2));
  assert.equal(policy.MAX_ADS_PER_PAGE, 2);
  assert.equal(policy.canRenderAdSlots(3), false);
});

test("ad configuration keeps the user-editable schema and allowlisted pages", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "ads.config.json"), "utf8"));
  const expected = ["id", "brand", "type", "file", "link", "headline", "startDate", "endDate", "enabled", "weight"];
  assert.deepEqual(config.allowedPages, ["community.html", "dashboard.html", "ai.html", "air-quality.html", "weather.html"]);
  assert.ok(config.ads.length >= 2);
  config.ads.forEach((ad) => {
    assert.deepEqual(Object.keys(ad).sort(), [...expected].sort());
    assert.equal(ad.enabled, false, "placeholder campaigns must not be presented as real sponsors");
  });
});

test("tracking and sponsor stats pages do not declare ad slots", () => {
  for (const file of ["track.html", "sponsor-admin.html"]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(html, /data-ad-slot=/);
  }
});

test("site pages load the shared theme before page-specific stylesheets", () => {
  const pages = ["index.html", "dashboard.html", "ai.html", "community.html", "weather.html", "air-quality.html", "authority.html", "owner.html", "track.html", "sponsor-admin.html"];
  for (const file of pages) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    const stylesheets = html.match(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi) || [];
    assert.match(stylesheets[0] || "", /href=["']theme\.css["']/i, `${file} must load theme.css first`);
  }
});

test("user-facing app pages declare only the two responsive side-rail slots", () => {
  const theme = fs.readFileSync(path.join(root, "theme.css"), "utf8");
  assert.match(theme, /@import\s+url\(["']?ads-rails\.css["']?\)/);
  for (const file of ["dashboard.html", "community.html", "ai.html", "weather.html", "air-quality.html"]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /data-ad-slot="desktop-left"/);
    assert.match(html, /data-ad-slot="desktop-right"/);
    assert.doesNotMatch(html, /data-ad-slot="mobile"/);
    assert.match(html, /href=["']theme\.css["']/);
  }
});
