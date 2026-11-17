const { createClient } = require("@supabase/supabase-js");

const AUTHORITY_STATUSES = new Set([
  "Pending",
  "Submitted",
  "Verified",
  "Assigned",
  "In progress",
  "Resolved",
  "Cannot be Resolved",
  "Closed",
  "Rejected"
]);
const ACTIONS = new Set([
  "status_update",
  "reopen",
  "resolution_evidence_add",
  "resolution_evidence_remove"
]);
const AUTHORITY_ATTACHMENT_URL_TTL_SECONDS = 60;
const REPORT_ATTACHMENT_BUCKET = "civic-report-attachments";

class AuthorityError extends Error {
  constructor(message, status, options = {}) {
    super(message);
    this.name = "AuthorityError";
    this.status = status;
    this.credentialFailure = options.credentialFailure === true;
  }
}

function validateAuthorityRequest(reportId, authorization, body, masterKey = "") {
  if (!/^CX-[A-Za-z0-9-]{1,77}$/.test(String(reportId || ""))) {
    throw new AuthorityError("Invalid CivicX report reference.", 400);
  }
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(authorization || ""));
  if (!match) throw new AuthorityError("A valid signed-in authority session is required.", 401);
  if (typeof masterKey !== "string" || masterKey.length > 512) {
    throw new AuthorityError("The authority master key is invalid.", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !["action", "status", "evidenceUrl", "summary", "details"].includes(key))) {
    throw new AuthorityError("Invalid authority action payload.", 400);
  }
  if (!ACTIONS.has(body.action)) throw new AuthorityError("Unsupported authority action.", 400);
  if (typeof body.details !== "string" || !body.details.trim() || body.details.length > 2000) {
    throw new AuthorityError("Provide an audit note of at most 2,000 characters.", 400);
  }
  if (body.summary !== undefined &&
      (typeof body.summary !== "string" || !body.summary.trim() || body.summary.length > 240)) {
    throw new AuthorityError("The audit summary must be 1–240 characters.", 400);
  }

  if (body.action === "status_update" && !AUTHORITY_STATUSES.has(body.status)) {
    throw new AuthorityError("Choose a supported authority status.", 400);
  }
  if (body.action !== "status_update" && body.status !== undefined) {
    throw new AuthorityError("Status is only accepted for a status_update action.", 400);
  }
  if (body.action === "resolution_evidence_add") {
    if (typeof body.evidenceUrl !== "string" || body.evidenceUrl.length > 1000) {
      throw new AuthorityError("Provide an HTTPS resolution-evidence URL up to 1,000 characters.", 400);
    }
    let evidenceUrl;
    try {
      evidenceUrl = new URL(body.evidenceUrl);
    } catch {
      throw new AuthorityError("Provide a valid HTTPS resolution-evidence URL.", 400);
    }
    if (evidenceUrl.protocol !== "https:") {
      throw new AuthorityError("Resolution evidence must use HTTPS.", 400);
    }
  } else if (body.evidenceUrl !== undefined) {
    throw new AuthorityError("Evidence URLs are only accepted for resolution_evidence_add.", 400);
  }

  return {
    accessToken: match[1],
    masterKey,
    reportId,
    action: body.action,
    status: body.status,
    evidenceUrl: body.evidenceUrl,
    summary: body.summary?.trim(),
    details: body.details.trim()
  };
}

function validateAuthorityAttachmentRequest(reportId, authorization, masterKey = "") {
  if (!/^CX-[A-Za-z0-9-]{1,77}$/.test(String(reportId || ""))) {
    throw new AuthorityError("Invalid CivicX report reference.", 400);
  }
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(authorization || ""));
  if (!match) throw new AuthorityError("A valid signed-in authority session is required.", 401);
  if (typeof masterKey !== "string" || masterKey.length > 512) {
    throw new AuthorityError("The authority master key is invalid.", 400);
  }
  return { accessToken: match[1], masterKey, reportId };
}

function safeEqualSecret(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string" || !candidate || !expected) return false;
  const candidateBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (candidateBytes.length !== expectedBytes.length) return false;
  return require("node:crypto").timingSafeEqual(candidateBytes, expectedBytes);
}

function createServiceClient(options) {
  return options.client || createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}

async function requireActiveAuthority(client, accessToken, masterKey, expectedMasterKey) {
  const denied = () => new AuthorityError("Portal access could not be verified.", 403, {
    credentialFailure: true
  });
  if (!expectedMasterKey || !safeEqualSecret(masterKey, expectedMasterKey)) {
    throw denied();
  }
  const { data: userData, error: userError } = await client.auth.getUser(accessToken);
  if (userError || !userData?.user?.id) {
    throw denied();
  }

  const { data: authority, error: authorityError } = await client
    .from("civic_authorities")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (authorityError) throw new AuthorityError("Authority access could not be verified.", 503);
  if (!authority) throw denied();
  return userData.user.id;
}

async function requireAuthorityReportAccess(client, actorUserId, reportId) {
  const { data: allowed, error } = await client.rpc("civic_authority_can_access_report", {
    p_actor_user_id: actorUserId,
    p_report_id: reportId
  });
  if (error) throw new AuthorityError("Report jurisdiction access could not be verified.", 503);
  if (allowed !== true) {
    throw new AuthorityError("This report is outside the authority's assigned jurisdiction.", 403);
  }
}

function createAuthorityService(options = {}) {
  const client = createServiceClient(options);

  return async function performAuthorityAction(request) {
    const actorUserId = await requireActiveAuthority(
      client,
      request.accessToken,
      request.masterKey,
      options.authorityMasterKey
    );
    await requireAuthorityReportAccess(client, actorUserId, request.reportId);

    const { data, error } = await client.rpc("apply_civic_report_authority_action", {
      p_report_id: request.reportId,
      p_actor_user_id: actorUserId,
      p_action: request.action,
      p_status: request.status || null,
      p_evidence_url: request.evidenceUrl || null,
      p_summary: request.summary || null,
      p_details: request.details
    });
    if (error) {
      const status = error.code === "42501" ? 403
        : error.code === "P0002" ? 404
          : error.code === "22023" ? 400 : 503;
      throw new AuthorityError(
        status === 503 ? "The authority action could not be saved." : error.message,
        status
      );
    }
    if (!data || !data.event?.actor_user_id) {
      throw new AuthorityError("The authority action returned no attributable audit event.", 503);
    }
    return data;
  };
}

function createAuthorityAttachmentService(options = {}) {
  const client = createServiceClient(options);

  return async function createAuthorizedAttachmentUrl(request) {
    const actorUserId = await requireActiveAuthority(
      client,
      request.accessToken,
      request.masterKey,
      options.authorityMasterKey
    );
    await requireAuthorityReportAccess(client, actorUserId, request.reportId);

    const { data: report, error: reportError } = await client
      .from("civic_reports")
      .select("id,user_id,photo_path")
      .eq("id", request.reportId)
      .maybeSingle();
    if (reportError) throw new AuthorityError("The report attachment could not be verified.", 503);
    if (!report) throw new AuthorityError("CivicX report not found.", 404);
    if (!report.photo_path) throw new AuthorityError("This report has no attachment.", 404);

    const pathSegments = report.photo_path.split("/");
    if (pathSegments.length !== 3 ||
        pathSegments[0] !== report.user_id ||
        pathSegments[1] !== report.id ||
        !pathSegments[2] ||
        pathSegments[2] === "." ||
        pathSegments[2] === "..") {
      throw new AuthorityError("The report attachment path is invalid.", 503);
    }

    const { data, error } = await client.storage
      .from(REPORT_ATTACHMENT_BUCKET)
      .createSignedUrl(report.photo_path, AUTHORITY_ATTACHMENT_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new AuthorityError("The report attachment could not be accessed.", 503);
    }

    return {
      reportId: report.id,
      signedUrl: data.signedUrl,
      expiresIn: AUTHORITY_ATTACHMENT_URL_TTL_SECONDS
    };
  };
}

module.exports = {
  AuthorityError,
  createAuthorityAttachmentService,
  createAuthorityService,
  safeEqualSecret,
  validateAuthorityAttachmentRequest,
  validateAuthorityRequest
};
