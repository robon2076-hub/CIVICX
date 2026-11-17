function createSupabaseAuthenticator({ supabaseUrl, anonKey, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = String(supabaseUrl || "").replace(/\/+$/, "");
  const publicKey = String(anonKey || "");

  return async function authenticateAccessToken(accessToken) {
    if (!baseUrl || !publicKey || typeof fetchImpl !== "function") {
      const error = new Error("Supabase session verification is not configured.");
      error.code = "SUPABASE_AUTH_NOT_CONFIGURED";
      throw error;
    }

    const response = await fetchImpl(`${baseUrl}/auth/v1/user`, {
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${accessToken}`
      },
      signal: AbortSignal.timeout(8000)
    });

    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) {
      const error = new Error("Supabase session verification failed.");
      error.code = "SUPABASE_AUTH_UNAVAILABLE";
      throw error;
    }

    const user = await response.json();
    return user && typeof user.id === "string" && user.id ? user : null;
  };
}

module.exports = { createSupabaseAuthenticator };
