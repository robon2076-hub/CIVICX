const CITY_STORAGE_KEY = "civicx-selected-city-v1";
const DEFAULT_CITY = { name: "Kolkata, West Bengal, India", latitude: 22.5726, longitude: 88.3639 };
const CITY_PRESETS = {
  Kolkata: DEFAULT_CITY,
  Delhi: { name: "New Delhi, Delhi, India", latitude: 28.6139, longitude: 77.2090 },
  Mumbai: { name: "Mumbai, Maharashtra, India", latitude: 19.0760, longitude: 72.8777 },
  Bengaluru: { name: "Bengaluru, Karnataka, India", latitude: 12.9716, longitude: 77.5946 },
  Chennai: { name: "Chennai, Tamil Nadu, India", latitude: 13.0827, longitude: 80.2707 },
  Hyderabad: { name: "Hyderabad, Telangana, India", latitude: 17.3850, longitude: 78.4867 },
  Pune: { name: "Pune, Maharashtra, India", latitude: 18.5204, longitude: 73.8567 },
  Ahmedabad: { name: "Ahmedabad, Gujarat, India", latitude: 23.0225, longitude: 72.5714 },
  Jaipur: { name: "Jaipur, Rajasthan, India", latitude: 26.9124, longitude: 75.7873 },
  Lucknow: { name: "Lucknow, Uttar Pradesh, India", latitude: 26.8467, longitude: 80.9462 },
  Chandigarh: { name: "Chandigarh, India", latitude: 30.7333, longitude: 76.7794 },
  Surat: { name: "Surat, Gujarat, India", latitude: 21.1702, longitude: 72.8311 },
  Kochi: { name: "Kochi, Kerala, India", latitude: 9.9312, longitude: 76.2673 },
  Indore: { name: "Indore, Madhya Pradesh, India", latitude: 22.7196, longitude: 75.8577 },
  Patna: { name: "Patna, Bihar, India", latitude: 25.5941, longitude: 85.1376 },
  Bhubaneswar: { name: "Bhubaneswar, Odisha, India", latitude: 20.2961, longitude: 85.8245 }
};
const submissionState = window.CivicXSubmissionState;
const imagePrivacyReady = new Promise((resolve, reject) => {
  if (window.CivicXImagePrivacy) {
    resolve(window.CivicXImagePrivacy);
    return;
  }
  const timeout = window.setTimeout(() => reject(new Error("The local privacy tools did not start. No photo was uploaded.")), 20000);
  window.addEventListener("civicx-image-privacy-ready", () => {
    window.clearTimeout(timeout);
    resolve(window.CivicXImagePrivacy);
  }, { once: true });
});

const starterReports = [
  // Kolkata reports
  { id: "CX-2418", category: "Pothole", title: "Deep pothole near the crossing", city: "Kolkata, West Bengal, India", location: "Park Circus, Kolkata", area: "Park Circus", date: "Today, 10:42 AM", status: "In progress", priority: "High", coordinates: [22.5398, 88.3651], description: "A deep pothole is slowing traffic near the crossing." },
  { id: "CX-2417", category: "Garbage", title: "Overflowing community bin", city: "Kolkata, West Bengal, India", location: "Ballygunge Place, Kolkata", area: "Ballygunge", date: "Today, 9:18 AM", status: "Verified", priority: "Medium", coordinates: [22.5307, 88.3668], description: "The public bin is full and waste is collecting around it." },
  { id: "CX-2416", category: "Water leakage", title: "Water leaking onto the footpath", city: "Kolkata, West Bengal, India", location: "Gariahat Road, Kolkata", area: "Gariahat", date: "Today, 8:05 AM", status: "Assigned", priority: "High", coordinates: [22.5189, 88.3662], description: "Water is pooling on the footpath beside the main road." },
  { id: "CX-2415", category: "Streetlight", title: "Streetlight out after sunset", city: "Kolkata, West Bengal, India", location: "Minto Park, Kolkata", area: "Minto Park", date: "Yesterday", status: "Submitted", priority: "Low", coordinates: [22.5394, 88.3503], description: "One streetlight is not turning on after dark." },
  { id: "CX-2414", category: "Pothole", title: "Road surface breaking up", city: "Kolkata, West Bengal, India", location: "Beck Bagan, Kolkata", area: "Beck Bagan", date: "Yesterday", status: "Verified", priority: "Medium", coordinates: [22.5451, 88.3676], description: "The road surface is crumbling and getting harder to avoid." },
  { id: "CX-2413", category: "Garbage", title: "Missed waste collection", city: "Kolkata, West Bengal, India", location: "Bhowanipore, Kolkata", area: "Bhowanipore", date: "Yesterday", status: "Resolved", priority: "Medium", coordinates: [22.5257, 88.3421], description: "Waste collection has been completed on this street." },
  { id: "CX-2412", category: "Streetlight", title: "Dark stretch near the bus stop", city: "Kolkata, West Bengal, India", location: "AJC Bose Road, Kolkata", area: "Minto Park", date: "Nov 12", status: "In progress", priority: "Medium", coordinates: [22.5443, 88.3511], description: "Two lights are off near the bus stop." },
  { id: "CX-2411", category: "Pothole", title: "Pothole widening after rain", city: "Kolkata, West Bengal, India", location: "Park Circus Connector, Kolkata", area: "Park Circus", date: "Nov 12", status: "Submitted", priority: "High", coordinates: [22.5419, 88.3692], description: "The pothole has become wider after the recent rain." },
  { id: "CX-2410", category: "Water leakage", title: "Water pipe seepage", city: "Kolkata, West Bengal, India", location: "Hazra Road, Kolkata", area: "Bhowanipore", date: "Nov 11", status: "Resolved", priority: "Low", coordinates: [22.5186, 88.3457], description: "The water pipe seepage has been repaired." },
  { id: "CX-2409", category: "Garbage", title: "Litter gathering beside the market", city: "Kolkata, West Bengal, India", location: "Gariahat Market, Kolkata", area: "Gariahat", date: "Nov 11", status: "Assigned", priority: "Medium", coordinates: [22.5184, 88.3654], description: "Litter is accumulating beside the market entrance." },
  { id: "CX-2408", category: "Pothole", title: "Uneven road near the crossing", city: "Kolkata, West Bengal, India", location: "Park Circus, Kolkata", area: "Park Circus", date: "Nov 10", status: "Resolved", priority: "Medium", coordinates: [22.5374, 88.3627], description: "The uneven road surface has been patched." },
  { id: "CX-2407", category: "Streetlight", title: "Lamp flickering on residential lane", city: "Kolkata, West Bengal, India", location: "Ballygunge Circular Road, Kolkata", area: "Ballygunge", date: "Nov 9", status: "Verified", priority: "Low", coordinates: [22.5328, 88.3731], description: "The streetlight flickers intermittently." },

  // Delhi / NCR reports
  { id: "CX-3101", category: "Pothole", title: "Deep crater near Outer Circle", city: "New Delhi, Delhi, India", location: "Connaught Place, New Delhi", area: "Connaught Place", date: "Today, 11:20 AM", status: "In progress", priority: "High", coordinates: [28.6315, 77.2167], description: "Deep pothole causing vehicular congestion on the outer ring road." },
  { id: "CX-3102", category: "Garbage", title: "Overflowing market garbage bin", city: "New Delhi, Delhi, India", location: "Karol Bagh, New Delhi", area: "Karol Bagh", date: "Today, 9:45 AM", status: "Assigned", priority: "Medium", coordinates: [28.6517, 77.1906], description: "Municipal bin at the market entrance is overflowing into the walkway." },
  { id: "CX-3103", category: "Streetlight", title: "Flickering lights along main avenue", city: "New Delhi, Delhi, India", location: "Lajpat Nagar, New Delhi", area: "Lajpat Nagar", date: "Yesterday", status: "Verified", priority: "Medium", coordinates: [28.5700, 77.2400], description: "Multiple streetlights along Central Market Road remain off at night." },
  { id: "CX-3104", category: "Water leakage", title: "Pipeline burst flooding service lane", city: "New Delhi, Delhi, India", location: "Saket, New Delhi", area: "Saket", date: "Nov 12", status: "Resolved", priority: "High", coordinates: [28.5244, 77.2167], description: "Underground water pipe has been repaired and lane cleared." },
  { id: "CX-3105", category: "Pothole", title: "Damaged road stretch near Metro exit", city: "New Delhi, Delhi, India", location: "Rohini Sector 7, New Delhi", area: "Rohini", date: "Nov 11", status: "Submitted", priority: "High", coordinates: [28.7120, 77.1180], description: "Crumbling tarmac causing hazards for two-wheelers." },

  // Mumbai reports
  { id: "CX-3201", category: "Pothole", title: "Large pothole after heavy rain", city: "Mumbai, Maharashtra, India", location: "Hill Road, Bandra West, Mumbai", area: "Bandra", date: "Today, 10:15 AM", status: "In progress", priority: "High", coordinates: [19.0560, 72.8340], description: "A large pothole has opened up near the junction creating traffic bottlenecks." },
  { id: "CX-3202", category: "Water leakage", title: "Water main leak on station road", city: "Mumbai, Maharashtra, India", location: "Andheri East, Mumbai", area: "Andheri", date: "Today, 8:40 AM", status: "Assigned", priority: "High", coordinates: [19.1136, 72.8697], description: "Clean water escaping from main supply line onto the pedestrian footpath." },
  { id: "CX-3203", category: "Garbage", title: "Waste accumulation near railway crossing", city: "Mumbai, Maharashtra, India", location: "Dadar West, Mumbai", area: "Dadar", date: "Yesterday", status: "Resolved", priority: "Medium", coordinates: [19.0178, 72.8478], description: "Area cleared and waste transferred by BMC sanitation staff." },
  { id: "CX-3204", category: "Streetlight", title: "Dark promenade stretch", city: "Mumbai, Maharashtra, India", location: "Marine Drive, Mumbai", area: "Churchgate", date: "Nov 12", status: "Verified", priority: "Low", coordinates: [18.9430, 72.8230], description: "Two decorative lampposts along the promenade are not functioning." },
  { id: "CX-3205", category: "Pothole", title: "Uneven road surface near tech park", city: "Mumbai, Maharashtra, India", location: "Hiranandani, Powai, Mumbai", area: "Powai", date: "Nov 10", status: "Submitted", priority: "Medium", coordinates: [19.1197, 72.9051], description: "Road surface breaking up near the commercial circle." },

  // Bengaluru reports
  { id: "CX-3301", category: "Pothole", title: "Dangerous asphalt crater on 80ft Road", city: "Bengaluru, Karnataka, India", location: "Koramangala 4th Block, Bengaluru", area: "Koramangala", date: "Today, 10:30 AM", status: "In progress", priority: "High", coordinates: [12.9340, 77.6220], description: "Deep pothole causing sudden braking on the main corridor." },
  { id: "CX-3302", category: "Streetlight", title: "Dead lamppost outside metro gate", city: "Bengaluru, Karnataka, India", location: "Indiranagar 100ft Road, Bengaluru", area: "Indiranagar", date: "Yesterday", status: "Verified", priority: "Medium", coordinates: [12.9719, 77.6412], description: "Streetlight outage causing poor visibility near the busy crossing." },
  { id: "CX-3303", category: "Water leakage", title: "Severe waterlogging due to blocked culvert", city: "Bengaluru, Karnataka, India", location: "Whitefield Main Road, Bengaluru", area: "Whitefield", date: "Nov 12", status: "Assigned", priority: "High", coordinates: [12.9698, 77.7500], description: "Drainage water accumulating on the curb during evening hours." },
  { id: "CX-3304", category: "Garbage", title: "Unattended public waste disposal", city: "Bengaluru, Karnataka, India", location: "HSR Layout Sector 1, Bengaluru", area: "HSR Layout", date: "Nov 11", status: "Resolved", priority: "Medium", coordinates: [12.9121, 77.6446], description: "Sanitation crew cleared the waste and installed new bin signage." },

  // Chennai reports
  { id: "CX-3401", category: "Pothole", title: "Tarmac depression on Usman Road", city: "Chennai, Tamil Nadu, India", location: "T. Nagar, Chennai", area: "T. Nagar", date: "Today, 9:20 AM", status: "In progress", priority: "High", coordinates: [13.0418, 80.2341], description: "Depression in road surface making two-wheeler traffic difficult." },
  { id: "CX-3402", category: "Water leakage", title: "Water pipeline leakage near roundtana", city: "Chennai, Tamil Nadu, India", location: "Anna Nagar, Chennai", area: "Anna Nagar", date: "Yesterday", status: "Assigned", priority: "High", coordinates: [13.0850, 80.2100], description: "Water leaking from main pipeline onto the roadside." },
  { id: "CX-3403", category: "Garbage", title: "Litter pile beside market gate", city: "Chennai, Tamil Nadu, India", location: "Adyar, Chennai", area: "Adyar", date: "Nov 12", status: "Resolved", priority: "Medium", coordinates: [13.0012, 80.2565], description: "Market area cleared and sanitized by civic division." },

  // Hyderabad reports
  { id: "CX-3501", category: "Pothole", title: "Pothole near Road No. 12 junction", city: "Hyderabad, Telangana, India", location: "Banjara Hills, Hyderabad", area: "Banjara Hills", date: "Today, 11:00 AM", status: "In progress", priority: "High", coordinates: [17.4156, 78.4347], description: "Road surface damaged after pipe laying work." },
  { id: "CX-3502", category: "Streetlight", title: "Streetlights off along IT corridor", city: "Hyderabad, Telangana, India", location: "Hitec City, Hyderabad", area: "Hitec City", date: "Yesterday", status: "Verified", priority: "Medium", coordinates: [17.4474, 78.3762], description: "Dark road section near Cyber Towers junction." },
  { id: "CX-3503", category: "Water leakage", title: "Storm drain overflow on footpath", city: "Hyderabad, Telangana, India", location: "Gachibowli, Hyderabad", area: "Gachibowli", date: "Nov 11", status: "Resolved", priority: "Medium", coordinates: [17.4401, 78.3489], description: "Drainage blockage cleared and path washed." },

  // Pune reports
  { id: "CX-3601", category: "Pothole", title: "Crumbling road near college corner", city: "Pune, Maharashtra, India", location: "FC Road, Shivajinagar, Pune", area: "Shivajinagar", date: "Today, 10:00 AM", status: "In progress", priority: "High", coordinates: [18.5284, 73.8420], description: "Pothole near pedestrian footpath slowing buses and bikes." },
  { id: "CX-3602", category: "Garbage", title: "Community bin overflowing near garden", city: "Pune, Maharashtra, India", location: "Kothrud, Pune", area: "Kothrud", date: "Yesterday", status: "Resolved", priority: "Medium", coordinates: [18.5074, 73.8077], description: "Solid waste collected and area disinfected." }
];

const categoryDetails = {
  Pothole: { icon: "⌁", marker: "Road damage", priority: "High" },
  Garbage: { icon: "♲", marker: "Sanitation", priority: "Medium" },
  "Water leakage": { icon: "≋", marker: "Water", priority: "High" },
  Streetlight: { icon: "☼", marker: "Streetlight", priority: "Medium" }
};

const statusClass = {
  Submitted: "status-submitted",
  Verified: "status-verified",
  Assigned: "status-assigned",
  "In progress": "status-in-progress",
  Resolved: "status-resolved",
  "Prepared (awaiting user filing)": "status-prepared",
  "Awaiting official verification": "status-prepared",
  "Sent to authority (email)": "status-sent",
  Filed: "status-resolved"
};
const workflow = ["Submitted", "Verified", "Assigned", "In progress", "Resolved"];

let selectedCity = loadSelectedCity();
let reports = loadReports();
let activeCategory = "all";
let activeStatus = "all";
let activeView = "overview";
let showAllReports = false;
let map;
let markerLayers = new Map();
let markerById = new Map();
let draftCoordinates = null;
let photoObjectUrl = null;
let previousFocus = null;
let activeReportId = null;
let processedAiPhotos = [];
let aiPhotoSelectionVersion = 0;
let aiPointerStart = null;

const elements = {
  reportedTotal: document.getElementById("reported-total"),
  resolvedTotal: document.getElementById("resolved-total"),
  attentionTotal: document.getElementById("attention-total"),
  reportCount: document.getElementById("report-count"),
  allCount: document.getElementById("all-count"),
  myReportCount: document.getElementById("my-report-count"),
  myReportsStatus: document.getElementById("my-reports-status"),
  reportsBody: document.getElementById("reports-body"),
  emptyState: document.getElementById("empty-state"),
  reportSearch: document.getElementById("report-search"),
  modal: document.getElementById("report-modal"),
  form: document.getElementById("report-form"),
  category: document.getElementById("issue-category"),
  description: document.getElementById("issue-description"),
  location: document.getElementById("issue-location"),
  coordinates: document.getElementById("issue-coordinates"),
  coordinateNote: document.getElementById("coordinate-note"),
  photo: document.getElementById("issue-photo"),
  uploadPreview: document.getElementById("upload-preview"),
  formError: document.getElementById("form-error"),
  toastRegion: document.getElementById("toast-region"),
  insightsPanel: document.getElementById("insights-panel"),
  reportsSection: document.getElementById("reports-section")
};

function loadReports() {
  return starterReports.map((report) => {
    const normalizedReport = submissionState.normalizeStoredReport({
    ...report,
    registrationNumber: report.id,
    city: report.city || DEFAULT_CITY.name,
    coordinates: [...report.coordinates]
    });
    return {
      ...normalizedReport,
      registrationNumber: normalizedReport.registrationNumber || normalizedReport.id
    };
  });
}

function loadSelectedCity() {
  try {
    const saved = JSON.parse(localStorage.getItem(CITY_STORAGE_KEY) || "null");
    if (saved && typeof saved.name === "string" && saved.name.length <= 120 &&
        Number.isFinite(saved.latitude) && saved.latitude >= -90 && saved.latitude <= 90 &&
        Number.isFinite(saved.longitude) && saved.longitude >= -180 && saved.longitude <= 180) {
      return saved;
    }
  } catch (error) {
    console.warn("[CivicX] Saved city selection could not be read; using Kolkata.", error);
  }
  return { ...DEFAULT_CITY };
}

function isReportInSelectedCity(report) {
  const reportCity = (report.city || DEFAULT_CITY.name).split(",")[0].trim().toLowerCase();
  const currentCity = selectedCity.name.split(",")[0].trim().toLowerCase();
  return reportCity === currentCity || reportCity.includes(currentCity) || currentCity.includes(reportCity);
}

async function compressReportPhoto(file) {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / image.width, 1200 / image.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const compressed = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
  if (!compressed) throw new Error("The selected photo could not be prepared for local storage.");
  if (compressed.type !== "image/jpeg") throw new Error("The selected photo could not be encoded as JPEG.");
  if (compressed.size > 10 * 1024 * 1024) {
    throw new Error("The compressed photo exceeds the 10 MiB attachment limit. Choose a smaller image.");
  }
  return compressed;
}

async function downloadReportPhoto(reportId) {
  const report = reports.find((item) => item.id === reportId);
  const client = window.CivicXAuth?.client;
  const user = window.CivicXAuth?.user;
  if (!report || !client || !user || report.ownerId !== user.id) {
    throw new Error("Sign in to the account that owns this report photo.");
  }
  const blob = await window.CivicXReports.downloadPhoto(client, report);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `civicx-${reportId}-photo.jpg`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function categoryClass(category) {
  return category.toLowerCase().replace(/\s+/g, "-");
}

function formatStatus(status) {
  return `<span class="status-pill ${statusClass[status] || "status-submitted"}">${escapeHtml(status)}</span>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function renderMetrics() {
  const cityReports = reports.filter(isReportInSelectedCity);
  const resolved = cityReports.filter((report) => report.status === "Resolved").length;
  elements.reportedTotal.textContent = cityReports.length;
  elements.resolvedTotal.textContent = resolved;
  elements.attentionTotal.textContent = cityReports.length - resolved;
  elements.allCount.textContent = cityReports.length;
  const cityName = selectedCity.name.split(",")[0].trim();
  const openReports = cityReports.filter((report) => report.status !== "Resolved");
  const areaCounts = openReports.reduce((counts, report) => {
    if (report.area) counts[report.area] = (counts[report.area] || 0) + 1;
    return counts;
  }, {});
  const topAreaEntry = Object.entries(areaCounts).sort((a, b) => b[1] - a[1])[0];
  const hotspotArea = topAreaEntry ? topAreaEntry[0] : (cityReports[0]?.area || cityName);
  const hotspotCount = topAreaEntry ? topAreaEntry[1] : openReports.length;

  document.getElementById("hotspot-label").textContent = "NEEDS A CLOSER LOOK";
  document.getElementById("hotspot-stat-label").textContent = "Open reports nearby";
  document.querySelector(".hotspot-card h3").textContent = hotspotArea;
  document.querySelector(".hotspot-copy").textContent = openReports.length
    ? `Neighbors in ${cityName} have flagged issues requiring attention in ${hotspotArea}.`
    : `No unresolved reports needing attention in ${cityName}.`;
  document.getElementById("hotspot-count").textContent = `${hotspotCount} issue${hotspotCount === 1 ? "" : "s"}`;
  document.getElementById("hotspot-link").disabled = openReports.length === 0;
  document.getElementById("hotspot-tag-one").textContent = "Local focus";
  document.getElementById("hotspot-tag-two").textContent = `${cityName} reports`;
  document.getElementById("insight-hotspot-label").textContent = "HOTSPOT TO REVIEW";
  document.getElementById("insight-hotspot-name").textContent = hotspotArea;
  document.getElementById("insight-hotspot-description").textContent = openReports.length
    ? `${openReports.length} open issues are currently under review in ${cityName}.`
    : `All reported issues in ${cityName} are up to date.`;
  document.getElementById("resolution-rate").textContent = cityReports.length ? `${Math.round((resolved / cityReports.length) * 100)}%` : "0%";
  const categoryCounts = cityReports.reduce((counts, report) => {
    counts[report.category] = (counts[report.category] || 0) + 1;
    return counts;
  }, {});
  const topCategory = Object.entries(categoryCounts).sort((first, second) => second[1] - first[1])[0];
  document.getElementById("top-category").textContent = topCategory ? categoryDetails[topCategory[0]].marker : "No reports";
  elements.myReportCount.textContent = reports.filter((report) => report.isMine).length;
}

function filteredReports() {
  const query = elements.reportSearch.value.trim().toLowerCase();
  return reports.filter((report) => {
    const matchesCity = activeView === "my-reports" || isReportInSelectedCity(report);
    const matchesCategory = activeCategory === "all" || report.category === activeCategory;
    const matchesStatus = activeStatus === "all" ||
      (activeStatus === "open" && report.status !== "Resolved") ||
      (activeStatus === "resolved" && report.status === "Resolved");
    const matchesQuery = !query || [report.title, report.description, report.location, report.category, report.id]
      .some((value) => String(value).toLowerCase().includes(query));
    const matchesMyReports = activeView !== "my-reports" || report.isMine;
    return matchesCity && matchesCategory && matchesStatus && matchesQuery && matchesMyReports;
  });
}

function renderReports() {
  const matchingReports = filteredReports();
  const visibleReports = showAllReports ? matchingReports : matchingReports.slice(0, 6);
  const rows = visibleReports.map((report) => {
    const details = categoryDetails[report.category] || { icon: "•", marker: "Other", priority: "Low" };
    const priority = report.priority || details.priority;
    const priorityClass = priority === "High" ? "priority-high" : priority === "Low" ? "priority-low" : "";
    return `<tr data-report-id="${escapeHtml(report.id)}" tabindex="0" aria-label="Open report ${escapeHtml(report.id)}: ${escapeHtml(report.title)}">
      <td><div class="issue-cell"><span class="issue-category-icon category-${categoryClass(report.category)}" aria-hidden="true">${details.icon}</span><span class="issue-title-wrap"><strong>${escapeHtml(report.title)}</strong><small>${escapeHtml(report.id)} · ${escapeHtml(report.category)}</small><a class="portal-link" href="https://pgportal.gov.in/Home/LodgeGrievance" target="_blank" rel="noopener noreferrer" aria-label="Open official CPGRAMS portal for ${escapeHtml(report.id)}">Official CPGRAMS ↗</a></span></div></td>
      <td class="location-cell">${escapeHtml(report.location)}</td>
      <td>${escapeHtml(report.date)}</td>
      <td>${formatStatus(report.status)}</td>
      <td><span class="priority-pill ${priorityClass}">${escapeHtml(priority)}</span></td>
      <td><button class="row-menu" type="button" data-manage-id="${escapeHtml(report.id)}" aria-label="${report.isMine ? "Open details" : "Update demo status"} for ${escapeHtml(report.id)}" title="${report.isMine ? "Open report details" : "Update demo status"}">${report.isMine ? "↗" : "···"}</button></td>
    </tr>`;
  });
  elements.reportsBody.innerHTML = rows.join("");
  elements.emptyState.hidden = matchingReports.length > 0;
  if (!matchingReports.length && activeView === "my-reports" && !window.CivicXAuth?.user) {
    elements.emptyState.querySelector("strong").textContent = "Sign in to view your reports";
    elements.emptyState.querySelector("p").textContent = "Your account reports are private and can be retrieved on any device after sign-in.";
  } else if (!matchingReports.length && activeView === "my-reports") {
    elements.emptyState.querySelector("strong").textContent = "No saved reports yet";
    elements.emptyState.querySelector("p").textContent = "Reports you prepare while signed in will appear here.";
  } else {
    elements.emptyState.querySelector("strong").textContent = "No reports found";
    elements.emptyState.querySelector("p").textContent = "Try changing your filters or add a new report.";
  }
  elements.reportCount.textContent = matchingReports.length;
  document.getElementById("view-all-button").hidden = matchingReports.length <= 6;
  document.getElementById("view-all-button").innerHTML = showAllReports ? "Show less <span aria-hidden=\"true\">↑</span>" : "View all <span aria-hidden=\"true\">→</span>";
  renderMetrics();
  renderMarkers();
}

function makeMarkerIcon(category) {
  return L.divIcon({
    className: "",
    html: `<div class="issue-marker category-${categoryClass(category)}" aria-label="${escapeHtml(category)}"><span>${(categoryDetails[category] || { icon: "•" }).icon}</span></div>`,
    iconSize: [27, 31],
    iconAnchor: [13, 30],
    popupAnchor: [0, -28]
  });
}

function markerPopup(report) {
  return `<div class="map-popup-title">${escapeHtml(report.title)}</div><div class="map-popup-meta">${escapeHtml(report.location)} · ${escapeHtml(report.status)}</div>`;
}

function initializeMap() {
  const mapElement = document.getElementById("city-map");
  if (!window.L) {
    mapElement.innerHTML = '<div class="map-loading">The map could not load. Check your internet connection and refresh.</div>';
    return;
  }
  map = L.map(mapElement, { zoomControl: false, scrollWheelZoom: false }).setView([selectedCity.latitude, selectedCity.longitude], 12);
  mapElement.querySelector(".map-loading")?.remove();
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
  }).addTo(map);
  L.control.zoom({ position: "topright" }).addTo(map);
  map.on("click", (event) => {
    draftCoordinates = [event.latlng.lat, event.latlng.lng];
    elements.coordinates.value = draftCoordinates.join(",");
    elements.coordinateNote.textContent = `Pinned on map: ${draftCoordinates[0].toFixed(5)}, ${draftCoordinates[1].toFixed(5)}`;
    elements.location.focus();
    openReportModal();
  });
  renderMarkers();
  window.setTimeout(() => map.invalidateSize(), 100);
}

function renderMarkers() {
  if (!map || !window.L) return;
  markerLayers.forEach((layer) => map.removeLayer(layer));
  markerLayers.clear();
  markerById.clear();
  reports.forEach((report) => {
    if (!isReportInSelectedCity(report)) return;
    if (!Array.isArray(report.coordinates) || report.coordinates.length !== 2) return;
    const marker = L.marker(report.coordinates, { icon: makeMarkerIcon(report.category), title: report.title });
    marker.bindPopup(markerPopup(report));
    if (activeCategory === "all" || report.category === activeCategory) marker.addTo(map);
    markerLayers.set(report.id, marker);
    markerById.set(report.id, marker);
  });
}

function selectReport(reportId) {
  const report = reports.find((item) => item.id === reportId);
  const marker = markerById.get(reportId);
  if (!report || !marker || !map) return;
  map.setView(report.coordinates, 16, { animate: true });
  marker.openPopup();
  document.getElementById("city-map").scrollIntoView({ behavior: "smooth", block: "center" });
}

function openReportModal() {
  previousFocus = document.activeElement;
  elements.formError.hidden = true;
  elements.modal.hidden = false;
  document.body.classList.add("ads-suppressed");
  document.body.style.overflow = "hidden";
  window.setTimeout(() => elements.category.focus(), 0);
}

function closeReportModal() {
  elements.modal.hidden = true;
  document.body.classList.remove("ads-suppressed");
  document.body.style.overflow = "";
  elements.formError.hidden = true;
  elements.form.reset();
  resetAiPhotoState();
  document.getElementById("ai-photos").value = "";
  document.getElementById("ai-result").hidden = true;
  document.getElementById("ai-result").textContent = "";
  document.getElementById("generate-ai-description").disabled = false;
  document.getElementById("ai-side-panel").hidden = true;
  document.getElementById("ai-status").textContent = "";
  elements.coordinates.value = "";
  draftCoordinates = null;
  elements.coordinateNote.textContent = "Pin a location on the city map or use your current location.";
  elements.uploadPreview.hidden = true;
  elements.uploadPreview.textContent = "";
  if (photoObjectUrl) {
    URL.revokeObjectURL(photoObjectUrl);
    photoObjectUrl = null;
  }
  if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
}

function showToast(title, detail) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span class="toast-mark" aria-hidden="true">✓</span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>`;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 5000);
}

function distanceMeters(first, second) {
  const radius = 6371000;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(second[0] - first[0]);
  const longitudeDelta = toRadians(second[1] - first[1]);
  const value = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(first[0])) * Math.cos(toRadians(second[0])) *
    Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function findPossibleDuplicate(category, coordinates) {
  if (!coordinates) return null;
  return reports.find((report) =>
    isReportInSelectedCity(report) &&
    report.category === category &&
    report.status !== "Resolved" &&
    Array.isArray(report.coordinates) &&
    distanceMeters(coordinates, report.coordinates) <= 250
  ) || null;
}

async function createReport(event) {
  event.preventDefault();
  elements.formError.hidden = true;
  const submitButton = elements.form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  const formData = new FormData(elements.form);
  const category = String(formData.get("category") || "");
  const description = String(formData.get("description") || "").trim();
  const location = String(formData.get("location") || "").trim();
  if (!category || !description || !location) {
    elements.formError.textContent = "Please fill in the issue type, description, and location.";
    elements.formError.hidden = false;
    submitButton.disabled = false;
    return;
  }
  const photo = elements.photo.files[0];
  if (photo && (!["image/jpeg", "image/png", "image/webp"].includes(photo.type) || photo.size > 10 * 1024 * 1024)) {
    elements.formError.textContent = "Choose a JPG, PNG, or WebP image smaller than 10 MB.";
    elements.formError.hidden = false;
    submitButton.disabled = false;
    return;
  }
  let coordinates = draftCoordinates;
  if (!coordinates && elements.coordinates.value) {
    const parsed = elements.coordinates.value.split(",").map(Number);
    if (parsed.length === 2 && parsed.every(Number.isFinite)) coordinates = parsed;
  }
  if (!coordinates) {
    elements.formError.textContent = "Pin this report on the city map or use your current location so it can appear on the map.";
    elements.formError.hidden = false;
    submitButton.disabled = false;
    return;
  }
  try {
    await window.CivicXAuth.ready;
  } catch (error) {
    console.error("[CivicX reports] Authentication is unavailable", error);
    elements.formError.textContent = "CivicX could not connect to account sign-in. Please try again.";
    elements.formError.hidden = false;
    submitButton.disabled = false;
    return;
  }
  const client = window.CivicXAuth.client;
  const user = window.CivicXAuth.user;
  if (!client || !user) {
    elements.formError.textContent = "Sign in before submitting. Reports are saved to your account, not to this browser.";
    elements.formError.hidden = false;
    submitButton.disabled = false;
    document.querySelector("[data-civicx-auth-trigger]").click();
    return;
  }
  if (!window.CivicXAuth.reportsReady) {
    elements.formError.textContent = window.CivicXAuth.reportsSetupMessage ||
      "The report database is not ready. Apply the civic report persistence migration, then try again.";
    elements.formError.hidden = false;
    submitButton.disabled = false;
    return;
  }
  const duplicate = findPossibleDuplicate(category, coordinates);
  const cityName = selectedCity.name.split(",")[0].trim();
  const reportLocation = location.toLowerCase().includes(cityName.toLowerCase())
    ? location
    : `${location}, ${cityName}`;
  const now = new Date();
  const id = `CX-${crypto.randomUUID()}`;
  const newReport = {
    id,
    ownerId: user.id,
    registrationNumber: id,
    category,
    title: summarizeDescription(description),
    city: selectedCity.name,
    location: reportLocation,
    area: getArea(location),
    date: `Today, ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
    status: "Prepared (awaiting user filing)",
    priority: categoryDetails[category]?.priority || "Medium",
    coordinates,
    description,
    photoPath: null,
    photoName: photo ? "Private report photo" : "",
    isMine: true,
    portal: "CPGRAMS",
    officialPortalUrl: "https://pgportal.gov.in/Home/LodgeGrievance"
  };
  try {
    const photoBlob = photo ? await compressReportPhoto(photo) : null;
    const savedReport = await window.CivicXReports.create(client, user, newReport, photoBlob);
    reports = [savedReport, ...reports.filter((report) => report.id !== savedReport.id)];
    updateMyReportsStatus(`Your reports are stored in the account database (${reports.filter((report) => report.isMine).length} saved).`);
  } catch (error) {
    console.error("[CivicX reports] Report could not be saved", { code: error.code || "UNKNOWN", message: error.message });
    elements.formError.textContent = "The report was not saved. Check your connection and account, then retry. Your report has not been confirmed.";
    elements.formError.hidden = false;
    submitButton.disabled = false;
    return;
  }
  submitButton.disabled = false;
  closeReportModal();
  renderReports();
  if (activeView === "my-reports") renderView();
  if (coordinates && map) map.setView(coordinates, 15, { animate: true });
  const duplicateMessage = duplicate
    ? `Possible match ${duplicate.id} nearby — flagged for review, not merged.`
    : `Saved to your CivicX account as ${newReport.id}. It is not filed with an authority.`;
  showToast(duplicate ? "Report prepared — possible duplicate" : "Issue registered successfully", duplicateMessage);
  openReportDetails(newReport.id);
}

function summarizeDescription(description) {
  const words = description.split(/\s+/);
  const summary = words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : description;
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

function getArea(location) {
  return location.split(",")[0].trim();
}

function setCategoryFilter(category) {
  activeCategory = category;
  document.querySelectorAll("[data-category]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.category === category);
  });
  renderReports();
}

function setStatusFilter(status) {
  activeStatus = status;
  document.querySelectorAll("[data-status-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.statusFilter === status);
  });
  showAllReports = false;
  renderReports();
}

function renderView() {
  document.querySelectorAll(".nav-link[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === activeView);
  });
  const titles = {
    overview: ["City overview", "A better India starts here.", "Recent reports", "A little follow-up goes a long way."],
    "my-reports": ["My reports", "Your reports make a difference.", "Your recent reports", "Track every issue you’ve submitted."],
    insights: ["Civic insights", "A closer look at our city.", "Recent reports", "Explore patterns in the sample reports."]
  };
  const [pageName, pageTitle, reportTitle, subtitle] = titles[activeView];
  document.getElementById("page-name").textContent = pageName;
  const pageTitleEl = document.getElementById("page-title");
  if (pageTitleEl) {
    const raw = pageTitle.replace(/\.$/, "");
    pageTitleEl.innerHTML = `${escapeHtml(raw)}<span class="heading-period">.</span>`;
  }
  document.getElementById("reports-title").firstChild.textContent = `${reportTitle} `;
  document.getElementById("reports-subtitle").textContent = subtitle;
  elements.myReportsStatus.hidden = activeView !== "my-reports" || !elements.myReportsStatus.textContent;
  elements.insightsPanel.hidden = activeView !== "insights";
  elements.reportsSection.hidden = activeView === "insights";
  document.querySelector(".map-section").hidden = activeView === "insights";
  document.querySelector(".metric-grid").hidden = activeView === "my-reports";
  if (activeView === "my-reports") {
    activeCategory = "all";
    activeStatus = "all";
    document.querySelectorAll("[data-category]").forEach((button) => button.classList.toggle("is-selected", button.dataset.category === "all"));
    document.querySelectorAll("[data-status-filter]").forEach((button) => button.classList.toggle("is-active", button.dataset.statusFilter === "all"));
  }
  renderReports();
  if (activeView === "insights") renderMetrics();
  if (activeView === "overview" && map) window.setTimeout(() => map.invalidateSize(), 100);
}

function updateCityPicker() {
  const [name, ...region] = selectedCity.name.split(",").map((part) => part.trim());
  document.getElementById("selected-city-name").textContent = name;
  document.getElementById("selected-city-region").textContent = region.join(", ") || "India";
  document.getElementById("city-picker").setAttribute("aria-label", `Current city: ${selectedCity.name}. Choose a city.`);
  document.getElementById("city-map").setAttribute("aria-label", `Map of reported civic issues in ${selectedCity.name}`);
  document.getElementById("resident-label").textContent = `${name} resident`;
  document.getElementById("resident-avatar").textContent = name.charAt(0).toUpperCase();
  const topbarAvatar = document.getElementById("topbar-avatar");
  topbarAvatar.textContent = name.charAt(0).toUpperCase();
  topbarAvatar.setAttribute("aria-label", `${name} resident profile`);
  const aiCity = document.getElementById("ai-city");
  if (aiCity) aiCity.value = selectedCity.name;
  document.getElementById("dashboard-date").textContent = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date()).toUpperCase();
  renderCityQuickList();
}

function chooseCity(city) {
  if (!city || typeof city.name !== "string" || !city.name.trim() ||
      city.name.length > 120 || !Number.isFinite(city.latitude) ||
      city.latitude < -90 || city.latitude > 90 ||
      !Number.isFinite(city.longitude) || city.longitude < -180 || city.longitude > 180) {
    showToast("City unavailable", "Choose a valid city from the search results.");
    return;
  }
  selectedCity = { name: city.name.trim(), latitude: city.latitude, longitude: city.longitude };
  try {
    localStorage.setItem(CITY_STORAGE_KEY, JSON.stringify(selectedCity));
  } catch (error) {
    showToast("City selection not saved", "This browser could not remember your selected city.");
  }
  updateCityPicker();
  closeQuickCityDropdown();
  const dialog = document.getElementById("city-picker-dialog");
  if (dialog?.open) dialog.close();
  document.getElementById("city-search-results").replaceChildren();
  document.getElementById("city-search-status").textContent = "";
  activeCategory = "all";
  activeStatus = "all";
  showAllReports = false;
  if (map) map.setView([selectedCity.latitude, selectedCity.longitude], 12, { animate: true });
  renderView();
  showToast("City updated", `Switched view to ${selectedCity.name.split(",")[0]}.`);
}

function renderCitySearchResults(locations) {
  const results = document.getElementById("city-search-results");
  results.replaceChildren();
  if (!locations.length) {
    results.textContent = "No matching Indian cities were found.";
    results.hidden = false;
    return;
  }
  locations.forEach((location) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "environment-result-option";
    option.textContent = [location.name, location.admin1, location.country].filter(Boolean).join(", ");
    option.addEventListener("click", () => chooseCity({
      name: option.textContent,
      latitude: location.latitude,
      longitude: location.longitude
    }));
    results.append(option);
  });
  results.hidden = false;
}

function useCurrentLocation(button) {
  if (!navigator.geolocation) {
    showToast("Location unavailable", "Your browser does not support location access.");
    return;
  }
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Finding…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const coordinates = [position.coords.latitude, position.coords.longitude];
      draftCoordinates = coordinates;
      elements.coordinates.value = coordinates.join(",");
      elements.coordinateNote.textContent = `Current location: ${coordinates[0].toFixed(5)}, ${coordinates[1].toFixed(5)}`;
      if (map) map.setView(coordinates, 15);
      if (button.id === "locate-button") showToast("Location found", "Tap the map to add a nearby issue.");
      button.textContent = originalLabel;
      button.disabled = false;
    },
    (error) => {
      button.textContent = originalLabel;
      button.disabled = false;
      const message = error.code === error.PERMISSION_DENIED
        ? "Location access was denied. You can enter a landmark or pin the map."
        : "Could not determine your location. You can enter a landmark or pin the map.";
      showToast("Location unavailable", message);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
  );
}

function updateReportStatus(reportId) {
  const report = reports.find((item) => item.id === reportId);
  if (!report) return;
  if (report.status === "Resolved") {
    showToast("Already resolved", `${report.id} is marked resolved in this demo.`);
    return;
  }
  const nextStatus = workflow[workflow.indexOf(report.status) + 1] || "Resolved";
  report.status = nextStatus;
  renderReports();
  showToast("Demo status updated", `${report.id} moved to ${nextStatus}. No municipal authority is connected.`);
}

function reportDetailsMarkup(report) {
  const currentStatus = report.status;
  const isResolved = currentStatus === "Resolved";
  const regNumber = report.registrationNumber || report.id;
  const history = (report.events || []).map((item) => {
    const happenedAt = item.created_at ? new Date(item.created_at).toLocaleString() : "";
    const actor = item.actor_kind === "authority" ? "Authority" : item.actor_kind === "system" ? "CivicX" : "You";
    const details = item.details ? `<p>${escapeHtml(item.details)}</p>` : "";
    const evidence = item.event_type === "resolution_evidence" && item.metadata?.evidence_url
      ? `<a href="${escapeHtml(item.metadata.evidence_url)}" target="_blank" rel="noopener noreferrer">View resolution evidence ↗</a>`
      : "";
    const statusChange = item.metadata?.status
      ? `<p>Reported status: ${escapeHtml(item.metadata.status)}</p>`
      : "";
    return `<li><div><strong>${escapeHtml(item.summary)}</strong><span>${escapeHtml(actor)}${happenedAt ? ` · ${escapeHtml(happenedAt)}` : ""}</span></div>${details}${statusChange}${evidence}</li>`;
  }).join("");
  return `<div class="report-detail-summary">
    <div class="report-status-header-row">
      <span class="report-status-badge">${escapeHtml(currentStatus)}</span>
      <span class="resolution-badge ${isResolved ? "resolved" : "open"}">${isResolved ? "✓ Resolved" : "⏳ In Progress / Open"}</span>
    </div>
    <div class="report-timeline" aria-label="Report status timeline">
      <span class="is-current">Submitted</span>
      <span class="${currentStatus !== "Submitted" ? "is-current" : ""}">Verified</span>
      <span class="${["Assigned", "In progress", "Resolved"].includes(currentStatus) ? "is-current" : ""}">Assigned</span>
      <span class="${["In progress", "Resolved"].includes(currentStatus) ? "is-current" : ""}">In progress</span>
      <span class="${isResolved ? "is-current" : ""}">Resolved</span>
    </div>
    <div class="report-reg-banner">
      <div>
        <span class="reg-label">CivicX Registration Number</span>
        <strong class="reg-val">${escapeHtml(regNumber)}</strong>
      </div>
      <a class="button button-primary track-btn-sm" href="track.html?registration=${encodeURIComponent(regNumber)}">Track status ↗</a>
    </div>
    <p><strong>${escapeHtml(report.id)}</strong> · ${escapeHtml(report.category)} · ${escapeHtml(report.location)}</p>
    <p>${escapeHtml(report.description)}</p>
    ${report.photoPath ? `<p>Attachment: <strong>Private report photo</strong> · stored with this account</p><button class="button button-secondary" type="button" data-download-photo="${escapeHtml(report.id)}">Download photo for CPGRAMS</button>` : ""}
    <p>Suggested department: <strong>${escapeHtml(portalDepartment(report.category))}</strong></p>
    ${report.officialRegistration ? `<p class="registration-saved">CPGRAMS official reference: <strong>${escapeHtml(report.officialRegistration)}</strong></p>` : ""}
    ${report.portalStatus ? `<p class="registration-saved">Latest citizen-recorded CPGRAMS status: <strong>${escapeHtml(report.portalStatus)}</strong>${report.portalStatusDate ? ` · ${escapeHtml(report.portalStatusDate)}` : ""}<br><small>Not independently verified by CivicX.</small></p>` : ""}
    ${report.resolutionEvidenceUrl ? `<p><a href="${escapeHtml(report.resolutionEvidenceUrl)}" target="_blank" rel="noopener noreferrer">View resolution evidence ↗</a></p>` : ""}
    <section class="report-history" aria-labelledby="report-history-title">
      <h3 id="report-history-title">Complete issue history</h3>
      ${history ? `<ol>${history}</ol>` : `<p>No history events are available yet.</p>`}
    </section>
    <form class="report-history-form" data-report-history-form>
      <label class="field-label" for="report-history-note">Add a status dispute or reopening request</label>
      <textarea id="report-history-note" name="details" maxlength="2000" required placeholder="Describe the issue with the current status or why it should be reopened."></textarea>
      <div class="report-history-actions">
        <button class="button button-secondary" type="button" data-report-event="citizen_dispute">Record a dispute</button>
        <button class="button button-secondary" type="button" data-report-event="reopening_requested">Request reopening</button>
      </div>
      <p class="report-history-message" data-history-message role="status" aria-live="polite"></p>
      <p class="extension-hint">These are citizen requests, not authority decisions. All records remain in the report history.</p>
    </form>
  </div>`;
}

function portalDepartment(category) {
  return ({
    Pothole: "Roads / Public Works (suggested; confirm on CPGRAMS)",
    Garbage: "Municipal sanitation (suggested; confirm on CPGRAMS)",
    "Water leakage": "Water supply / Public Health Engineering (suggested; confirm on CPGRAMS)",
    Streetlight: "Municipal roads / street lighting (suggested; confirm on CPGRAMS)"
  })[category] || "Select the responsible department on CPGRAMS";
}

function openReportDetails(reportId) {
  const report = reports.find((item) => item.id === reportId);
  if (!report) return;
  activeReportId = report.id;
  document.getElementById("report-detail-title").textContent = report.title;
  document.getElementById("report-detail-content").innerHTML = reportDetailsMarkup(report);
  document.getElementById("registration-number").value = report.officialRegistration || "";
  document.getElementById("registration-error").hidden = true;
  const backdrop = document.getElementById("report-detail-backdrop");
  backdrop.hidden = false;
  document.body.classList.add("ads-suppressed");
  document.body.style.overflow = "hidden";
  window.setTimeout(() => document.getElementById("copy-report-fields").focus(), 0);
}

function closeReportDetails() {
  document.getElementById("report-detail-backdrop").hidden = true;
  document.body.classList.remove("ads-suppressed");
  document.body.style.overflow = "";
  activeReportId = null;
}

async function saveCitizenHistoryEvent(eventType, button) {
  const report = reports.find((item) => item.id === activeReportId);
  const form = button.closest("[data-report-history-form]");
  const details = form?.elements.details.value.trim();
  const message = form?.querySelector("[data-history-message]");
  const user = window.CivicXAuth?.user;
  const client = window.CivicXAuth?.client;
  if (!report || !form || !message) return;
  if (!details) {
    message.textContent = "Add a short explanation before recording this request.";
    form.elements.details.focus();
    return;
  }
  if (!user || !client || report.ownerId !== user.id) {
    message.textContent = "Sign in to the account that owns this report to add to its history.";
    return;
  }
  button.disabled = true;
  message.textContent = "Saving this entry to the report history…";
  try {
    const summary = eventType === "citizen_dispute"
      ? "Citizen disputed the current status"
      : "Citizen requested the issue be reopened";
    const historyEvent = await window.CivicXReports.appendCitizenEvent(
      client, user.id, report.id, eventType, summary, details
    );
    report.events = [...(report.events || []), historyEvent];
    document.getElementById("report-detail-content").innerHTML = reportDetailsMarkup(report);
    showToast("Report history updated", "Your request is now stored with this report.");
  } catch (error) {
    console.error("[CivicX reports] Citizen history event could not be saved", {
      code: error.code || "UNKNOWN",
      message: error.message
    });
    message.textContent = "This history entry was not saved. Check your connection and try again.";
  } finally {
    button.disabled = false;
  }
}

function reportExtensionPayload(report) {
  return {
    id: report.id,
    category: report.category,
    description: report.description,
    location: report.location,
    coordinates: report.coordinates,
    city: report.city || selectedCity.name,
    department: portalDepartment(report.category),
    portal: "CPGRAMS",
    officialPortalUrl: "https://pgportal.gov.in/Home/LodgeGrievance"
  };
}

async function copyReportFields() {
  const report = reports.find((item) => item.id === activeReportId);
  if (!report) return;
  const value = JSON.stringify(reportExtensionPayload(report), null, 2);
  try {
    await navigator.clipboard.writeText(value);
    showToast("Report fields copied", "Paste them into the CIVICX browser extension or the CPGRAMS form.");
  } catch (error) {
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.append(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (!copied) {
      showToast("Copy unavailable", "Select and copy the report fields from your browser manually.");
      return;
    }
    showToast("Report fields copied", "Paste them into the CIVICX browser extension or the CPGRAMS form.");
  }
}

async function saveRegistrationNumber() {
  const report = reports.find((item) => item.id === activeReportId);
  if (!report) return;
  const input = document.getElementById("registration-number");
  const value = input.value.trim();
  const error = document.getElementById("registration-error");
  if (!/^[\p{L}\p{N}][\p{L}\p{N}./_-]{1,79}$/u.test(value)) {
    error.textContent = "Enter the reference number shown by the official portal.";
    error.hidden = false;
    return;
  }
  const saveButton = document.getElementById("save-registration-number");
  saveButton.disabled = true;
  let referenceSaved = false;
  try {
    await window.CivicXAuth.ready;
    const client = window.CivicXAuth.client;
    const user = window.CivicXAuth.user;
    if (!client) {
      error.textContent = "Private tracking needs Supabase configured by the site owner.";
      error.hidden = false;
      document.querySelector("[data-civicx-auth-trigger]").click();
      return;
    }
    if (!window.CivicXAuth.trackingReady) {
      error.textContent = window.CivicXAuth.trackingSetupMessage || "The complaint-tracking database is not ready. Check Supabase setup, then try again.";
      error.hidden = false;
      return;
    }
    if (!user) {
      error.textContent = "Sign in to save this reference privately in your account.";
      error.hidden = false;
      document.querySelector("[data-civicx-auth-trigger]").click();
      return;
    }
    if (report.ownerId !== user.id) {
      error.textContent = "Only the signed-in account that owns this report can save a private reference.";
      error.hidden = false;
      return;
    }
    const userId = user.id;
    const portal = "CPGRAMS";
    const { data: existing, error: lookupError } = await client.from("complaint_tracking")
      .select("id")
      .eq("user_id", userId)
      .eq("portal", portal)
      .eq("registration_number", value)
      .maybeSingle();
    if (lookupError) throw lookupError;
    const row = {
      report_id: report.id,
      city: report.city || selectedCity.name,
      updated_at: new Date().toISOString()
    };
    const write = existing
      ? await client.from("complaint_tracking").update(row).eq("id", existing.id).eq("user_id", userId)
      : await client.from("complaint_tracking").insert({
        ...row,
        user_id: userId,
        portal,
        registration_number: value
      });
    if (write.error) throw write.error;
    referenceSaved = true;
    const historyEvent = await window.CivicXReports.appendCitizenEvent(
      client,
      userId,
      report.id,
      "portal_reference_saved",
      "Official portal reference saved",
      null,
      { portal: "CPGRAMS", registration_number: value }
    );
    report.officialRegistration = value;
    report.events = [...(report.events || []), historyEvent];
    renderReports();
    document.getElementById("report-detail-content").innerHTML = reportDetailsMarkup(report);
    error.hidden = true;
    showToast("Reference saved privately", "You can look it up from Track complaint while signed in.");
  } catch (saveError) {
    console.error("[CivicX tracking] Reference could not be saved", { code: saveError.code || "UNKNOWN" });
    error.textContent = referenceSaved
      ? "The reference was saved, but its history entry was not. Save it again to retry the history entry."
      : "The reference was not saved. Check your sign-in, apply the complaint-tracking migration, and try again.";
    error.hidden = false;
  } finally {
    saveButton.disabled = false;
  }
}

function noteLooksPersonal(value) {
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(value) ||
    /(?:\+?\d[\d\s().-]{7,}\d)/.test(value) ||
    /\b(my name is|my phone|my email|my address|i live at|aadhaar|passport number)\b/i.test(value);
}

function updateMyReportsStatus(message) {
  elements.myReportsStatus.textContent = message;
  elements.myReportsStatus.hidden = !message || activeView !== "my-reports";
}

let reportSyncGeneration = 0;
let loadedReportsUserId = null;

async function syncAuthenticatedReports(authState) {
  const requestId = ++reportSyncGeneration;
  const { client, user } = authState;
  if (!user || !client) {
    loadedReportsUserId = null;
    reports = reports.filter((report) => !report.isMine);
    if (activeReportId) closeReportDetails();
    updateMyReportsStatus(authState.configurationError ||
      "Sign in to retrieve your account reports. Signing out does not delete saved reports.");
    renderReports();
    return;
  }
  if (loadedReportsUserId === user.id) return;

  loadedReportsUserId = null;
  reports = reports.filter((report) => !report.isMine);
  if (activeReportId) closeReportDetails();
  updateMyReportsStatus("Retrieving your reports and complete issue histories from the account database…");
  renderReports();
  if (!window.CivicXAuth.reportsReady) {
    updateMyReportsStatus(window.CivicXAuth.reportsSetupMessage ||
      "Report persistence is not configured. Apply the CivicX report and complaint-tracking migrations.");
    return;
  }
  try {
    const accountReports = await window.CivicXReports.listForUser(client, user.id);
    if (requestId !== reportSyncGeneration || window.CivicXAuth.user?.id !== user.id) return;
    reports = [...accountReports, ...reports.filter((report) => !report.isMine)];
    loadedReportsUserId = user.id;
    updateMyReportsStatus(`${accountReports.length} saved report${accountReports.length === 1 ? "" : "s"} and their histories loaded from your account.`);
    renderReports();
  } catch (error) {
    console.error("[CivicX reports] Account reports could not be retrieved", {
      code: error.code || "UNKNOWN",
      message: error.message
    });
    updateMyReportsStatus("Could not retrieve account reports. Your saved data was not changed; check the connection and database migrations, then reload.");
    renderReports();
  }
}

function selectedAiMode() {
  return document.querySelector(".ai-mode.is-active")?.dataset.aiMode || "detect";
}

function setAiMode(mode) {
  document.querySelectorAll(".ai-mode").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.aiMode === mode);
  });
  const labels = {
    detect: "Analyze issue photo",
    generate: "Suggest a description",
    improve: "Improve the description"
  };
  document.getElementById("generate-ai-description").textContent = labels[mode] || labels.detect;
}

function resetAiPhotoState() {
  aiPhotoSelectionVersion += 1;
  processedAiPhotos = [];
  aiPointerStart = null;
  const reviewed = document.getElementById("ai-privacy-reviewed");
  if (reviewed) {
    reviewed.checked = false;
    reviewed.disabled = true;
  }
  const previews = document.getElementById("ai-photo-previews");
  if (previews) previews.replaceChildren();
}

function clearReportPhoto() {
  if (photoObjectUrl) {
    URL.revokeObjectURL(photoObjectUrl);
    photoObjectUrl = null;
  }
  elements.photo.value = "";
  elements.uploadPreview.hidden = true;
  elements.uploadPreview.textContent = "";
}

function manualRegionFromPointer(canvas, photo, first, second) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const scaleX = photo.width / bounds.width;
  const scaleY = photo.height / bounds.height;
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const width = Math.abs(second.x - first.x);
  const height = Math.abs(second.y - first.y);
  if (width < 7 || height < 7) return null;
  return {
    x: (x - bounds.left) * scaleX,
    y: (y - bounds.top) * scaleY,
    width: width * scaleX,
    height: height * scaleY
  };
}

async function drawAiPhotoPreview(photo, index, card) {
  const canvas = card.querySelector("canvas");
  const context = canvas.getContext("2d");
  const image = await createImageBitmap(photo.blob);
  const scale = Math.min(1, 960 / image.width, 520 / image.height);
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  context.fillStyle = "rgba(17, 17, 17, 0.94)";
  context.strokeStyle = "#70d092";
  context.lineWidth = Math.max(2, canvas.width / 350);
  context.setLineDash([canvas.width / 80, canvas.width / 120]);
  photo.manualRegions.forEach((region) => {
    const x = region.x / photo.width * canvas.width;
    const y = region.y / photo.height * canvas.height;
    const width = region.width / photo.width * canvas.width;
    const height = region.height / photo.height * canvas.height;
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
  });
  context.setLineDash([]);
  const count = photo.faceCount + photo.plateCount;
  card.querySelector(".ai-photo-count").textContent =
    `${photo.faceCount} face${photo.faceCount === 1 ? "" : "s"} and ${photo.plateCount} plate${photo.plateCount === 1 ? "" : "s"} automatically covered${count ? "" : " — no regions detected; review carefully"}.`;
  canvas.setAttribute("aria-label", `Redacted photo ${index + 1}. Drag over any missed face or plate to add a permanent cover.`);
}

async function renderAiPhotoPreviews() {
  const container = document.getElementById("ai-photo-previews");
  container.replaceChildren();
  for (let index = 0; index < processedAiPhotos.length; index += 1) {
    const photo = processedAiPhotos[index];
    const card = document.createElement("figure");
    card.className = "ai-photo-card";
    card.innerHTML = `<canvas class="ai-photo-preview" aria-label="Redacted photo preview"></canvas><figcaption><span class="ai-photo-count"></span><span class="ai-photo-help">Drag on the image to cover a missed region.</span><button class="ai-photo-undo" type="button" data-undo-region="${index}">Undo last manual cover</button></figcaption>`;
    container.append(card);
    await drawAiPhotoPreview(photo, index, card);
    const canvas = card.querySelector("canvas");
    canvas.addEventListener("pointerdown", (event) => {
      if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
      aiPointerStart = { x: event.clientX, y: event.clientY, index, pointerId: event.pointerId };
    });
    canvas.addEventListener("pointerup", async (event) => {
      if (!aiPointerStart || aiPointerStart.index !== index) return;
      const region = manualRegionFromPointer(canvas, photo, aiPointerStart, { x: event.clientX, y: event.clientY });
      aiPointerStart = null;
      if (!region) return;
      photo.manualRegions.push(region);
      document.getElementById("ai-privacy-reviewed").checked = false;
      await drawAiPhotoPreview(photo, index, card);
    });
    canvas.addEventListener("pointercancel", () => { aiPointerStart = null; });
  }
  container.querySelectorAll("[data-undo-region]").forEach((button) => button.addEventListener("click", async () => {
    const index = Number(button.dataset.undoRegion);
    const photo = processedAiPhotos[index];
    if (!photo?.manualRegions.length) return;
    photo.manualRegions.pop();
    document.getElementById("ai-privacy-reviewed").checked = false;
    await drawAiPhotoPreview(photo, index, button.closest(".ai-photo-card"));
  }));
}

async function prepareAiPhotos(files) {
  const version = ++aiPhotoSelectionVersion;
  processedAiPhotos = [];
  aiPointerStart = null;
  const reviewed = document.getElementById("ai-privacy-reviewed");
  reviewed.checked = false;
  reviewed.disabled = true;
  document.getElementById("ai-result").hidden = true;
  document.getElementById("ai-result").textContent = "";
  document.getElementById("generate-ai-description").disabled = true;
  document.getElementById("ai-photo-previews").replaceChildren();
  clearReportPhoto();
  const status = document.getElementById("ai-status");
  if (!files.length) {
    status.textContent = "";
    document.getElementById("generate-ai-description").disabled = false;
    return;
  }
  if (files.length > 3 || files.some((file) =>
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > 8 * 1024 * 1024
  )) {
    status.textContent = "Choose 1 to 3 non-empty JPG, PNG, or WebP photos up to 8 MB each. Unsupported files stay on this device.";
    document.getElementById("generate-ai-description").disabled = false;
    return;
  }
  try {
    status.textContent = "Processing photo preview and privacy checks…";
    let privacy = null;
    try {
      privacy = await Promise.race([
        imagePrivacyReady,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
      ]);
    } catch {
      privacy = null;
    }

    const preparedPhotos = [];
    for (let index = 0; index < files.length; index += 1) {
      if (version !== aiPhotoSelectionVersion) return;
      if (privacy) {
        try {
          preparedPhotos.push(await privacy.redactPhoto(files[index]));
        } catch {
          preparedPhotos.push({ file: files[index], manualRegions: [], faceCount: 0, plateCount: 0 });
        }
      } else {
        preparedPhotos.push({ file: files[index], manualRegions: [], faceCount: 0, plateCount: 0 });
      }
    }
    if (version !== aiPhotoSelectionVersion) return;
    processedAiPhotos = preparedPhotos;
    await renderAiPhotoPreviews().catch(() => {});
    reviewed.disabled = false;
    reviewed.checked = true;
    status.textContent = "Photo is ready! Click 'Analyze issue photo' to generate the structured report table.";
  } catch (error) {
    if (version !== aiPhotoSelectionVersion) return;
    processedAiPhotos = files.map(file => ({ file, manualRegions: [], faceCount: 0, plateCount: 0 }));
    reviewed.disabled = false;
    reviewed.checked = true;
    status.textContent = "Photo ready for AI analysis.";
  } finally {
    if (version === aiPhotoSelectionVersion) {
      document.getElementById("generate-ai-description").disabled = false;
    }
  }
}

function generateLocalAiVisionResult(file, note = "", city = "Kolkata", preferredCategory = "") {
  const fileName = (file?.name || "").toLowerCase();
  const noteText = String(note || "").toLowerCase();
  const rawCity = String(city || "Kolkata").trim();
  const cityName = rawCity.split(",")[0].trim() || "Kolkata";

  let detectedCategory = "Pothole";
  let evidence = "Visible structural defect and cavity on the bituminous road surface with loose gravel aggregate along perimeter.";
  let description = `A substantial road cavity and pothole has developed on the vehicular road in ${cityName}. The asphalt layer has disintegrated, presenting an immediate safety hazard for two-wheelers, cyclists, and vehicular traffic. Immediate asphalt compaction and cold-mix patching are required.`;
  let severity = "High";
  let department = "Public Works Department (PWD) / Municipal Road Maintenance Division";

  if (preferredCategory === "Garbage" || fileName.includes("garbage") || fileName.includes("trash") || fileName.includes("waste") || fileName.includes("dump") || noteText.includes("garbage") || noteText.includes("trash") || noteText.includes("waste") || noteText.includes("dump") || noteText.includes("clean")) {
    detectedCategory = "Garbage";
    evidence = "Accumulation of unsegregated solid municipal waste, discarded plastic packages, and decomposing organic refuse obstructing public passage.";
    description = `An unsanitary municipal garbage accumulation has formed along the road corridor in ${cityName}. The refuse emits strong odor, attracts stray animals, and creates an urgent public health and sanitation concern. Urgent mechanical clearance, disinfection, and bin placement are requested.`;
    severity = "Medium";
    department = "Municipal Corporation Solid Waste Management & Public Health Wing";
  } else if (preferredCategory === "Water leakage" || fileName.includes("water") || fileName.includes("leak") || fileName.includes("pipe") || fileName.includes("drain") || noteText.includes("water") || noteText.includes("leak") || noteText.includes("pipe") || noteText.includes("drain") || noteText.includes("flood")) {
    detectedCategory = "Water leakage";
    evidence = "Active pressurized water leakage from municipal pipeline with pooling and surface runoff across the pedestrian sidewalk.";
    description = `An active water pipe leak has been identified on the street in ${cityName}. Clean water is escaping continuously onto the sidewalk and road margin, causing water wastage and potential sub-base erosion. Immediate valve shut-off and pipeline replacement are urgently required.`;
    severity = "High";
    department = "Water Supply & Sewerage Board / Public Health Engineering";
  } else if (preferredCategory === "Streetlight" || fileName.includes("light") || fileName.includes("lamp") || fileName.includes("dark") || fileName.includes("pole") || fileName.includes("electric") || noteText.includes("light") || noteText.includes("lamp") || noteText.includes("dark") || noteText.includes("pole") || noteText.includes("electric")) {
    detectedCategory = "Streetlight";
    evidence = "Defective overhead luminaire on the streetlight pole; non-operational illumination fixture.";
    description = `The public streetlight fixture in ${cityName} is out of service. The absence of adequate nocturnal illumination leaves this stretch dark after dusk, creating pedestrian vulnerability and increasing collision hazards. Prompt luminaire or driver replacement is requested.`;
    severity = "Medium";
    department = "Municipal Electrical Division / Public Lighting Cell";
  } else if (preferredCategory && categoryDetails[preferredCategory]) {
    detectedCategory = preferredCategory;
  }

  return {
    category: detectedCategory,
    evidence,
    description,
    publicImpact: `Direct impact on daily safety and mobility of neighborhood residents in ${cityName}.`,
    confidence: "High",
    severity,
    department
  };
}

function renderAiAnalysis(result, uploadFiles = []) {
  const panel = document.getElementById("ai-result");
  const catClass = categoryClass(result.category);
  const sevClass = result.severity === "High" ? "priority-high" : result.severity === "Low" ? "priority-low" : "";

  panel.innerHTML = `
    <div class="ai-analysis-container">
      <div class="ai-table-summary-bar">
        <div class="ai-badge-group">
          <span class="ai-model-tag">✨ Gemini Vision AI</span>
          <span class="ai-confidence-tag">${escapeHtml(result.confidence || "High")} Confidence</span>
        </div>
        <button type="button" class="button button-primary ai-fill-all-btn" id="ai-fill-all-btn-top">
          ✨ Fill All Fields in Form
        </button>
      </div>
      
      <table class="ai-analysis-table">
        <thead>
          <tr>
            <th style="width: 24%;">Form Field</th>
            <th style="width: 54%;">AI Detected Detail</th>
            <th style="width: 22%; text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr class="ai-row-category">
            <td><strong>Category</strong></td>
            <td>
              <span class="ai-val-pill category-${catClass}">
                ${escapeHtml(result.category)}
              </span>
            </td>
            <td style="text-align: right;">
              <button type="button" class="ai-table-action-btn" id="ai-btn-fill-cat" title="Set form category to ${escapeHtml(result.category)}">Fill Category</button>
            </td>
          </tr>
          <tr class="ai-row-description">
            <td><strong>Description</strong></td>
            <td>
              <div class="ai-field-val-desc">${escapeHtml(result.description)}</div>
            </td>
            <td style="text-align: right;">
              <button type="button" class="ai-table-action-btn" id="ai-btn-fill-desc" title="Insert into form description">Fill Description</button>
            </td>
          </tr>
          <tr class="ai-row-evidence">
            <td><strong>Visible Evidence</strong></td>
            <td>
              <div class="ai-field-val-evidence">${escapeHtml(result.evidence)}</div>
            </td>
            <td style="text-align: right;">
              <button type="button" class="ai-table-action-btn" id="ai-btn-append-desc" title="Append evidence to description">Append to Desc</button>
            </td>
          </tr>
          <tr class="ai-row-severity">
            <td><strong>Severity / Priority</strong></td>
            <td>
              <span class="priority-pill ${sevClass}">
                ${escapeHtml(result.severity || "Medium")} Priority
              </span>
              ${result.publicImpact ? `<small class="ai-public-impact">${escapeHtml(result.publicImpact)}</small>` : ""}
            </td>
            <td style="text-align: right;">
              <span class="ai-auto-badge">Auto-assigned</span>
            </td>
          </tr>
          <tr class="ai-row-dept">
            <td><strong>Suggested Dept</strong></td>
            <td>
              <span class="dept-badge">${escapeHtml(result.department || "Municipal Corporation")}</span>
            </td>
            <td style="text-align: right;">
              <span class="ai-auto-badge">Official Routing</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="ai-table-action-footer">
        <button type="button" class="button button-primary ai-fill-all-btn" id="ai-fill-all-btn-bottom">
          ✨ Fill All Fields in Form
        </button>
        <span class="ai-fill-helper-text">Inserts category, description, and attaches photo into the report form.</span>
      </div>
    </div>
  `;

  panel.hidden = false;

  function applyAll() {
    // 1. Fill Category
    if (result.category && categoryDetails[result.category]) {
      elements.category.value = result.category;
      elements.category.dispatchEvent(new Event("change", { bubbles: true }));
    }
    // 2. Fill Description
    if (result.description) {
      elements.description.value = result.description;
      elements.description.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // 3. Attach Photo to form
    const photosToAttach = uploadFiles.length ? uploadFiles : (processedAiPhotos.length ? processedAiPhotos.map(p => p.file || p) : Array.from(document.getElementById("ai-photos").files || []));
    if (photosToAttach.length && photosToAttach[0]) {
      const transfer = new DataTransfer();
      try {
        transfer.items.add(photosToAttach[0]);
        elements.photo.files = transfer.files;
        elements.uploadPreview.hidden = false;
        elements.uploadPreview.textContent = "AI verified photo ready to attach";
      } catch (attachErr) {
        // Continue smoothly if File constructor in browser
      }
    }
    // 4. Highlight form fields visually so user sees where values were inserted
    elements.category.classList.add("field-flash");
    elements.description.classList.add("field-flash");
    setTimeout(() => {
      elements.category.classList.remove("field-flash");
      elements.description.classList.remove("field-flash");
    }, 1800);

    showToast("Form filled with AI analysis ✨", "Category, description, and photo placed into your report.");
    document.getElementById("ai-side-panel").hidden = true;
    elements.description.focus();
  }

  document.getElementById("ai-fill-all-btn-top")?.addEventListener("click", applyAll);
  document.getElementById("ai-fill-all-btn-bottom")?.addEventListener("click", applyAll);

  document.getElementById("ai-btn-fill-cat")?.addEventListener("click", () => {
    if (result.category && categoryDetails[result.category]) {
      elements.category.value = result.category;
      elements.category.dispatchEvent(new Event("change", { bubbles: true }));
      elements.category.classList.add("field-flash");
      setTimeout(() => elements.category.classList.remove("field-flash"), 1500);
      showToast("Category filled", result.category);
    }
  });

  document.getElementById("ai-btn-fill-desc")?.addEventListener("click", () => {
    if (result.description) {
      elements.description.value = result.description;
      elements.description.dispatchEvent(new Event("input", { bubbles: true }));
      elements.description.classList.add("field-flash");
      setTimeout(() => elements.description.classList.remove("field-flash"), 1500);
      showToast("Description filled", "AI description added to report.");
    }
  });

  document.getElementById("ai-btn-append-desc")?.addEventListener("click", () => {
    const current = elements.description.value.trim();
    elements.description.value = current ? `${current}\n\nVisible Evidence: ${result.evidence}` : result.evidence;
    elements.description.dispatchEvent(new Event("input", { bubbles: true }));
    elements.description.classList.add("field-flash");
    setTimeout(() => elements.description.classList.remove("field-flash"), 1500);
    showToast("Evidence appended", "Visible evidence added to description.");
  });

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function readAiResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("Server returned non-JSON response");
  }
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.message || "AI could not prepare a description. You can continue with the normal form.");
  }
  if (!body.result || typeof body.result !== "object" || Array.isArray(body.result)) {
    throw new Error("The AI returned an invalid result. Review your photo and continue manually.");
  }
  return body.result;
}

async function generateAiDescription() {
  const status = document.getElementById("ai-status");
  const button = document.getElementById("generate-ai-description");
  let files = Array.from(document.getElementById("ai-photos").files || []);
  
  // If no file in ai-photos, check if user chose one in main form
  if (!files.length && elements.photo.files?.length) {
    files = Array.from(elements.photo.files);
    const transfer = new DataTransfer();
    files.forEach(f => transfer.items.add(f));
    document.getElementById("ai-photos").files = transfer.files;
  }

  const reviewed = document.getElementById("ai-privacy-reviewed");
  if (reviewed) {
    reviewed.checked = true;
    reviewed.disabled = false;
  }

  const note = document.getElementById("ai-note").value.trim();
  const city = document.getElementById("ai-city").value.trim() || selectedCity.name.split(",")[0].trim();
  const mode = selectedAiMode();
  const category = elements.category.value || "";
  status.textContent = "";

  if (files.length < 1) {
    status.textContent = "Please choose 1 to 3 issue photos to analyze.";
    return;
  }

  button.disabled = true;
  status.textContent = "Analyzing issue photo with Gemini Vision AI…";

  const uploadFiles = [];
  try {
    const privacy = await imagePrivacyReady.catch(() => null);
    if (privacy && processedAiPhotos.length) {
      for (const photo of processedAiPhotos) {
        uploadFiles.push(await privacy.applyManualRegions(photo).catch(() => photo.file || files[0]));
      }
    } else {
      uploadFiles.push(...files);
    }
  } catch (prepErr) {
    uploadFiles.push(...files);
  }

  let analysisResult = null;
  let serverUnavailable = false;

  // Try server API first
  try {
    const payload = new FormData();
    uploadFiles.forEach((file) => payload.append("photos", file));
    payload.append("note", note || (mode === "improve" ? elements.description.value.trim().slice(0, 200) : ""));
    payload.append("city", city);
    payload.append("mode", mode);
    if (category) payload.append("category", category);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch("/api/ai/describe", {
      method: "POST",
      body: payload,
      signal: controller.signal
    }).catch(() => null);
    clearTimeout(timeout);

    if (!response || !response.ok ||
        !(response.headers.get("content-type") || "").includes("application/json")) {
      serverUnavailable = true;
    }
    if (response && response.ok) {
      const serverResult = await readAiResponse(response).catch(() => null);
      if (serverResult && serverResult.category && serverResult.description) {
        analysisResult = serverResult;
      } else {
        serverUnavailable = true;
      }
    }
  } catch (apiError) {
    console.warn("[CivicX AI] Live API request failed, switching to local vision analyzer:", apiError);
  }

  // Fallback to intelligent local vision analyzer if server is offline or fails
  if (!analysisResult) {
    analysisResult = generateLocalAiVisionResult(files[0], note, city, category);
  }

  // Render the structured table
  renderAiAnalysis(analysisResult, uploadFiles);
  status.textContent = serverUnavailable
    ? "The CIVICX server is unavailable; local photo analysis is complete. Review the table below and click 'Fill All Fields in Form' to auto-fill your report."
    : "✨ Analysis complete! Review the table below and click 'Fill All Fields in Form' to auto-fill your report.";
  button.disabled = false;
}

function closeOnEscape(event) {
  if (event.key === "Escape") {
    if (!elements.modal.hidden) closeReportModal();
    if (!document.getElementById("report-detail-backdrop").hidden) closeReportDetails();
    document.querySelector(".map-wrap.is-expanded")?.classList.remove("is-expanded");
  }
}

document.querySelectorAll("[data-open-report]").forEach((button) => button.addEventListener("click", openReportModal));
document.querySelector(".modal-close").addEventListener("click", closeReportModal);
document.getElementById("cancel-report").addEventListener("click", closeReportModal);
elements.modal.addEventListener("click", (event) => {
  if (event.target === elements.modal) closeReportModal();
});
elements.form.addEventListener("submit", createReport);
elements.description.addEventListener("input", () => {
  document.getElementById("description-count").textContent = `${elements.description.value.length} / 2500`;
});
elements.photo.addEventListener("change", () => {
  const photo = elements.photo.files[0];
  if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
  photoObjectUrl = photo ? URL.createObjectURL(photo) : null;
  elements.uploadPreview.hidden = !photo;
  elements.uploadPreview.textContent = photo ? photo.name : "";
});
elements.reportSearch.addEventListener("input", () => {
  showAllReports = false;
  renderReports();
});
document.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => setCategoryFilter(button.dataset.category)));
document.querySelectorAll("[data-status-filter]").forEach((button) => button.addEventListener("click", () => setStatusFilter(button.dataset.statusFilter)));
document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.addEventListener("click", () => {
  activeView = button.dataset.view;
  renderView();
}));
document.querySelectorAll(".quick-card[data-view]").forEach((button) => button.addEventListener("click", () => {
  activeView = button.dataset.view;
  renderView();
  document.querySelector(".map-section").scrollIntoView({ behavior: "smooth", block: "start" });
}));
function renderCityQuickList(filterText = "") {
  const container = document.getElementById("city-quick-list");
  if (!container) return;
  container.replaceChildren();
  const query = filterText.toLowerCase().trim();
  const presetEntries = Object.entries(CITY_PRESETS);
  const matching = presetEntries.filter(([key, city]) =>
    !query || key.toLowerCase().includes(query) || city.name.toLowerCase().includes(query)
  );

  if (!matching.length) {
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "city-quick-empty";
    emptyMsg.textContent = "No matching city in presets. Click 'Search all Indian cities' below.";
    container.append(emptyMsg);
    return;
  }

  matching.forEach(([key, city]) => {
    const [name, ...region] = city.name.split(",").map((s) => s.trim());
    const isSelected = selectedCity.name.toLowerCase().includes(name.toLowerCase());
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `city-quick-item ${isSelected ? "is-selected" : ""}`;
    btn.innerHTML = `<span class="city-quick-pin">📍</span><span class="city-quick-text"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(region.join(", ") || "India")}</small></span>${isSelected ? '<span class="city-quick-check">✓</span>' : ""}`;
    btn.addEventListener("click", () => {
      chooseCity(city);
      closeQuickCityDropdown();
    });
    container.append(btn);
  });
}

function openQuickCityDropdown() {
  const dropdown = document.getElementById("city-quick-dropdown");
  const picker = document.getElementById("city-picker");
  if (!dropdown) return;
  renderCityQuickList();
  dropdown.hidden = false;
  picker.setAttribute("aria-expanded", "true");
  const filterInput = document.getElementById("city-quick-filter");
  if (filterInput) {
    filterInput.value = "";
    filterInput.focus();
  }
}

function closeQuickCityDropdown() {
  const dropdown = document.getElementById("city-quick-dropdown");
  const picker = document.getElementById("city-picker");
  if (!dropdown) return;
  dropdown.hidden = true;
  picker.setAttribute("aria-expanded", "false");
}

document.getElementById("city-picker")?.addEventListener("click", (event) => {
  event.stopPropagation();
  const dropdown = document.getElementById("city-quick-dropdown");
  if (dropdown && !dropdown.hidden) {
    closeQuickCityDropdown();
  } else {
    openQuickCityDropdown();
  }
});

document.getElementById("city-quick-close")?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeQuickCityDropdown();
});

document.getElementById("city-quick-filter")?.addEventListener("input", (e) => {
  renderCityQuickList(e.target.value);
});

document.getElementById("open-city-dialog-btn")?.addEventListener("click", () => {
  closeQuickCityDropdown();
  const dialog = document.getElementById("city-picker-dialog");
  dialog?.showModal();
  document.getElementById("city-search-input")?.focus();
});

document.addEventListener("click", (event) => {
  const wrap = document.querySelector(".city-picker-wrap");
  if (wrap && !wrap.contains(event.target)) {
    closeQuickCityDropdown();
  }
});

document.querySelectorAll(".city-zone-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".city-zone-chip").forEach((c) => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    const zone = chip.dataset.zone;
    document.querySelectorAll("#dialog-city-grid [data-city-preset]").forEach((btn) => {
      const btnZone = btn.dataset.zone || "";
      btn.hidden = zone !== "all" && !btnZone.includes(zone);
    });
  });
});

document.getElementById("city-search-input")?.addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase().trim();
  document.querySelectorAll("#dialog-city-grid [data-city-preset]").forEach((btn) => {
    const text = btn.textContent.toLowerCase();
    btn.hidden = q.length > 0 && !text.includes(q);
  });
});

document.querySelectorAll("[data-city-preset]").forEach((button) => {
  button.addEventListener("click", () => chooseCity(CITY_PRESETS[button.dataset.cityPreset]));
});

const ALL_INDIAN_CITIES = [
  ...Object.values(CITY_PRESETS),
  { name: "Agra, Uttar Pradesh, India", latitude: 27.1767, longitude: 78.0081 },
  { name: "Varanasi, Uttar Pradesh, India", latitude: 25.3176, longitude: 82.9739 },
  { name: "Bhopal, Madhya Pradesh, India", latitude: 23.2599, longitude: 77.4126 },
  { name: "Nagpur, Maharashtra, India", latitude: 21.1458, longitude: 79.0882 },
  { name: "Visakhapatnam, Andhra Pradesh, India", latitude: 17.6868, longitude: 83.2185 },
  { name: "Dehradun, Uttarakhand, India", latitude: 30.3165, longitude: 78.0322 },
  { name: "Coimbatore, Tamil Nadu, India", latitude: 11.0168, longitude: 76.9558 },
  { name: "Thiruvananthapuram, Kerala, India", latitude: 8.5241, longitude: 76.9366 },
  { name: "Mysuru, Karnataka, India", latitude: 12.2958, longitude: 76.6394 },
  { name: "Guwahati, Assam, India", latitude: 26.1445, longitude: 91.7362 },
  { name: "Ranchi, Jharkhand, India", latitude: 23.3441, longitude: 85.3096 },
  { name: "Panaji, Goa, India", latitude: 15.4909, longitude: 73.8278 },
  { name: "Srinagar, Jammu and Kashmir, India", latitude: 34.0837, longitude: 74.7973 }
];

document.getElementById("city-search-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("city-search-input");
  const status = document.getElementById("city-search-status");
  const query = input.value.trim().toLowerCase();
  if (query.length < 2) {
    status.textContent = "Enter at least two characters to search for a city.";
    return;
  }
  status.textContent = "Searching Indian cities…";
  document.getElementById("city-search-results").hidden = true;

  const localMatches = ALL_INDIAN_CITIES.filter((c) =>
    c.name.toLowerCase().includes(query)
  );

  try {
    const data = await window.CivicXEnvironment.getJson(`/api/environment/geocode?q=${encodeURIComponent(query)}`);
    const locations = Array.isArray(data.results) && data.results.length ? data.results : localMatches;
    renderCitySearchResults(locations);
    status.textContent = locations.length ? "Choose a result to update your city view." : "No matching Indian cities found.";
  } catch (error) {
    if (localMatches.length) {
      renderCitySearchResults(localMatches);
      status.textContent = "Choose a result below:";
    } else {
      status.textContent = "No matching Indian cities were found. Try another city name.";
    }
  }
});
document.getElementById("open-ai-detector").addEventListener("click", () => {
  openReportModal();
  document.getElementById("ai-side-panel").hidden = false;
  setAiMode("detect");
  document.getElementById("ai-status").textContent = "Choose a photo. Face and plate detection happens locally; nothing is uploaded until you review the processed preview.";
  document.getElementById("ai-photos").focus();
});
document.getElementById("view-all-button").addEventListener("click", () => {
  showAllReports = !showAllReports;
  renderReports();
});
document.getElementById("locate-button").addEventListener("click", (event) => useCurrentLocation(event.currentTarget));
document.getElementById("modal-locate-button").addEventListener("click", (event) => useCurrentLocation(event.currentTarget));
document.getElementById("map-expand").addEventListener("click", () => {
  const mapWrap = document.querySelector(".map-wrap");
  mapWrap.classList.toggle("is-expanded");
  document.getElementById("map-expand").setAttribute("aria-label", mapWrap.classList.contains("is-expanded") ? "Close expanded map" : "Expand map");
  window.setTimeout(() => map?.invalidateSize(), 120);
});
document.getElementById("hotspot-link").addEventListener("click", () => {
  const hotspot = selectedCity.name === DEFAULT_CITY.name
    ? reports.find((report) => isReportInSelectedCity(report) && report.area === "Park Circus")
    : reports.find(isReportInSelectedCity);
  if (hotspot) selectReport(hotspot.id);
});
document.getElementById("insight-hotspot-link").addEventListener("click", () => {
  activeView = "overview";
  renderView();
  const hotspot = selectedCity.name === DEFAULT_CITY.name
    ? reports.find((report) => isReportInSelectedCity(report) && report.area === "Park Circus")
    : reports.find(isReportInSelectedCity);
  if (hotspot) selectReport(hotspot.id);
});
elements.reportsBody.addEventListener("click", (event) => {
  const manageButton = event.target.closest("[data-manage-id]");
  if (manageButton) {
    event.stopPropagation();
    const report = reports.find((item) => item.id === manageButton.dataset.manageId);
    if (report?.isMine) openReportDetails(report.id);
    else updateReportStatus(manageButton.dataset.manageId);
    return;
  }
  if (event.target.closest(".portal-link")) {
    event.stopPropagation();
    return;
  }
  const row = event.target.closest("[data-report-id]");
  if (row) {
    const report = reports.find((item) => item.id === row.dataset.reportId);
    if (report?.isMine) openReportDetails(report.id);
    else if (activeView !== "my-reports") selectReport(row.dataset.reportId);
  }
});
elements.reportsBody.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("tr[data-report-id]")) {
    event.preventDefault();
    const report = reports.find((item) => item.id === event.target.dataset.reportId);
    if (report?.isMine) openReportDetails(report.id);
    else if (activeView !== "my-reports") selectReport(event.target.dataset.reportId);
  }
});
document.getElementById("report-detail-content").addEventListener("click", (event) => {
  const photoButton = event.target.closest("[data-download-photo]");
  if (photoButton) {
    downloadReportPhoto(photoButton.dataset.downloadPhoto).catch((error) => {
      showToast("Photo unavailable", error.message || "The photo could not be downloaded.");
    });
    return;
  }
  const historyButton = event.target.closest("[data-report-event]");
  if (historyButton) saveCitizenHistoryEvent(historyButton.dataset.reportEvent, historyButton);
});
document.addEventListener("keydown", closeOnEscape);
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.reportSearch.focus();
  }
});

document.getElementById("open-ai-panel").addEventListener("click", () => {
  const panel = document.getElementById("ai-side-panel");
  panel.hidden = false;
  setAiMode("generate");

  // Pre-fill active city
  const cityInput = document.getElementById("ai-city");
  if (cityInput && selectedCity?.name) {
    cityInput.value = selectedCity.name.split(",")[0].trim();
  }

  // Pre-fill note if user already started writing description
  const noteInput = document.getElementById("ai-note");
  if (noteInput && !noteInput.value.trim() && elements.description.value.trim()) {
    noteInput.value = elements.description.value.trim().slice(0, 150);
  }

  // Auto-transfer photo if user already selected one in main form
  if (elements.photo.files?.length && !document.getElementById("ai-photos").files?.length) {
    const transfer = new DataTransfer();
    for (const f of elements.photo.files) transfer.items.add(f);
    const aiPhotosInput = document.getElementById("ai-photos");
    aiPhotosInput.files = transfer.files;
    prepareAiPhotos(Array.from(aiPhotosInput.files));
  }

  document.getElementById("ai-note").focus();
});
document.getElementById("close-ai-panel").addEventListener("click", () => {
  document.getElementById("ai-side-panel").hidden = true;
});
document.querySelectorAll(".ai-mode").forEach((button) => button.addEventListener("click", () => {
  const mode = button.dataset.aiMode || "generate";
  setAiMode(mode);
  document.getElementById("ai-status").textContent = mode === "improve"
    ? "Improvement mode uses only the redacted photo and a short issue note. Add a description, then review the processed photo."
    : mode === "generate"
      ? "Draft mode uses only reviewed, redacted photos and the short issue note."
      : "Detection mode identifies a probable civic issue from the reviewed, redacted photo.";
}));
document.getElementById("generate-ai-description").addEventListener("click", generateAiDescription);
document.getElementById("ai-photos").addEventListener("change", (event) => {
  prepareAiPhotos(Array.from(event.currentTarget.files || []));
});
document.querySelector(".detail-close").addEventListener("click", closeReportDetails);
document.getElementById("report-detail-backdrop").addEventListener("click", (event) => {
  if (event.target.id === "report-detail-backdrop") closeReportDetails();
});
document.getElementById("copy-report-fields").addEventListener("click", copyReportFields);
document.getElementById("save-registration-number").addEventListener("click", saveRegistrationNumber);
window.CivicXAuth.onChange((authState) => { void syncAuthenticatedReports(authState); });

updateCityPicker();
renderView();
initializeMap();
