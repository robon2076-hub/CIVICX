(() => {
  const countElement = document.getElementById("active-campaign-count");
  const impressionsElement = document.getElementById("total-impressions");
  const clicksElement = document.getElementById("total-clicks");
  const tableBody = document.getElementById("sponsor-admin-body");
  const note = document.getElementById("sponsor-admin-note");

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function render() {
    const api = window.CivicXAds;
    if (!api) return;
    if (api.getConfigurationError()) {
      countElement.textContent = "—";
      impressionsElement.textContent = "—";
      clicksElement.textContent = "—";
      tableBody.innerHTML = `<tr><td colspan="5">${escapeHtml(api.getConfigurationError())}</td></tr>`;
      note.textContent = "Ad stats are unavailable until the configuration loads.";
      return;
    }
    const campaigns = api.getAds();
    const metrics = api.getMetrics();
    const today = new Date().toISOString().slice(0, 10);
    const activeCount = campaigns.filter((campaign) =>
      campaign.enabled === true && campaign.startDate <= today && campaign.endDate >= today
    ).length;
    const totalImpressions = campaigns.reduce((total, campaign) => total + (metrics[campaign.id]?.impressions || 0), 0);
    const totalClicks = campaigns.reduce((total, campaign) => total + (metrics[campaign.id]?.clicks || 0), 0);
    countElement.textContent = String(activeCount);
    impressionsElement.textContent = String(totalImpressions);
    clicksElement.textContent = String(totalClicks);
    tableBody.innerHTML = campaigns.length ? campaigns.map((campaign) => {
      const currentMetrics = metrics[campaign.id];
      return `<tr>
        <td><strong>${escapeHtml(campaign.brand)}</strong><small>${escapeHtml(campaign.headline)}${campaign.file.includes("placeholder") ? " · Placeholder creative" : ""}</small></td>
        <td>${escapeHtml(campaign.type)}</td>
        <td>${escapeHtml(campaign.startDate)} – ${escapeHtml(campaign.endDate)}</td>
        <td>${currentMetrics?.impressions || 0}</td>
        <td>${currentMetrics?.clicks || 0}</td>
      </tr>`;
    }).join("") : '<tr><td colspan="5">No ads are configured.</td></tr>';
    note.textContent = "Counts are local to this browser profile. Real campaign reporting requires a secured backend.";
  }

  document.addEventListener("civicx:ads-ready", render);
  document.addEventListener("civicx:ads-error", render);
  document.addEventListener("civicx:ad-metrics-updated", render);
  render();
})();
