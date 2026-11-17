function assertOnlyPublicFields(body, files) {
  const allowedFields = new Set(["note", "city", "mode", "category"]);
  const extraFields = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (extraFields.length) {
    throw new Error("Only photos, a short note, city, issue category, and AI mode are accepted.");
  }
  if (!Array.isArray(files) || files.length < 1 || files.length > 3) {
    throw new Error("Upload between 1 and 3 issue photos.");
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const mode = typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "generate";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  if (!["generate", "improve", "detect"].includes(mode)) {
    throw new Error("The AI mode is invalid.");
  }
  if (category && !/^[A-Za-z /-]+$/.test(category)) {
    throw new Error("The issue category is invalid.");
  }
  if (note.length > 200 || city.length < 1 || city.length > 120) {
    throw new Error("Enter a short issue note and a city name.");
  }
  if (!/^[\p{L}\p{N}\s.'\u2019\u2013-]+$/u.test(city)) {
    throw new Error("Enter a registered city or jurisdiction name, not a street address or contact details.");
  }
  if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(note) ||      /(?:\+?\d[\d\s().-]{7,}\d)/.test(note) ||
      /\b(my name is|my phone|my email|my address|i live at|aadhaar|passport number)\b/i.test(note)) {
    throw new Error("The note appears to contain contact information. Remove it and try again.");
  }
  return { note, city, mode, category, photos: files };
}

function buildModelInput(input, registry) {
  return {
    note: input.note,
    city: input.city,
    mode: input.mode,
    category: input.category,
    photos: input.photos.map((photo) => ({
      mimeType: photo.mimetype,
      base64: photo.buffer.toString("base64")
    })),
    registry
  };
}

module.exports = { assertOnlyPublicFields, buildModelInput };
