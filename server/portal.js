const { createClient } = require("@supabase/supabase-js");
const { safeEqualSecret } = require("./authority");

const REPORT_ATTACHMENT_BUCKET = "civic-report-attachments";
const ATTACHMENT_URL_TTL_SECONDS = 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JURISDICTION_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/;

class PortalError extends Error {
  constructor(message, status, options = {}) {
    super(message);
    this.name = "PortalError";
    this.status = status;
    this.credentialFailure = options.credentialFailure === true;
  }
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

function createPortalService(options = {}) {
  const client = createServiceClient(options);
  const ownerIds = new Set(
    String(options.ownerUserIds || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => UUID_PATTERN.test(value))
  );
  const ownerMasterKey = options.ownerMasterKey || "";
  const authorityMasterKey = options.authorityMasterKey || "";
  const denied = () => new PortalError("Portal access could not be verified.", 403, {
    credentialFailure: true
  });

  async function authenticate(accessToken) {
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data?.user?.id) {
      throw denied();
    }
    return data.user.id;
  }

  async function getEntryStatus(request) {
    if (!request || typeof request.accessToken !== "string" || !request.accessToken) {
      throw new PortalError("Sign in to check portal availability.", 401);
    }
    const userId = await authenticate(request.accessToken);
    return { isOwner: ownerIds.has(userId) };
  }

  async function authenticateAuthorityKey(request) {
    if (!request || typeof request.accessToken !== "string" ||
        typeof request.masterKey !== "string" || !request.masterKey) {
      throw new PortalError("Portal access could not be verified. Sign in and try again.", 401, {
        credentialFailure: true
      });
    }
    if (!authorityMasterKey) throw new PortalError("Portal access is not configured on this server.", 503);
    if (authorityMasterKey.length < 32) {
      throw new PortalError("Portal keys must be rotated to high-entropy values before activation.", 503);
    }
    const userId = await authenticate(request.accessToken);
    if (!safeEqualSecret(request.masterKey, authorityMasterKey)) throw denied();
    return userId;
  }

  async function prepareAuthorityEntry(request) {
    const userId = await authenticateAuthorityKey(request);
    const { data: authority, error: authorityError } = await client
      .from("civic_authorities")
      .select("user_id,is_active")
      .eq("user_id", userId)
      .maybeSingle();
    if (authorityError) throw new PortalError("Authority access could not be verified.", 503);
    if (!authority?.is_active) throw denied();
    const { data: assignments, error: assignmentError } = await client
      .from("civic_authority_jurisdictions")
      .select("jurisdiction_key")
      .eq("authority_user_id", userId);
    if (assignmentError) throw new PortalError("Authority access could not be verified.", 503);
    const assignedKeys = [...new Set((assignments || []).map((row) => row.jurisdiction_key))];
    if (!assignedKeys.length) throw denied();
    const { data: jurisdictions, error: jurisdictionError } = await client
      .from("civic_jurisdictions")
      .select("jurisdiction_key")
      .in("jurisdiction_key", assignedKeys)
      .eq("is_active", true);
    if (jurisdictionError) throw new PortalError("Authority access could not be verified.", 503);
    if (!jurisdictions?.length) throw denied();
    return { verified: true };
  }

  async function authorize(request) {
    if (!request || typeof request.accessToken !== "string" ||
        typeof request.masterKey !== "string" || !request.masterKey) {
      throw new PortalError("Portal access could not be verified. Sign in and try again.", 401, {
        credentialFailure: true
      });
    }
    const hasConfiguredKey = Boolean(ownerMasterKey || authorityMasterKey);
    if (!hasConfiguredKey) throw new PortalError("Portal access is not configured on this server.", 503);
    if ((ownerMasterKey && ownerMasterKey.length < 32) ||
        (authorityMasterKey && authorityMasterKey.length < 32)) {
      throw new PortalError("Portal keys must be rotated to high-entropy values before activation.", 503);
    }

    const userId = await authenticate(request.accessToken);
    if (ownerMasterKey && safeEqualSecret(request.masterKey, ownerMasterKey)) {
      if (!ownerIds.has(userId)) throw denied();
      return { userId, role: "owner", jurisdictionKeys: null };
    }
    if (!authorityMasterKey || !safeEqualSecret(request.masterKey, authorityMasterKey)) {
      throw denied();
    }

    const { data: authority, error: authorityError } = await client
      .from("civic_authorities")
      .select("user_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (authorityError) throw new PortalError("Authority access could not be verified.", 503);
    if (!authority) throw denied();

    const { data: assignments, error: assignmentError } = await client
      .from("civic_authority_jurisdictions")
      .select("jurisdiction_key")
      .eq("authority_user_id", userId);
    if (assignmentError) throw new PortalError("Authority jurisdiction assignments could not be verified.", 503);
    const assignedKeys = [...new Set((assignments || []).map((row) => row.jurisdiction_key))];
    if (!assignedKeys.length) throw denied();

    const { data: jurisdictions, error: jurisdictionError } = await client
      .from("civic_jurisdictions")
      .select("jurisdiction_key")
      .in("jurisdiction_key", assignedKeys)
      .eq("is_active", true);
    if (jurisdictionError) throw new PortalError("Active jurisdictions could not be verified.", 503);
    const activeKeys = [...new Set((jurisdictions || []).map((row) => row.jurisdiction_key))];
    if (!activeKeys.length) throw denied();
    return { userId, role: "authority", jurisdictionKeys: activeKeys };
  }

  async function canAccessReport(access, reportId) {
    if (access.role === "owner") return;
    const { data: allowed, error } = await client.rpc("civic_authority_can_access_report", {
      p_actor_user_id: access.userId,
      p_report_id: reportId
    });
    if (error) throw new PortalError("Report jurisdiction access could not be verified.", 503);
    if (allowed !== true) throw new PortalError("This report is outside your assigned jurisdiction.", 403);
  }

  async function listReports(request) {
    const access = await authorize(request);
    const data = [];
    for (let from = 0; ; from += 500) {
      let query = client.from("civic_reports")
        .select("id,title,category,city,location,status,created_at,jurisdiction_key,photo_path")
        .order("created_at", { ascending: false });
      if (access.role === "authority") query = query.in("jurisdiction_key", access.jurisdictionKeys);
      const { data: page, error } = await query.range(from, from + 499);
      if (error) throw new PortalError("Reports could not be loaded.", 503);
      data.push(...page);
      if (page.length < 500) break;
    }
    return {
      role: access.role,
      reports: data.map((report) => ({
        id: report.id,
        title: report.title,
        category: report.category,
        city: report.city,
        location: report.location,
        status: report.status,
        createdAt: report.created_at,
        jurisdictionKey: report.jurisdiction_key,
        hasAttachment: Boolean(report.photo_path)
      }))
    };
  }

  async function listJurisdictions() {
    const selectJurisdictions = (columns) => client
      .from("civic_jurisdictions")
      .select(columns)
      .eq("is_active", true)
      .order("display_name", { ascending: true });
    let result = await selectJurisdictions(
      "jurisdiction_key,display_name,center_latitude,center_longitude"
    );
    const missingOptionalCenter = result.error &&
      ["42703", "PGRST204"].includes(result.error.code) &&
      /center_(latitude|longitude)/i.test(
        `${result.error.message || ""} ${result.error.details || ""} ${result.error.hint || ""}`
      );
    if (missingOptionalCenter) {
      result = await selectJurisdictions("jurisdiction_key,display_name");
    }
    const { data, error } = result;
    if (error) throw new PortalError("Active jurisdictions could not be loaded.", 503);
    return {
      jurisdictions: (data || []).map((jurisdiction) => ({
        jurisdictionKey: jurisdiction.jurisdiction_key,
        displayName: jurisdiction.display_name,
        centerLatitude: jurisdiction.center_latitude,
        centerLongitude: jurisdiction.center_longitude,
        isActive: true
      }))
    };
  }

  async function getReport(request) {
    if (!/^CX-[A-Za-z0-9-]{1,77}$/.test(String(request.reportId || ""))) {
      throw new PortalError("Invalid CivicX report reference.", 400);
    }
    const access = await authorize(request);
    await canAccessReport(access, request.reportId);
    let query = client.from("civic_reports")
      .select("id,title,category,city,location,area,description,status,priority,created_at,jurisdiction_key,photo_path")
      .eq("id", request.reportId);
    if (access.role === "authority") query = query.in("jurisdiction_key", access.jurisdictionKeys);
    const { data: report, error } = await query.maybeSingle();
    if (error) throw new PortalError("The report could not be loaded.", 503);
    if (!report) throw new PortalError("CivicX report not found.", 404);
    const { data: events, error: eventsError } = await client.from("civic_report_events")
      .select("event_type,actor_kind,actor_user_id,summary,details,created_at")
      .eq("report_id", request.reportId)
      .order("created_at", { ascending: true });
    if (eventsError) throw new PortalError("The report history could not be loaded.", 503);
    return {
      report: { ...report, hasAttachment: Boolean(report.photo_path), photo_path: undefined },
      events: events || []
    };
  }

  async function getAttachment(request) {
    if (!/^CX-[A-Za-z0-9-]{1,77}$/.test(String(request.reportId || ""))) {
      throw new PortalError("Invalid CivicX report reference.", 400);
    }
    const access = await authorize(request);
    await canAccessReport(access, request.reportId);
    let query = client.from("civic_reports")
      .select("id,user_id,photo_path,jurisdiction_key")
      .eq("id", request.reportId);
    if (access.role === "authority") query = query.in("jurisdiction_key", access.jurisdictionKeys);
    const { data: report, error } = await query.maybeSingle();
    if (error) throw new PortalError("The report attachment could not be verified.", 503);
    if (!report) throw new PortalError("CivicX report not found.", 404);
    if (!report.photo_path) throw new PortalError("This report has no attachment.", 404);
    const parts = report.photo_path.split("/");
    if (parts.length !== 3 || parts[0] !== report.user_id ||
        parts[1] !== report.id || !parts[2] || parts[2] === "." || parts[2] === "..") {
      throw new PortalError("The report attachment path is invalid.", 503);
    }
    const { data, error: signError } = await client.storage
      .from(REPORT_ATTACHMENT_BUCKET)
      .createSignedUrl(report.photo_path, ATTACHMENT_URL_TTL_SECONDS);
    if (signError || !data?.signedUrl) throw new PortalError("The report attachment could not be accessed.", 503);
    return { reportId: report.id, signedUrl: data.signedUrl, expiresIn: ATTACHMENT_URL_TTL_SECONDS };
  }

  async function listOwnerConfiguration(request) {
    const access = await authorize(request);
    if (access.role !== "owner") throw new PortalError("Owner access is required.", 403);
    const [authoritiesResult, assignmentsResult, jurisdictionsResult] = await Promise.all([
      client.from("civic_authorities").select("user_id,is_active,created_at").order("created_at", { ascending: true }),
      client.from("civic_authority_jurisdictions").select("authority_user_id,jurisdiction_key"),
      client.from("civic_jurisdictions").select("jurisdiction_key,display_name,is_active").order("display_name", { ascending: true })
    ]);
    if (authoritiesResult.error || assignmentsResult.error || jurisdictionsResult.error) {
      throw new PortalError("Authority configuration could not be loaded.", 503);
    }
    return {
      authorities: authoritiesResult.data || [],
      assignments: assignmentsResult.data || [],
      jurisdictions: jurisdictionsResult.data || []
    };
  }

  async function setAuthorityJurisdictions(request) {
    const access = await authorize(request);
    if (access.role !== "owner") throw new PortalError("Owner access is required.", 403);
    if (!UUID_PATTERN.test(String(request.authorityUserId || "")) ||
        !Array.isArray(request.jurisdictionKeys) ||
        request.jurisdictionKeys.length > 50 ||
        request.jurisdictionKeys.some((key) =>
          typeof key !== "string" || !JURISDICTION_KEY_PATTERN.test(key)) ||
        new Set(request.jurisdictionKeys).size !== request.jurisdictionKeys.length) {
      throw new PortalError("Provide a valid authority account and unique jurisdiction keys.", 400);
    }
    const { data, error } = await client.rpc("civic_owner_set_authority_jurisdictions", {
      p_actor_user_id: access.userId,
      p_authority_user_id: request.authorityUserId,
      p_jurisdiction_keys: request.jurisdictionKeys
    });
    if (error) throw new PortalError("Authority jurisdiction changes could not be saved.", 503);
    return { changedAssignments: data };
  }

  return {
    getAttachment,
    getEntryStatus,
    getReport,
    listJurisdictions,
    listOwnerConfiguration,
    listReports,
    prepareAuthorityEntry,
    setAuthorityJurisdictions
  };
}

module.exports = { PortalError, createPortalService };
