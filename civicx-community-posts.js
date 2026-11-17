(function (root, factory) {
  const service = factory();
  if (typeof module === "object" && module.exports) module.exports = service;
  else root.CivicXCommunityPosts = service;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const IMAGE_BUCKET = "civicx-community";
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const categories = Object.freeze([
    "Road and Infrastructure",
    "Garbage and Sanitation",
    "Water and Drainage",
    "Pollution and Environment",
    "Public Safety",
    "Government Services",
    "General Civic Discussions",
    "Suggestions and Solutions"
  ]);
  const reportCategoryDefaults = Object.freeze({
    Pothole: "Road and Infrastructure",
    Garbage: "Garbage and Sanitation",
    "Water leakage": "Water and Drainage",
    Streetlight: "Public Safety",
    "Electricity related problem": "Government Services"
  });

  function defaultCategoryForReport(category) {
    return reportCategoryDefaults[category] || "General Civic Discussions";
  }

  function reportBody(title, description) {
    return `Title: ${String(title || "").trim()}\n\n${String(description || "").trim()}`;
  }

  function validatePost(post) {
    if (!post || !categories.includes(post.category)) {
      return "Choose a valid Community category.";
    }
    if (typeof post.body !== "string" || post.body.trim().length < 10 || post.body.trim().length > 3000) {
      return "The Community post must be between 10 and 3000 characters.";
    }
    if (typeof post.city !== "string" || post.city.trim().length < 2 || post.city.trim().length > 80) {
      return "The Community city must be between 2 and 80 characters.";
    }
    if (typeof post.locality !== "string" || post.locality.trim().length < 2 || post.locality.trim().length > 80) {
      return "Enter a broad Community locality between 2 and 80 characters.";
    }
    if (post.displayName !== undefined &&
        (typeof post.displayName !== "string" || post.displayName.trim().length < 2 || post.displayName.trim().length > 40)) {
      return "Enter a Community display name between 2 and 40 characters.";
    }
    if (post.file && (!["image/jpeg", "image/png", "image/webp"].includes(post.file.type) ||
        !Number.isFinite(post.file.size) || post.file.size < 1 || post.file.size > MAX_IMAGE_BYTES)) {
      return "Choose a JPG, PNG or WebP image smaller than 5 MB.";
    }
    if (post.linkedReportId !== undefined &&
        (typeof post.linkedReportId !== "string" || post.linkedReportId.length > 80)) {
      return "The linked report reference is too long.";
    }
    return "";
  }

  function imageExtension(file) {
    return file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  }

  async function uploadImage(client, user, file) {
    if (!file) return null;
    if (!user?.id) throw new Error("Sign in before uploading a Community image.");
    const invalid = validatePost({
      category: categories[0],
      body: "A valid Community image upload.",
      city: "CivicX",
      locality: "CivicX",
      file
    });
    if (invalid) throw new Error(invalid);
    if (typeof globalThis.crypto?.randomUUID !== "function") {
      throw new Error("Secure image upload is unavailable in this browser.");
    }

    const path = `${user.id}/${globalThis.crypto.randomUUID()}.${imageExtension(file)}`;
    const { error } = await client.storage.from(IMAGE_BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false
    });
    if (error) {
      const uploadFailure = new Error("The Community image could not be uploaded.");
      try {
        await removeImage(client, path);
      } catch (cleanupError) {
        uploadFailure.cleanupFailed = true;
        console.error("[CivicX community] Temporary image cleanup failed", {
          code: cleanupError.code || "UNKNOWN"
        });
      }
      throw uploadFailure;
    }
    return path;
  }

  async function removeImage(client, path) {
    if (!path) return;
    const { error } = await client.storage.from(IMAGE_BUCKET).remove([path]);
    if (error) throw error;
  }

  async function create(client, post) {
    const { error } = await client.from("community_posts").insert(post);
    if (error) throw new Error("Post was not saved. Check its content, sign-in and database migration.");
  }

  return Object.freeze({
    categories,
    create,
    defaultCategoryForReport,
    removeImage,
    reportBody,
    uploadImage,
    validatePost
  });
});
