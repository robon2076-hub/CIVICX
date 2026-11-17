const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { createApp } = require("./server/app");
const { createSupabaseAuthenticator } = require("./server/supabase-auth");
const {
  createAuthorityAttachmentService,
  createAuthorityService
} = require("./server/authority");
const { createPortalService } = require("./server/portal");
const { createPublicMapService } = require("./server/public-map");

const port = Number(process.env.PORT) || 3000;
const apiKey = process.env.GEMINI_API_KEY?.trim() || "";
if (!apiKey) {
  console.warn("Warning: Server missing GEMINI_API_KEY in .env. AI chat and photo analysis are unavailable.");
}
const supabaseUrl = process.env.SUPABASE_URL?.trim() || "";
const anonKey = process.env.SUPABASE_ANON_KEY?.trim() || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const authorityMasterKey = process.env.CIVICX_AUTHORITY_MASTER_KEY?.trim() || "";
const ownerMasterKey = process.env.CIVICX_OWNER_MASTER_KEY?.trim() || "";
const ownerUserIds = process.env.CIVICX_OWNER_USER_IDS?.trim() || "";
const authenticateUser = supabaseUrl && anonKey
  ? createSupabaseAuthenticator({ supabaseUrl, anonKey })
  : null;
if (!authenticateUser) {
  console.warn("Warning: Authenticated CivicX AI routes are disabled until Supabase URL and anon key are configured.");
}
const authorityService = supabaseUrl && serviceRoleKey && authorityMasterKey.length >= 32
  ? createAuthorityService({ supabaseUrl, serviceRoleKey, authorityMasterKey })
  : null;
const authorityAttachmentService = supabaseUrl && serviceRoleKey && authorityMasterKey.length >= 32
  ? createAuthorityAttachmentService({ supabaseUrl, serviceRoleKey, authorityMasterKey })
  : null;
const portalService = supabaseUrl && serviceRoleKey
  ? createPortalService({
    supabaseUrl,
    serviceRoleKey,
    authorityMasterKey,
    ownerMasterKey,
    ownerUserIds
  })
  : null;
const publicMapService = supabaseUrl && serviceRoleKey
  ? createPublicMapService({ supabaseUrl, serviceRoleKey })
  : null;
if (!authorityService) {
  console.warn("Warning: Authority actions are disabled until server-only Supabase credentials and a rotated 32+ character authority master key are configured.");
}
const app = createApp({
  apiKey,
  authorityService,
  authorityAttachmentService,
  authenticateUser,
  portalService,
  publicMapService
});

app.listen(port, "0.0.0.0", () => {
  console.log(`CIVICX is running on port ${port}`);
});
