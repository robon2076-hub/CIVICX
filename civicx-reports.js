(function (root, factory) {
  const reportStore = factory();
  if (typeof module === "object" && module.exports) module.exports = reportStore;
  else root.CivicXReports = reportStore;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const REPORT_COLUMNS = [
    "id", "user_id", "category", "title", "city", "location", "area", "description",
    "latitude", "longitude", "status", "priority", "registration_number", "submission_state",
    "status_source", "portal", "official_portal_url", "official_registration", "photo_path",
    "jurisdiction_key", "resolution_evidence_url", "created_at", "updated_at"
  ].join(",");
  const EVENT_COLUMNS = "id,report_id,actor_user_id,actor_kind,event_type,summary,details,metadata,created_at";
  const PHOTO_BUCKET = "civic-report-attachments";
  const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
  const PAGE_SIZE = 500;

  function isCivicXReference(value) {
    return /^CX-[A-Za-z0-9-]+$/i.test(String(value || "").trim());
  }

  function getReportReferences(record = {}) {
    const registrationNumber = record.registration_number;
    const civicXReference = record.civicx_reference ||
      (record.civicReport ? record.id : null) ||
      (isCivicXReference(registrationNumber) ? registrationNumber : null) ||
      (isCivicXReference(record.id) ? record.id : null);
    const officialCandidate = record.officialRegistration || record.official_registration ||
      (!record.civicReport
        ? registrationNumber || (!isCivicXReference(record.id) ? record.id : null)
        : null);
    return {
      civicXReference,
      officialRegistration: isCivicXReference(officialCandidate) ? null : officialCandidate
    };
  }

  function findOwnedReport(reports, userId, reference) {
    const cleanReference = String(reference || "").trim().toUpperCase();
    if (!Array.isArray(reports) || !userId || !cleanReference) return null;
    return reports.find((report) => {
      if (report.ownerId !== userId) return false;
      const references = getReportReferences(report);
      return [references.civicXReference, references.officialRegistration, report.id, report.registrationNumber]
        .some((value) => String(value || "").trim().toUpperCase() === cleanReference);
    }) || null;
  }

  function toReport(row, events = []) {
    return {
      id: row.id,
      ownerId: row.user_id,
      isMine: true,
      category: row.category,
      title: row.title,
      city: row.city,
      jurisdictionKey: row.jurisdiction_key || null,
      location: row.location,
      area: row.area,
      description: row.description,
      coordinates: [row.latitude, row.longitude],
      status: row.status,
      priority: row.priority,
      registrationNumber: row.registration_number || row.id,
      submissionState: row.submission_state,
      statusSource: row.status_source,
      portal: row.portal,
      officialPortalUrl: row.official_portal_url,
      officialRegistration: row.official_registration,
      photoPath: row.photo_path,
      photoName: row.photo_path ? "Private report photo" : "",
      resolutionEvidenceUrl: row.resolution_evidence_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      date: row.created_at ? new Date(row.created_at).toLocaleString() : "",
      events
    };
  }

  async function listForUser(client, userId) {
    const rows = await fetchAll((from, to) => client.from("civic_reports")
      .select(REPORT_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to));
    if (!rows.length) return [];

    const ids = rows.map((row) => row.id);
    const events = [];
    for (let index = 0; index < ids.length; index += 100) {
      const eventChunk = await fetchAll((from, to) => client.from("civic_report_events")
        .select(EVENT_COLUMNS)
        .in("report_id", ids.slice(index, index + 100))
        .order("created_at", { ascending: true })
        .range(from, to));
      events.push(...eventChunk);
    }

    let trackingRows = [];
    try {
      trackingRows = await fetchAll((from, to) => client.from("complaint_tracking")
        .select("report_id,registration_number,portal_status,status_remarks,status_date,official_document_url,checked_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .range(from, to));
    } catch (error) {
      if (error.code !== "PGRST205") throw error;
      console.warn("[CivicX reports] Optional complaint tracking is not configured; loading CivicX report histories without portal status enrichment.");
    }

    const eventsByReport = new Map();
    events.forEach((event) => {
      const reportEvents = eventsByReport.get(event.report_id) || [];
      reportEvents.push(event);
      eventsByReport.set(event.report_id, reportEvents);
    });
    const trackingByReport = new Map();
    trackingRows.forEach((tracking) => {
      if (tracking.report_id && !trackingByReport.has(tracking.report_id)) {
        trackingByReport.set(tracking.report_id, tracking);
      }
    });
    return rows.map((row) => {
      const report = toReport(row, eventsByReport.get(row.id) || []);
      const tracking = trackingByReport.get(row.id);
      if (!tracking) return report;
      return {
        ...report,
        officialRegistration: tracking.registration_number,
        portalStatus: tracking.portal_status,
        portalStatusRemarks: tracking.status_remarks,
        portalStatusDate: tracking.status_date,
        portalDocumentUrl: tracking.official_document_url,
        portalCheckedAt: tracking.checked_at
      };
    });
  }

  async function fetchAll(queryForRange) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await queryForRange(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
    }
  }

  async function create(client, user, report, photoBlob) {
    if (photoBlob) {
      if (photoBlob.type !== "image/jpeg") {
        throw new TypeError("Report attachments must be compressed JPEG images.");
      }
      if (!Number.isFinite(photoBlob.size) || photoBlob.size < 1 || photoBlob.size > MAX_PHOTO_BYTES) {
        throw new RangeError("The compressed report photo must be between 1 byte and 10 MiB.");
      }
    }
    const photoPath = photoBlob ? `${user.id}/${report.id}/issue-photo.jpg` : null;
    if (photoBlob) {
      const { error: photoError } = await client.storage.from(PHOTO_BUCKET).upload(photoPath, photoBlob, {
        contentType: "image/jpeg",
        upsert: false
      });
      if (photoError) {
        photoError.photoUploadFailed = true;
        throw photoError;
      }
    }

    const row = {
      id: report.id,
      user_id: user.id,
      category: report.category,
      title: report.title,
      city: report.city,
      location: report.location,
      area: report.area,
      description: report.description,
      latitude: report.coordinates[0],
      longitude: report.coordinates[1],
      status: report.status,
      priority: report.priority,
      registration_number: report.registrationNumber,
      submission_state: "awaiting_user_filing",
      status_source: "CivicX report preparation; not filed with an authority",
      portal: "CPGRAMS",
      official_portal_url: "https://pgportal.gov.in/Home/LodgeGrievance",
      jurisdiction_key: report.jurisdictionKey || null,
      photo_path: photoPath
    };
    const { data, error } = await client.from("civic_reports")
      .insert(row)
      .select(REPORT_COLUMNS)
      .single();
    if (error) {
      if (photoPath) {
        const { error: cleanupError } = await client.storage.from(PHOTO_BUCKET).remove([photoPath]);
        if (cleanupError) console.error("[CivicX reports] Unattached photo cleanup failed", cleanupError);
      }
      throw error;
    }
    return toReport(data, [{
      report_id: data.id,
      actor_kind: "citizen",
      event_type: "report_submitted",
      summary: "CivicX report prepared",
      created_at: data.created_at
    }]);
  }

  async function createWithCommunity(client, user, report, photoBlob, communityPost, communityService) {
    if (!client || !user?.id) throw new Error("Sign in before saving a report and Community post.");
    if (!communityService || typeof communityService.validatePost !== "function" ||
        typeof communityService.uploadImage !== "function") {
      throw new Error("Community post support is unavailable. Neither item was saved.");
    }
    if (photoBlob && (photoBlob.type !== "image/jpeg" ||
        !Number.isFinite(photoBlob.size) || photoBlob.size < 1 || photoBlob.size > MAX_PHOTO_BYTES)) {
      throw new RangeError("The redacted report photo must be a JPEG within the report upload limit.");
    }

    const body = communityService.reportBody(report.title, report.description);
    const validationMessage = communityService.validatePost({
      category: communityPost.category,
      body,
      city: report.city,
      locality: communityPost.locality,
      displayName: communityPost.displayName,
      file: photoBlob
    });
    if (validationMessage) throw new TypeError(validationMessage);

    const { data: existingReport, error: existingReportError } = await client.from("civic_reports")
      .select("id,user_id")
      .eq("id", report.id)
      .maybeSingle();
    if (existingReportError) throw existingReportError;
    if (existingReport) {
      if (existingReport.user_id !== user.id) {
        throw new Error("This report reference is already in use.");
      }
      const { data: existingPost, error: existingPostError } = await client.from("community_posts")
        .select("id")
        .eq("linked_report_id", report.id)
        .eq("author_id", user.id)
        .limit(1)
        .maybeSingle();
      if (existingPostError) throw existingPostError;
      if (existingPost) {
        return {
          reportId: existingReport.id,
          communityPostId: existingPost.id,
          alreadyCreated: true
        };
      }
      throw new Error("This report reference already exists without its cross-post; no duplicate was created.");
    }

    const reportPhotoPath = photoBlob ? `${user.id}/${report.id}/issue-photo.jpg` : null;
    let communityPhotoPath = null;
    let reportPhotoUploaded = false;
    let rpcAttempted = false;
    try {
      if (photoBlob) {
        const { error: uploadError } = await client.storage.from(PHOTO_BUCKET).upload(reportPhotoPath, photoBlob, {
          contentType: "image/jpeg",
          upsert: false
        });
        if (uploadError) {
          uploadError.photoUploadFailed = true;
          throw uploadError;
        }
        reportPhotoUploaded = true;
        communityPhotoPath = await communityService.uploadImage(client, user, photoBlob);
      }

      rpcAttempted = true;
      const { data, error } = await client.rpc("create_civic_report_with_community_post", {
        p_report: {
          id: report.id,
          category: report.category,
          title: report.title,
          city: report.city,
          location: report.location,
          area: report.area,
          description: report.description,
          latitude: report.coordinates[0],
          longitude: report.coordinates[1],
          priority: report.priority,
          jurisdiction_key: report.jurisdictionKey || null,
          photo_path: reportPhotoPath
        },
        p_community_category: communityPost.category,
        p_community_display_name: communityPost.displayName || null,
        p_community_locality: communityPost.locality || null,
        p_community_photo_path: communityPhotoPath
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result || result.report_id !== report.id || typeof result.community_post_id !== "string") {
        throw new Error("The database did not confirm both records.");
      }
      return {
        reportId: result.report_id,
        communityPostId: result.community_post_id,
        alreadyCreated: result.already_created === true
      };
    } catch (error) {
      if (rpcAttempted) {
        try {
          const { data: savedReport, error: savedReportError } = await client.from("civic_reports")
            .select("id,user_id,photo_path")
            .eq("id", report.id)
            .maybeSingle();
          if (savedReportError) throw savedReportError;
          const { data: savedPost, error: savedPostError } = await client.from("community_posts")
            .select("id,author_id,image_path")
            .eq("linked_report_id", report.id)
            .eq("author_id", user.id)
            .limit(1)
            .maybeSingle();
          if (savedPostError) throw savedPostError;
          if (savedReport?.user_id === user.id && savedPost?.author_id === user.id) {
            return {
              reportId: savedReport.id,
              communityPostId: savedPost.id,
              alreadyCreated: true
            };
          }
          if (savedReport?.user_id === user.id) {
            const partialSave = new Error("The report was saved, but the Community post was not saved.");
            partialSave.reportSaved = true;
            partialSave.communityPostSaved = false;
            throw partialSave;
          }
          if (savedReport?.photo_path === reportPhotoPath) reportPhotoUploaded = false;
          if (savedPost?.image_path === communityPhotoPath) communityPhotoPath = null;
        } catch (reconciliationError) {
          console.warn("[CivicX reports] Cross-post transaction status could not be verified", {
            code: reconciliationError.code || "UNKNOWN"
          });
          if (error && typeof error === "object") error.commitStatusUnknown = true;
          throw error;
        }
      }
      let cleanupFailed = Boolean(error?.cleanupFailed);
      if (communityPhotoPath) {
        try {
          await communityService.removeImage(client, communityPhotoPath);
        } catch (cleanupError) {
          cleanupFailed = true;
          console.error("[CivicX reports] Public cross-post photo cleanup failed", {
            code: cleanupError.code || "UNKNOWN"
          });
        }
      }
      if (reportPhotoUploaded) {
        try {
          const { error: cleanupError } = await client.storage.from(PHOTO_BUCKET).remove([reportPhotoPath]);
          if (cleanupError) throw cleanupError;
        } catch (cleanupError) {
          cleanupFailed = true;
          console.error("[CivicX reports] Private cross-post photo cleanup failed", {
            code: cleanupError.code || "UNKNOWN"
          });
        }
      }
      if (cleanupFailed && error && typeof error === "object") error.cleanupFailed = true;
      throw error;
    }
  }

  function communityCrosspostErrorMessage(error) {
    const message = String(error?.message || "");
    if (error?.reportSaved) {
      return "The CivicX report was saved, but the Community post was not saved. It is available in My reported issues.";
    }
    if (error?.photoUploadFailed) {
      return "Photo could not be saved. Neither the report nor Community post was saved.";
    }
    if (isNetworkError(error)) {
      return "Check your connection. Neither the report nor Community post could be confirmed.";
    }
    let result = "The report and Community post were not saved.";
    if (error?.commitStatusUnknown) {
      result = "We could not confirm whether both items were saved. Refresh your report list and the Community feed before retrying.";
    } else if (/email addresses and phone numbers|contact details/i.test(message)) {
      result = "Remove email addresses and phone numbers from the Community text. Neither item was saved.";
    } else if (/post limit reached/i.test(message)) {
      result = "You have reached the Community posting limit. Neither item was saved; try again later.";
    } else if (/Community image could not be uploaded/i.test(message)) {
      result = "The Community photo could not be uploaded, so neither the report nor post was saved.";
    } else if (/display name and broad locality|Community locality/i.test(message)) {
      result = "Complete the Community display name and broad locality. Neither item was saved.";
    } else if (/selected city is too long|Community city/i.test(message)) {
      result = "The selected city cannot be used in a Community post. Neither item was saved.";
    } else if (/Community category|Community post must be/i.test(message)) {
      result = `${message} Neither item was saved.`;
    }
    if (error?.cleanupFailed) {
      result += " A temporary photo could not be removed; please contact support.";
    }
    return result;
  }

  async function appendCitizenEvent(client, userId, reportId, eventType, summary, details, metadata = {}) {
    const { data, error } = await client.from("civic_report_events")
      .insert({
        report_id: reportId,
        actor_user_id: userId,
        actor_kind: "citizen",
        event_type: eventType,
        summary,
        details,
        metadata
      })
      .select(EVENT_COLUMNS)
      .single();
    if (error) throw error;
    return data;
  }

  async function downloadPhoto(client, report) {
    if (!report.photoPath) throw new Error("This report has no stored photo.");
    const { data, error } = await client.storage.from(PHOTO_BUCKET).createSignedUrl(report.photoPath, 60);
    if (error) throw error;
    const response = await fetch(data.signedUrl);
    if (!response.ok) throw new Error("The private report photo could not be downloaded.");
    return response.blob();
  }

  function summarizeStatuses(items) {
    const counts = {
      total: items.length,
      pending: 0,
      underReview: 0,
      resolved: 0,
      disputed: 0,
      reopened: 0,
      unresolved: 0
    };
    const statuses = {
      pending: new Set(["prepared (awaiting user filing)", "pending", "submitted", "assigned", "in progress"]),
      underReview: new Set(["verified", "under review", "under reinspection"]),
      resolved: new Set(["resolved", "resolved after reinspection"]),
      disputed: new Set(["resolution disputed"]),
      reopened: new Set(["reopened"]),
      unresolved: new Set(["cannot be resolved"])
    };
    items.forEach((item) => {
      const status = String(item.status || "").trim().toLowerCase();
      Object.keys(statuses).forEach((key) => {
        if (statuses[key].has(status)) counts[key] += 1;
      });
    });
    return counts;
  }

  function isNetworkError(error) {
    const code = String(error?.code || "").toUpperCase();
    const name = String(error?.name || "").toLowerCase();
    const message = String(error?.message || "").toLowerCase();
    return error instanceof TypeError ||
      ["NETWORK_ERROR", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(code) ||
      name.includes("network") ||
      /failed to fetch|fetch failed|network request failed|network error|connection (?:refused|reset)|timed out|timeout/.test(message);
  }

  function saveErrorMessage(error, context = {}) {
    if (context.locationMissing) return "Location is required. Choose a map point before saving.";
    if (context.cityMissing) return "City is required. Choose a registered city before saving.";
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    if (error?.photoUploadFailed || /storage|bucket|photo/i.test(message) && /upload|bucket|storage/i.test(message)) {
      return "Photo could not be saved. The report was not saved. Remove the photo or retry after checking photo storage.";
    }
    if (/expired|jwt|session|auth session/i.test(`${code} ${message}`) ||
        code === "PGRST301" || code === "401") {
      return "Not signed in or your sign-in session expired. Sign in again, then retry.";
    }
    if (isNetworkError(error)) {
      return "Check your connection. The report could not reach the database.";
    }
    if (code === "P0001" && /jurisdiction/i.test(message)) {
      return "Database setup incomplete: the jurisdiction rule migration is not ready. This report was not saved.";
    }
    if (["42703", "PGRST204"].includes(code) && /jurisdiction_key/i.test(message)) {
      return "Database setup incomplete: required report columns or migrations are missing. This report was not saved.";
    }
    if (code === "23503" && /jurisdiction/i.test(`${message} ${error?.constraint || ""}`)) {
      return "The selected city is not linked to an active CivicX jurisdiction. Refresh the page and choose a registered city; this report was not saved.";
    }
    if (code === "42501") {
      return "Database access denied. Sign in again and verify the civic_reports permissions; this report was not saved.";
    }
    if (code === "PGRST205" || code === "42P01") {
      return "Database setup incomplete: the CivicX report table or migration is missing. This report was not saved.";
    }
    if (/duplicate|23505/.test(`${code} ${message}`)) {
      return "This report reference already exists. Refresh My reported issues; no duplicate was created.";
    }
    return "Database error: the report could not be saved. Check the browser console for setup details.";
  }

  function limitDescriptionForPhotoAnalysis(description) {
    const text = String(description || "").trim();
    return { note: text.slice(0, 200), truncated: text.length > 200 };
  }

  return {
    appendCitizenEvent,
    create,
    createWithCommunity,
    communityCrosspostErrorMessage,
    downloadPhoto,
    findOwnedReport,
    getReportReferences,
    isNetworkError,
    isCivicXReference,
    limitDescriptionForPhotoAnalysis,
    listForUser,
    saveErrorMessage,
    summarizeStatuses,
    toReport
  };
});
