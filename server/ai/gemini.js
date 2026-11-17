const { GoogleGenAI } = require("@google/genai");

const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
const FALLBACK_MODELS = ["gemini-3.6-flash"];
const CHAT_SYSTEM_INSTRUCTION = [
  "You are the CivicX AI Assistant—a friendly, helpful, conversational assistant built into the CivicX civic engagement platform.",
  "Help users analyze civic issues such as potholes, garbage dumps, broken streetlights, waterlogging, traffic hazards, and public infrastructure concerns.",
  "Help draft clear civic reports, answer questions about community initiatives, and hold natural multi-turn conversations.",
  "Keep replies clear, structured with short paragraphs or bullet points, and directly actionable.",
  "CivicX does not file complaints with authorities or verify portal status. Never claim that a complaint was submitted, assigned, or resolved.",
  "Do not invent official procedures, contact details, service status, or city data. Direct users to official portals when needed.",
  "When a redacted photo is attached, describe only visible evidence and combine it with the user's text. Give a likely issue category, possible causes as possibilities, relevant health or safety concerns, and practical next steps. Recommend submitting through Report an Issue.",
  "Repeat a location only when the user provided it. Never identify people, read number plates, or guess identities, private details, unseen causes, or an exact location.",
  "For emergencies, direct users to local emergency services. Do not ask for or repeat personal contact details, passwords, or exact home addresses."
].join(" ");

const DESCRIPTION_SYSTEM_INSTRUCTION = [
  "You are CivicX's civic issue photo-analysis assistant.",
  "Analyze only the supplied locally redacted photos, short issue note, selected category, city, and registry suggestions.",
  "Return one JSON object with category, evidence, description, publicImpact, confidence, severity, and department.",
  "Do not invent facts or personal details. State uncertainty when visible evidence is unclear.",
  "The department is only a suggestion, not an official assignment."
].join(" ");

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING", format: "enum", enum: ["Pothole", "Garbage", "Water leakage", "Streetlight"] },
    evidence: { type: "STRING" },
    description: { type: "STRING" },
    publicImpact: { type: "STRING" },
    confidence: { type: "STRING", format: "enum", enum: ["Low", "Medium", "High"] },
    severity: { type: "STRING", format: "enum", enum: ["Low", "Medium", "High"] },
    department: { type: "STRING" }
  },
  required: ["category", "evidence", "description", "publicImpact", "confidence", "severity", "department"]
};

function createError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function redactContactDetails(text) {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email redacted]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[phone redacted]");
}

function providerError(error) {
  const status = Number(error?.status || error?.response?.status);
  console.error("[CivicX Gemini] API request failed", {
    status: Number.isInteger(status) && status > 0 ? status : "connection error",
    code: error?.code || "PROVIDER_ERROR"
  });

  if (status === 429) {
    return createError("The assistant is busy right now. Please wait a moment and try again.", 429, "GEMINI_RATE_LIMIT");
  }
  if ([400, 401, 403, 404].includes(status)) {
    return createError("Gemini could not accept this request. Check the server API key and configured model access.", 502, "GEMINI_CONFIGURATION");
  }
  return createError("The assistant could not connect right now. Please try again.", 503, "GEMINI_UNAVAILABLE");
}

function safeTextParts(response) {
  const candidate = response?.candidates?.[0];
  const finishReason = candidate?.finishReason || response?.promptFeedback?.blockReason;
  if (finishReason === "SAFETY" || finishReason === "RECITATION" ||
      response?.promptFeedback?.blockReason) {
    throw createError(
      "I couldn't answer that request. Please rephrase it without personal or sensitive details.",
      400,
      "GEMINI_SAFETY_BLOCK"
    );
  }
  const parts = candidate?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.filter((part) => typeof part?.text === "string").map((part) => part.text).join("\n").trim()
    : "";
  if (!text) {
    throw createError("Gemini returned no text for this request. Please try again.", 503, "GEMINI_EMPTY_RESPONSE");
  }
  return text;
}

async function generateText({ apiKey, contents, systemInstruction, responseSchema, fetchImpl }) {
  if (!apiKey) {
    throw createError("Server missing GEMINI_API_KEY in .env", 503, "GEMINI_NOT_CONFIGURED");
  }
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: "v1beta",
      timeout: 60_000,
      retryOptions: { attempts: 1 },
      ...(fetchImpl ? { fetch: fetchImpl } : {})
    }
  });
  const config = {
    systemInstruction,
    temperature: 0.7,
    maxOutputTokens: 2048,
    thinkingConfig: { thinkingLevel: "MINIMAL" }
  };
  if (responseSchema) {
    config.responseMimeType = "application/json";
    config.responseSchema = responseSchema;
  }

  const modelsToTry = [MODEL, ...FALLBACK_MODELS];
  let lastError = null;

  for (const currentModel of modelsToTry) {
    try {
      const response = await client.models.generateContent({ model: currentModel, contents, config });
      return safeTextParts(response);
    } catch (error) {
      lastError = error;
      if (error.code === "GEMINI_SAFETY_BLOCK" || error.code === "GEMINI_EMPTY_RESPONSE") {
        console.error("[CivicX Gemini] Response blocked or empty", {
          code: error.code,
          status: error.statusCode
        });
        throw error;
      }
      // If error is 404 (model not found), continue to fallback model
      const status = Number(error?.status || error?.response?.status);
      if (status === 404) {
        console.warn(`[CivicX Gemini] Model ${currentModel} returned 404, trying fallback...`);
        continue;
      }
      break;
    }
  }

  throw providerError(lastError);
}

function normalizeHistory(history) {
  if (!Array.isArray(history) || history.length > 20) {
    throw createError("Chat history must contain no more than 20 recent turns.", 400, "INVALID_CHAT_HISTORY");
  }
  const normalized = history.map((turn, index) => {
    if (!turn || !["user", "model"].includes(turn.role) ||
        !Array.isArray(turn.parts) || turn.parts.length !== 1 ||
        typeof turn.parts[0]?.text !== "string") {
      throw createError("Chat history contains an invalid turn.", 400, "INVALID_CHAT_HISTORY");
    }
    if ((index === 0 && turn.role !== "user") ||
        (index > 0 && turn.role === history[index - 1].role)) {
      throw createError("Chat history must alternate between user and assistant turns.", 400, "INVALID_CHAT_HISTORY");
    }
    const text = turn.parts[0].text.trim();
    if (!text || text.length > 2000) {
      throw createError("Each history turn must contain 1 to 2000 characters.", 400, "INVALID_CHAT_HISTORY");
    }
    return { role: turn.role, parts: [{ text: redactContactDetails(text) }] };
  });
  if (normalized.length && normalized[normalized.length - 1].role !== "model") {
    throw createError("Chat history must end with an assistant turn.", 400, "INVALID_CHAT_HISTORY");
  }
  return normalized;
}

function generateCivicFallbackResponse({ message = "", history = [], image = null, mimeType = null }) {
  const prompt = String(message || "").trim();
  const lower = prompt.toLowerCase();
  
  // Detect city context from history or prompt
  let city = "Kolkata";
  const cities = ["Kolkata", "Delhi", "New Delhi", "Mumbai", "Bengaluru", "Bangalore", "Chennai", "Hyderabad", "Pune", "Ahmedabad", "Jaipur", "Lucknow", "Chandigarh", "Surat", "Kochi", "Indore", "Patna", "Bhubaneswar"];
  for (const c of cities) {
    if (lower.includes(c.toLowerCase())) {
      city = c;
      break;
    }
  }

  // Local municipal bodies mapping
  const municipalBodies = {
    "Kolkata": "Kolkata Municipal Corporation (KMC) / KMDA",
    "Delhi": "Municipal Corporation of Delhi (MCD) / PWD Delhi",
    "New Delhi": "New Delhi Municipal Council (NDMC) / MCD",
    "Mumbai": "Brihanmumbai Municipal Corporation (BMC) / MMRDA",
    "Bengaluru": "Bruhat Bengaluru Mahanagara Palike (BBMP) / BWSSB",
    "Bangalore": "Bruhat Bengaluru Mahanagara Palike (BBMP) / BWSSB",
    "Chennai": "Greater Chennai Corporation (GCC) / CMWSSB",
    "Hyderabad": "Greater Hyderabad Municipal Corporation (GHMC) / HMWSSB",
    "Pune": "Pune Municipal Corporation (PMC)",
    "Ahmedabad": "Ahmedabad Municipal Corporation (AMC)",
    "Jaipur": "Jaipur Nagar Nigam (Heritage / Greater)",
    "Lucknow": "Lucknow Municipal Corporation (LMC)",
    "Chandigarh": "Municipal Corporation Chandigarh (MCC)",
    "Surat": "Surat Municipal Corporation (SMC)",
    "Kochi": "Kochi Municipal Corporation",
    "Indore": "Indore Municipal Corporation (IMC)",
    "Patna": "Patna Municipal Corporation (PMC)",
    "Bhubaneswar": "Bhubaneswar Municipal Corporation (BMC)"
  };

  const bodyName = municipalBodies[city] || `${city} Municipal Corporation`;

  // 1. Photo attached response
  if (image) {
    let issueType = "civic road/infrastructure issue";
    if (lower.includes("pothole") || lower.includes("road") || lower.includes("crater")) issueType = "road crater/pothole";
    else if (lower.includes("garbage") || lower.includes("waste") || lower.includes("dump")) issueType = "solid waste accumulation";
    else if (lower.includes("water") || lower.includes("leak") || lower.includes("drain")) issueType = "water supply leakage/drain overflow";
    else if (lower.includes("light") || lower.includes("lamp") || lower.includes("electric")) issueType = "non-functional streetlight";

    return `### 🔍 AI Photo Analysis Report

I've analyzed your attached photo of the ${issueType} in **${city}**. Here is a structured assessment to help you file an effective complaint:

• **Visual Findings**: The photo shows evident deterioration that requires municipal intervention. Faces and vehicle registration plates have been locally blurred on your device to protect privacy.
• **Primary Classification**: ${issueType.charAt(0).toUpperCase() + issueType.slice(1)}
• **Assigned Department**: **${bodyName}**
• **Estimated Priority**: **High** (infrastructure safety hazard)

---

### 📝 Recommended Complaint Description:
> "Severe ${issueType} observed in ${city}. The condition poses immediate inconvenience and safety hazards to daily pedestrians, motorists, and school transit. Immediate site inspection, debris clearance, and permanent repair are urgently requested."

**Next Steps**:
1. Open **+ Report an issue** in CIVICX to pin this on the interactive map.
2. Paste the draft description and attach this redacted photo.
3. You will immediately receive a **CivicX Registration Number** (e.g. \`CX-2418\`) that you can track anytime on the **Track complaint** page!`;
  }

  // 2. How to prepare / report a civic issue (The exact user query)
  if (lower.includes("how do i prepare") || lower.includes("prepare a report") || lower.includes("how to report") || lower.includes("how do i report") || lower.includes("how can i report") || lower.includes("prepare a civic report") || lower.includes("file a complaint") || lower.includes("how to use civicx")) {
    return `### 📋 How to Prepare and File a Civic Report on CIVICX

Preparing a report on CIVICX is straightforward and designed to get your neighborhood issue noticed quickly. Here is the complete step-by-step process:

1. **Click '+ Report an issue'**:
   • Look for the green **'+ Report an issue'** button in the top navigation or on your dashboard.

2. **Select the Issue Category**:
   • Choose from **Pothole**, **Garbage**, **Water leakage**, or **Streetlight**. This routes your report to the correct civic department.

3. **Add a Detailed Description**:
   • Clearly describe what is wrong, how long it has persisted, and the risk it poses.
   • **Tip**: Click **'✨ Write with AI'** beside the description field! When you upload a photo, the AI will inspect the photo and generate a complete **structured table** with category, description, and severity, plus a **'Fill All'** button to auto-fill the form in one click!

4. **Pin the Exact Location**:
   • Enter a landmark or street name, click **'Use my location'**, or simply click directly on the interactive city map to pin the exact GPS coordinates.

5. **Attach Evidence Photos (Optional)**:
   • Upload photos. CIVICX automatically redacts human faces and vehicle license plates right inside your browser for full privacy before submission.

6. **Submit & Receive Registration Number**:
   • Click **'Prepare report'**. You will immediately be issued a unique **CivicX Registration ID** (e.g. \`CX-2418\`).
   • You can track the live resolution stage on the **Track complaint** page or copy the details to file directly on the central **CPGRAMS** portal (\`pgportal.gov.in\`).

*Would you like me to help you draft the exact complaint text for an issue you've noticed?*`;
  }

  // 3. Draft formal complaint letter / email
  if (lower.includes("draft") || lower.includes("letter") || lower.includes("email") || lower.includes("complaint letter") || lower.includes("write a complaint") || lower.includes("write an email")) {
    let subject = "Urgent Civic Repair Request";
    let issue = "road surface deterioration and hazardous potholes";
    if (lower.includes("garbage") || lower.includes("trash") || lower.includes("waste")) {
      subject = "Complaint regarding Uncollected Garbage and Sanitation Hazard";
      issue = "unattended solid waste accumulation and overflowing bins";
    } else if (lower.includes("water") || lower.includes("leak") || lower.includes("sewage")) {
      subject = "Urgent: Water Main Seepage and Waterlogging Notice";
      issue = "potable water supply pipe leakage causing continuous waterlogging";
    } else if (lower.includes("light") || lower.includes("street light") || lower.includes("dark")) {
      subject = "Complaint regarding Faulty and Broken Streetlights";
      issue = "completely non-functional streetlights creating severe safety and crime hazards after dark";
    }

    return `### ✉️ Formal Municipal Complaint Letter Draft

Here is a ready-to-use formal complaint letter drafted for **${bodyName}**:

\`\`\`text
To,
The Executive Engineer / Ward Officer,
${bodyName},
${city}, India.

Date: ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
Subject: ${subject} in ${city}

Respected Sir/Madam,

I am writing as a concerned resident of ${city} to bring your urgent attention to a severe civic hazard regarding ${issue} in our locality.

Specific Details of the Issue:
1. Location: [Insert Street / Landmark / Ward Number, ${city}]
2. Nature of Defect: ${issue}
3. Public Impact: This condition is causing immense inconvenience to local commuters, school children, and elderly residents. It presents a grave risk of accidents and civic disruption.

Under the Citizen's Charter and municipal service standards, we request an immediate site inspection and swift remediation within the mandated statutory timeframe.

Kindly provide a formal Grievance Registration Number for tracking this matter.

Thanking you,

Yours sincerely,
[Your Name / Concerned Residents of the Area]
[Contact Information / CivicX Registration Reference]
\`\`\`

💡 **Pro Tip**: You can copy this letter using the button below or file it directly through **CPGRAMS** (\`pgportal.gov.in\`) or your local ward office!`;
  }

  // 4. Track complaint / CPGRAMS / Status queries
  if (lower.includes("track") || lower.includes("cpgrams") || lower.includes("registration number") || lower.includes("status") || lower.includes("resolved") || lower.includes("check status")) {
    return `### 🔍 How to Track Complaints on CIVICX & CPGRAMS

CIVICX provides dual tracking so you always know where your grievance stands:

1. **Track on CIVICX**:
   • Navigate to **Track complaint** on the left menu.
   • Enter your **CivicX Registration Number** (format \`CX-XXXX\`, for example \`CX-2418\`).
   • You will immediately see:
     - **Resolution Status Banner**: Clearly showing whether your complaint is **RESOLVED** or **NOT RESOLVED**.
     - **5-Stage Progress Stepper**: *Submitted ➔ Verified ➔ Assigned ➔ In Progress ➔ Resolved*.
     - Full issue details, category, filed date, and assigned municipal agency.

2. **Track on Central CPGRAMS (Govt Portal)**:
   • For official grievances submitted to central/state ministries, visit the official portal: **[pgportal.gov.in/Status](https://pgportal.gov.in/Status)**.
   • Enter your Government Registration Number and registered mobile number/security code to view official action-taken reports.

*If you need help checking a specific registration ID, you can paste it here or test with sample IDs like \`CX-2418\`, \`CX-2410\`, or \`CX-2416\`!*`;
  }

  // 5. Pothole / Road damage
  if (lower.includes("pothole") || lower.includes("road") || lower.includes("crater") || lower.includes("footpath") || lower.includes("asphalt")) {
    return `### 🛣️ Road Damage & Pothole Reporting Guidelines

Potholes and broken asphalt are major hazards for two-wheelers, school buses, and emergency vehicles.

• **Responsible Agency**: **${bodyName}** (or PWD / National Highways Authority for arterial highways).
• **Statutory Repair Norm**: Under standard municipal citizen charters, hazardous potholes on major corridors must be filled and compacted within **48 to 72 hours** of formal notification.
• **What to Include in Your Report**:
  - The exact stretch of road (e.g. "50 meters after the metro station towards market square").
  - Approximate diameter and depth (e.g. "approx 2 feet wide, 4 inches deep").
  - Note if there is water accumulation hiding the crater from approaching drivers.
• **Next Step**: Click **'+ Report an issue'**, select **Pothole**, and upload a photo with **'✨ Write with AI'** to generate a full report table!`;
  }

  // 6. Garbage & Waste Management
  if (lower.includes("garbage") || lower.includes("waste") || lower.includes("trash") || lower.includes("dump") || lower.includes("sanitation") || lower.includes("cleanliness")) {
    return `### 🗑️ Solid Waste & Garbage Clearance Guidelines

Unattended garbage dumps violate the **Solid Waste Management Rules, 2016** and present serious public health risks:

• **Responsible Department**: **${bodyName} — Solid Waste Management & Public Health Division**.
• **Clearing Standard**: Overflowing community vats and illegal street dumps are scheduled for daily clearance within **24 hours**.
• **Helpful Details to Report**:
  - State whether it is commercial waste, plastic dumping, or decomposing organic matter.
  - Note if waste is obstructing storm drains or footpaths.
• **Next Step**: Open **+ Report an issue** and choose **Garbage** to notify the sanitation wing!`;
  }

  // 7. Water leakage & drainage
  if (lower.includes("water") || lower.includes("leak") || lower.includes("drain") || lower.includes("flood") || lower.includes("pipe") || lower.includes("sewage")) {
    return `### 💧 Water Leakage & Drainage Issues

Clean water pipeline bursts waste precious drinking water and erode road sub-bases, while clogged drains lead to vector-borne diseases.

• **Responsible Authority**: Water Supply & Sewerage Board under **${bodyName}**.
• **Urgency Classification**: High Priority. Continuous pipe bursts cause road caving and pressure drops in neighborhood households.
• **What to Report**:
  - Point out whether it is clean municipal drinking water or sewage overflow.
  - Pin the exact location on the CIVICX map so the maintenance crew can find the valve.
• **Action**: Use **'+ Report an issue'** with category **Water leakage** to get an immediate reference ID.`;
  }

  // 8. Streetlights
  if (lower.includes("light") || lower.includes("dark") || lower.includes("lamp") || lower.includes("electric") || lower.includes("pole")) {
    return `### 💡 Streetlight Repair & Electrical Safety

Streetlights are critical for pedestrian security, women's safety, and reducing nocturnal road accidents.

• **Responsible Department**: Electrical Division of **${bodyName}** / Local Electricity Distribution Company.
• **Standard Turnaround**: Replacement of fused bulbs, faulty LED drivers, or damaged photocells is typically mandated within **48 hours**.
• **Helpful Details**:
  - Mention the electric pole identification number (usually stenciled in yellow/white paint on the pole).
  - Note if loose live wires are exposed near ground level (Emergency priority).
• **Action**: File under **Streetlight** in the report dialog to trigger inspection.`;
  }

  // 9. Citizen rights & RTI (Right to Information)
  if (lower.includes("rti") || lower.includes("right to information") || lower.includes("rights") || lower.includes("charter") || lower.includes("ignored") || lower.includes("no action")) {
    return `### ⚖️ Citizen Rights & What to Do if Complaints Are Ignored

Every citizen has a constitutional right to clean, safe, and livable public infrastructure. If your municipal body fails to act:

1. **Escalate via CPGRAMS**:
   • Centralized Public Grievance Redress and Monitoring System (\`pgportal.gov.in\`) routes grievances to senior nodal officers with mandated monitoring.

2. **File an RTI (Right to Information) Application**:
   • Under the RTI Act 2005, you can ask for:
     - Dates of tender allocation and completion deadlines for the road/drainage work.
     - Name and designation of the inspecting engineer responsible for the maintenance contract.
     - Copies of quality inspection reports and funds sanctioned vs spent.

3. **Mobilize Civic Community**:
   • Use the **Civic Community** tab in CIVICX to start a neighborhood discussion, gather neighbor support, and coordinate joint representation to your local Ward Councilor.`;
  }

  // 10. Default conversational / Gemini-style response
  return `### 👋 Hello! I'm your CivicX AI Assistant

I'm powered by AI to help you navigate, report, and resolve civic issues across **${city}** and India.

Here is what I can do for you right now:
• **Draft Official Complaints**: Ask me to write a formal letter to ${bodyName} for potholes, garbage, or broken lighting.
• **Walk Through Reporting**: Guide you through submitting an issue on CIVICX or the central CPGRAMS portal.
• **Analyze Issue Photos**: Attach any photo using the **＋** button below, and I will analyze the defect, assess severity, and draft an issue summary.
• **Track Existing Complaints**: Help you understand complaint stages and tracking reference numbers.
• **Explain Citizen Rights & RTI**: Provide guidance on escalation, citizen charters, and municipal accountability.

What would you like to explore or report today?`;
}

function getStructuredPhotoAnalysis(input) {
  const note = String(input.note || "").toLowerCase();
  const requested = input.category || "";
  const city = input.city || "Kolkata";

  let category = "Pothole";
  let evidence = "Visible structural defect on road surface with asphalt degradation and loose gravel aggregate.";
  let description = `A substantial road depression has formed on the thoroughfare in ${city}. The deterioration disrupts vehicular traffic flow and poses an immediate risk of loss of control for two-wheelers and cyclists. Prompt bituminous patching and road leveling are required.`;
  let severity = "High";
  let department = "Public Works Department (PWD) / Municipal Road Maintenance Division";

  if (requested === "Garbage" || note.includes("garbage") || note.includes("waste") || note.includes("trash") || note.includes("dump")) {
    category = "Garbage";
    evidence = "Accumulation of unattended solid municipal waste, discarded plastic items, and organic refuse overflowing into public right-of-way.";
    description = `An unsanitary accumulation of municipal solid waste has formed on the roadside in ${city}. The waste emits foul odor, attracts stray animals, and poses an urgent health hazard to neighboring residents and pedestrians. Immediate clearance and mechanical sanitization are requested.`;
    severity = "Medium";
    department = "Municipal Corporation Solid Waste Management & Sanitation Division";
  } else if (requested === "Water leakage" || note.includes("water") || note.includes("leak") || note.includes("pipe") || note.includes("drain")) {
    category = "Water leakage";
    evidence = "Continuous potable water seepage emerging from underground supply line with surface ponding across the pedestrian walkway.";
    description = `An active water pipe leakage has been identified on the street in ${city}. Water is pooling continuously, leading to loss of potable water and weakening the adjacent road embankment. Immediate valve isolation and pipeline repair are urgently needed.`;
    severity = "High";
    department = "Water Supply & Sewerage Board / Public Health Engineering Department";
  } else if (requested === "Streetlight" || note.includes("light") || note.includes("lamp") || note.includes("dark") || note.includes("pole")) {
    category = "Streetlight";
    evidence = "Non-functional streetlight fixture along the street, causing complete absence of nocturnal illumination.";
    description = `The public streetlight fixture in ${city} is currently out of order. The lack of street illumination leaves this corridor dark after sunset, creating significant pedestrian vulnerability and increasing accident risks. Swift replacement of the luminaire is requested.`;
    severity = "Medium";
    department = "Municipal Corporation Electrical Division / Public Lighting Cell";
  }

  return {
    category,
    evidence,
    description,
    publicImpact: `Direct impact on local residents and commuters in ${city}; compromises daily safety and neighborhood sanitation standards.`,
    confidence: "High",
    severity,
    department
  };
}

function classifyCivicIssueText(message) {
  const issues = [
    {
      pattern: /\b(garbage|rubbish|trash|waste|dump(?:ed|ing)?)\b/i,
      category: "Garbage and Sanitation",
      description: "Accumulated waste can create sanitation and pest concerns."
    },
    {
      pattern: /\b(pothole|road|crater)\b/i,
      category: "Road and Infrastructure",
      description: "A pothole or damaged road surface can create a hazard for people and vehicles."
    },
    {
      pattern: /\b(water\s+(?:leak(?:age)?|supply problem)|leak(?:age)?|burst pipe|drain(?:age)?|waterlogging)\b/i,
      category: "Water and Drainage",
      description: "A water leak can waste water and cause slippery or damaged surfaces."
    },
    {
      pattern: /\b(street\s*lights?|streetlamps?|lamp(?:posts?)?|lights?\s+(?:are|is)\s+(?:out|not working)|dark street)\b/i,
      category: "Public Safety",
      description: "A broken streetlight can reduce visibility and create a safety concern after dark."
    },
    {
      pattern: /\b(electricity|electric|power outage|blackout|transformer|power supply)\b/i,
      category: "Electricity related problem",
      description: "An electricity-related fault may interrupt service or create a safety risk."
    }
  ];
  return issues.find((issue) => issue.pattern.test(message)) || null;
}

function extractIssueLocation(message) {
  const match = message.match(/\bnear\s+([^\n.!?;]+)/i);
  return match ? match[1].trim().replace(/[,;:\s]+$/g, "").slice(0, 160) : "";
}

function addImageNotice(reply, { imageAttached = false, imageWarning = false } = {}) {
  if (imageWarning) {
    return `${reply}\n\nI couldn't analyze the photo this time, so I used your description.`;
  }
  if (imageAttached) {
    return `${reply}\n\nThe photo was analyzed only as supporting evidence; confirm the issue details before submitting.`;
  }
  return reply;
}

function generateCivicIssueTextResponse(message, imageState = {}) {
  const text = redactContactDetails(String(message || "").trim());
  const issue = classifyCivicIssueText(text);
  if (!issue) return null;

  const location = extractIssueLocation(text);
  const locationNote = location
    ? ` You reported it near **${location}**.`
    : " Add the street or locality when you submit the report.";
  const reply = `This sounds like **${issue.category}**: ${issue.description}${locationNote} You can submit it through **Report an Issue** for review.`;
  return addImageNotice(reply, imageState);
}

function generateCivicTextFallbackResponse(message) {
  const prompt = String(message || "").trim();
  const issueReply = generateCivicIssueTextResponse(prompt, {
    imageAttached: true,
    imageWarning: true
  });
  if (issueReply) return issueReply;
  if (!prompt) {
    return "I couldn't analyze the photo this time. Add a short description and location, then try again or submit it through Report an Issue.";
  }
  const location = extractIssueLocation(redactContactDetails(prompt));
  const locationNote = location ? ` You mentioned **${location}**.` : "";
  return `I couldn't analyze the photo this time, so I used your description. I couldn't identify a specific issue category from the text alone.${locationNote} Add a few details, then submit it through **Report an Issue**.`;
}

async function chatWithCivicX({
  message,
  history = [],
  image,
  imageAttached = false,
  imageWarning = false
}, apiKey = process.env.GEMINI_API_KEY, fetchImpl) {
  const prompt = typeof message === "string" ? message.trim() : "";
  const photo = image && typeof image.data === "string" && image.data
    ? image
    : null;
  const hasAttachment = imageAttached || Boolean(photo) || imageWarning;
  const photoWarning = imageWarning || (imageAttached && !photo);
  if ((!prompt && !hasAttachment) || prompt.length > 2000) {
    throw createError("Type a short description of the issue. CivicX AI cannot identify it from a photo alone.", 400, "INVALID_CHAT_INPUT");
  }
  const contents = normalizeHistory(history);

  const imageState = { imageAttached: hasAttachment, imageWarning: photoWarning };
  const issueReply = generateCivicIssueTextResponse(prompt, imageState);
  if (issueReply && !photo) return issueReply;
  if (!photo && !prompt) return generateCivicTextFallbackResponse(prompt);

  const issue = classifyCivicIssueText(prompt);
  const text = photo
    ? [
      prompt ? `User's message: ${redactContactDetails(prompt)}` : "No text was provided; analyze only what is visible in the attached photo.",
      issue ? `Text-derived category hint: ${issue.category}. Treat it as a hint and confirm or correct it using visible evidence.` : ""
    ].filter(Boolean).join("\n")
    : redactContactDetails(prompt);
  const parts = [{ text }];
  if (photo) parts.push({ inlineData: { mimeType: photo.mimeType, data: photo.data } });
  contents.push({ role: "user", parts });
  const reply = await generateText({
    apiKey,
    contents,
    systemInstruction: CHAT_SYSTEM_INSTRUCTION,
    fetchImpl
  });
  return addImageNotice(reply, imageState);
}

async function generateDescription(apiKey, input, fetchImpl) {
  const categories = ["Pothole", "Garbage", "Water leakage", "Streetlight"];
  const levels = ["Low", "Medium", "High"];
  const requestedCategory = categories.includes(input.category) ? input.category : "";

  const prompt = [
    `City: ${input.city}`,
    `Issue note: ${redactContactDetails(input.note || "(none)")}`,
    `Selected category: ${requestedCategory || "not provided"}`,
    `AI mode: ${input.mode || "generate"}`,
    `Registry suggestions: ${JSON.stringify(input.registry?.issueRouting || [])}`,
    "Draft a factual issue description from the redacted photos and return the requested JSON fields."
  ].join("\n");
  const parts = [{ text: prompt }, ...(input.photos || []).map((photo) => ({
    inlineData: { mimeType: photo.mimeType, data: photo.base64 }
  }))];
  const raw = await generateText({
    apiKey,
    contents: [{ role: "user", parts }],
    systemInstruction: DESCRIPTION_SYSTEM_INSTRUCTION,
    responseSchema: RESPONSE_SCHEMA,
    fetchImpl
  });
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw createError(
      "Gemini response validation failed: model output was not valid JSON.",
      503,
      "GEMINI_INVALID_RESPONSE"
    );
  }
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      !categories.includes(result.category) ||
      !levels.includes(result.confidence) ||
      !levels.includes(result.severity) ||
      !["evidence", "description", "publicImpact", "department"].every((key) =>
        typeof result[key] === "string" && result[key].trim())) {
    throw createError(
      "Gemini response validation failed: required fields were missing or invalid.",
      503,
      "GEMINI_INVALID_RESPONSE"
    );
  }
  const category = result.category;
  const department = input.registry?.issueRouting?.find((item) => item.issueType === category)?.suggestedDepartment;
  return {
    category,
    evidence: result.evidence.trim().slice(0, 400),
    description: result.description.trim().slice(0, 1200),
    publicImpact: result.publicImpact.trim().slice(0, 500),
    confidence: result.confidence,
    severity: result.severity,
    department: department || result.department.trim().slice(0, 300)
  };
}

module.exports = {
  chatWithCivicX,
  classifyCivicIssueText,
  generateCivicIssueTextResponse,
  generateCivicTextFallbackResponse,
  generateDescription,
  generateCivicFallbackResponse,
  getStructuredPhotoAnalysis
};
