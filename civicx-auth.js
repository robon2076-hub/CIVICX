(() => {
  const listeners = new Set();
  let client = null;
  let user = null;
  let profile = null;
  let configurationError = "";
  let profileSetupMessage = "";
  let trackingSetupMessage = "";
  let reportsSetupMessage = "";
  let authMode = "login";
  let authStage = "email";
  let pendingEmail = "";
  let pendingMode = "login";
  let cooldownEndsAt = 0;
  let resendTimer = null;
  const dialog = document.createElement("dialog");
  dialog.className = "community-auth-dialog civicx-auth-dialog";
  dialog.setAttribute("aria-labelledby", "civicx-auth-title");
  dialog.innerHTML = `
    <div class="civicx-auth-visual" aria-hidden="true">
      <div class="civicx-auth-moving-column">
        <div class="civicx-auth-moving-track">
          <div class="civicx-auth-scene"><span class="civicx-auth-scene-tag">REPORT AN ISSUE</span><span class="civicx-auth-scene-icon">📍</span><strong>Make a local issue visible</strong><small>Prepare a report with location and useful context.</small></div>
          <div class="civicx-auth-scene"><span class="civicx-auth-scene-tag">COMMUNITY</span><span class="civicx-auth-scene-icon">💬</span><strong>Talk with neighbours</strong><small>Share updates and discuss practical solutions.</small></div>
          <div class="civicx-auth-scene"><span class="civicx-auth-scene-tag">FOLLOW UP</span><span class="civicx-auth-scene-icon">🧾</span><strong>Keep the next step clear</strong><small>Store your CivicX history and check official portals directly.</small></div>
          <div class="civicx-auth-scene"><span class="civicx-auth-scene-tag">CIVICX AI</span><span class="civicx-auth-scene-icon">✧</span><strong>Get civic guidance</strong><small>Help with reporting steps, not official filing or status verification.</small></div>
        </div>
        <div class="civicx-auth-moving-track is-reverse" aria-hidden="true">
          <div class="civicx-auth-scene"><span class="civicx-auth-scene-tag">REPORT AN ISSUE</span><span class="civicx-auth-scene-icon">📍</span><strong>Make a local issue visible</strong><small>Prepare a report with location and useful context.</small></div>
          <div class="civicx-auth-scene"><span class="civicx-auth-scene-tag">COMMUNITY</span><span class="civicx-auth-scene-icon">💬</span><strong>Talk with neighbours</strong><small>Share updates and discuss practical solutions.</small></div>
          <div class="civicx-auth-scene"><span class="civicx-auth-scene-tag">FOLLOW UP</span><span class="civicx-auth-scene-icon">🧾</span><strong>Keep the next step clear</strong><small>Store your CivicX history and check official portals directly.</small></div>
          <div class="civicx-auth-scene"><span class="civicx-auth-scene-tag">CIVICX AI</span><span class="civicx-auth-scene-icon">✧</span><strong>Get civic guidance</strong><small>Help with reporting steps, not official filing or status verification.</small></div>
        </div>
      </div>
      <div class="civicx-auth-visual-copy"><strong>Your city. Your voice.</strong><span>Sign in to save account-linked reports and their history across devices.</span></div>
    </div>
    <section class="civicx-auth-content">
      <h2 id="civicx-auth-title">Log in to CIVICX</h2>
      <p id="civicx-auth-description">Your private reports and histories are tied to your account and available across devices.</p>
      <div class="civicx-auth-modes" role="group" aria-label="Account action">
        <button type="button" data-auth-mode="login" aria-pressed="true">Log in</button>
        <button type="button" data-auth-mode="signup" aria-pressed="false">Sign up</button>
      </div>
      <form id="civicx-auth-email-form" class="civicx-auth-form">
        <label><span>Email address</span><input id="civicx-auth-email" type="email" required autocomplete="email" maxlength="254" /></label>
        <button class="button button-secondary" id="civicx-auth-send" type="submit">Send 6-digit code</button>
      </form>
      <form id="civicx-auth-code-form" class="civicx-auth-form" hidden>
        <p id="civicx-auth-code-destination"></p>
        <label><span>6-digit email code</span><input id="civicx-auth-code" type="text" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" maxlength="6" required /></label>
        <button class="button button-primary" id="civicx-auth-submit" type="submit">Verify code</button>
        <button class="button button-secondary" id="civicx-auth-resend" type="button" disabled>Resend code</button>
        <button class="civicx-auth-text-button" id="civicx-auth-change-email" type="button">Use a different email</button>
      </form>
      <form id="civicx-auth-username-form" class="civicx-auth-form" hidden>
        <p id="civicx-auth-verified-email"></p>
        <label><span>Choose a username</span><input id="civicx-auth-username" type="text" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" autocomplete="username" /></label>
        <small>Use 3–20 letters, numbers, or underscores.</small>
        <button class="button button-primary" id="civicx-auth-save-username" type="submit">Save username</button>
        <button class="button button-secondary" id="civicx-auth-check-profile" type="button" hidden>Retry profile check</button>
      </form>
      <p id="civicx-auth-message" role="status" aria-live="polite"></p>
    </section>
    <form method="dialog" class="community-dialog-close"><button type="submit" aria-label="Close sign-in">×</button></form>`;
  document.body.append(dialog);

  function setAuthMode(mode) {
    if (authStage !== "email") return;
    authMode = mode === "signup" ? "signup" : "login";
    const signingUp = authMode === "signup";
    dialog.querySelector("#civicx-auth-title").textContent = signingUp ? "Create your CIVICX account" : "Log in to CIVICX";
    dialog.querySelector("#civicx-auth-description").textContent = signingUp
      ? "Verify your email first, then choose a unique username."
      : "Your private reports and histories are tied to your account and available across devices.";
    dialog.querySelectorAll("[data-auth-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.authMode === authMode));
    });
  }

  function setAuthStage(stage) {
    authStage = stage;
    dialog.querySelector("#civicx-auth-email-form").hidden = stage !== "email";
    dialog.querySelector("#civicx-auth-code-form").hidden = stage !== "code";
    dialog.querySelector("#civicx-auth-username-form").hidden = stage !== "username";
    dialog.querySelector(".civicx-auth-modes").hidden = stage !== "email";
    if (stage === "email") {
      setAuthMode(authMode);
    } else if (stage === "code") {
      dialog.querySelector("#civicx-auth-title").textContent = "Check your email";
      dialog.querySelector("#civicx-auth-description").textContent = "Enter the 6-digit code sent by Supabase Auth.";
    } else if (stage === "username") {
      dialog.querySelector("#civicx-auth-title").textContent = "Choose your username";
      dialog.querySelector("#civicx-auth-description").textContent = "Your email is verified. Choose a unique username to finish setting up your account.";
    }
  }

  function updateCooldownButtons() {
    const remaining = Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000));
    const sendButton = dialog.querySelector("#civicx-auth-send");
    const resendButton = dialog.querySelector("#civicx-auth-resend");
    sendButton.disabled = remaining > 0;
    sendButton.textContent = remaining > 0
      ? `Wait ${remaining}s to resend`
      : pendingEmail ? "Resend 6-digit code" : "Send 6-digit code";
    resendButton.disabled = remaining > 0;
    resendButton.textContent = remaining > 0 ? `Resend code in ${remaining}s` : "Resend code";
    if (remaining === 0 && resendTimer) {
      window.clearInterval(resendTimer);
      resendTimer = null;
    }
  }

  function startResendCooldown() {
    cooldownEndsAt = Date.now() + 60_000;
    if (resendTimer) window.clearInterval(resendTimer);
    updateCooldownButtons();
    resendTimer = window.setInterval(updateCooldownButtons, 1000);
  }

  function otpErrorMessage(error) {
    const detail = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
    if (detail.includes("rate") || detail.includes("too many") || error?.status === 429) {
      return "Too many attempts. Wait a little before requesting or entering another code.";
    }
    if (detail.includes("expired") || detail.includes("token") || detail.includes("otp")) {
      return "That 6-digit code is wrong or expired. Request a new code and try again.";
    }
    return "Could not complete email verification. Check your connection and try again.";
  }

  function profileErrorMessage(error) {
    if (error?.code === "PGRST205") {
      return "Account profiles are not set up yet. Apply the CivicX user-profiles migration in Supabase before completing registration.";
    }
    if (error?.code === "42501") {
      return "The profile database permissions are not ready. Review the CivicX user-profiles migration and RLS policies.";
    }
    return "Your account profile could not be checked. Try again after confirming the profiles migration is applied.";
  }

  function showUsernameStage(targetUser, message = "") {
    setAuthStage("username");
    dialog.querySelector("#civicx-auth-verified-email").textContent =
      targetUser?.email ? `Verified email: ${targetUser.email}` : "Verified email";
    const unavailable = Boolean(profileSetupMessage);
    dialog.querySelector("#civicx-auth-username").disabled = unavailable;
    dialog.querySelector("#civicx-auth-save-username").disabled = unavailable;
    dialog.querySelector("#civicx-auth-check-profile").hidden = !unavailable;
    dialog.querySelector("#civicx-auth-message").textContent = message || profileSetupMessage;
    if (!unavailable) dialog.querySelector("#civicx-auth-username").focus();
    if (!dialog.open) dialog.showModal();
  }

  async function loadOwnProfile(targetUser) {
    const result = await client.from("profiles")
      .select("id,email,username,role")
      .eq("id", targetUser.id)
      .maybeSingle();
    if (user?.id !== targetUser.id) return { stale: true };
    if (result.error) {
      profile = null;
      profileSetupMessage = profileErrorMessage(result.error);
      console.error("[CivicX auth] Profile lookup failed", { code: result.error.code || "UNKNOWN" });
      notify();
      return { error: result.error };
    }
    profile = result.data || null;
    profileSetupMessage = "";
    notify();
    return { profile };
  }

  function notify() {
    const signedIn = Boolean(user);
    document.querySelectorAll("[data-civicx-auth-trigger]").forEach((button) => {
      const requestedMode = button.dataset.civicxAuthMode;
      button.textContent = signedIn ? "Sign out" : requestedMode === "signup" ? "Sign up" :
        requestedMode === "login" ? "Log in" : "Sign in to sync";
      button.setAttribute("aria-label", signedIn ? "Sign out of CIVICX" : "Sign in to CIVICX");
    });
    document.querySelectorAll("[data-civicx-auth-status]").forEach((element) => {
      element.textContent = profileSetupMessage || trackingSetupMessage || (signedIn
        ? "Your private civic reports and tracking data are connected to this account."
        : configurationError || "Sign in to save and view complaint numbers across devices.");
    });
    listeners.forEach((listener) => listener({
      client,
      user,
      profile,
      configured: Boolean(client),
      trackingReady: Boolean(client) && !trackingSetupMessage,
      reportsReady: Boolean(client) && !reportsSetupMessage,
      profileReady: Boolean(client) && !profileSetupMessage,
      configurationError,
      profileSetupMessage,
      trackingSetupMessage,
      reportsSetupMessage
    }));
  }

  const ready = (async () => {
    try {
      const response = await fetch("/api/public-config");
      const config = await response.json().catch(() => null);
      if (!response.ok || !config?.supabase?.configured) {
        configurationError = "Private tracking needs Supabase configured by the site owner.";
        notify();
        return { client: null, user: null, configured: false, configurationError };
      }
      if (!window.supabase?.createClient) throw new Error("The Supabase sign-in client did not load.");
      client = window.supabase.createClient(config.supabase.url, config.supabase.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });

      const { error: profileSchemaError } = await client.from("profiles").select("id").limit(0);
      if (profileSchemaError?.code === "PGRST205") {
        profileSetupMessage = "Account profiles are not set up. Apply the CivicX user-profiles migration in Supabase.";
      } else if (profileSchemaError && profileSchemaError.code !== "42501") {
        console.error("[CivicX auth] Profile schema check failed", { code: profileSchemaError.code || "UNKNOWN" });
        profileSetupMessage = "The account profile database could not be verified. Check the Supabase connection and migration.";
      }

      const { error: schemaError } = await client.from("complaint_tracking").select("id").limit(0);
      if (schemaError?.code === "PGRST205") {
        trackingSetupMessage = "The complaint-tracking table is missing. Apply the CivicX complaint-tracking migration in Supabase.";
      } else if (schemaError && schemaError.code !== "42501") {
        console.error("[CivicX tracking] Database schema check failed", { code: schemaError.code || "UNKNOWN" });
        trackingSetupMessage = "The complaint-tracking database could not be verified. Check the Supabase connection and migration.";
      }
      const { error: reportSchemaError } = await client.from("civic_reports").select("id").limit(0);
      if (reportSchemaError?.code === "PGRST205") {
        reportsSetupMessage = "The civic report tables are missing. Apply the CivicX report persistence migration in Supabase.";
      } else if (reportSchemaError && reportSchemaError.code !== "42501") {
        console.error("[CivicX reports] Database schema check failed", { code: reportSchemaError.code || "UNKNOWN" });
        reportsSetupMessage = "The civic report database could not be verified. Check the Supabase connection and migration.";
      }
      if (!reportsSetupMessage) {
        const { error: historySchemaError } = await client.from("civic_report_events").select("id").limit(0);
        if (historySchemaError?.code === "PGRST205") {
          reportsSetupMessage = "The civic report history table is missing. Apply the CivicX report persistence migration in Supabase.";
        } else if (historySchemaError && historySchemaError.code !== "42501") {
          console.error("[CivicX reports] History schema check failed", { code: historySchemaError.code || "UNKNOWN" });
          reportsSetupMessage = "The civic report history database could not be verified. Check the Supabase connection and migration.";
        }
      }
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      user = data.session?.user || null;
      client.auth.onAuthStateChange((_event, session) => {
        user = session?.user || null;
        if (!user) profile = null;
        notify();
      });
      if (user && !profileSetupMessage) {
        const loaded = await loadOwnProfile(user);
        if (!loaded.error && !loaded.stale && !loaded.profile) showUsernameStage(user);
      }
    } catch (error) {
      configurationError = "Private tracking could not connect. Check the Supabase setup and reload.";
      console.error("[CivicX auth] Initialization failed", error);
    }
    notify();
    return {
      client,
      user,
      profile,
      configured: Boolean(client),
      trackingReady: Boolean(client) && !trackingSetupMessage,
      reportsReady: Boolean(client) && !reportsSetupMessage,
      profileReady: Boolean(client) && !profileSetupMessage,
      configurationError,
      profileSetupMessage,
      trackingSetupMessage,
      reportsSetupMessage
    };
  })();

  async function sendOtp(email, mode) {
    const message = dialog.querySelector("#civicx-auth-message");
    if (!client || !email) {
      message.textContent = configurationError || "Enter your email address first.";
      return;
    }
    if (Date.now() < cooldownEndsAt) {
      updateCooldownButtons();
      return;
    }
    dialog.querySelector("#civicx-auth-send").disabled = true;
    dialog.querySelector("#civicx-auth-resend").disabled = true;
    message.textContent = "Sending verification code…";
    try {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: mode === "signup" }
      });
      if (error) throw error;
      pendingEmail = email;
      pendingMode = mode;
      dialog.querySelector("#civicx-auth-email").value = email;
      dialog.querySelector("#civicx-auth-code-destination").textContent = `A code was sent to ${email}.`;
      dialog.querySelector("#civicx-auth-code").value = "";
      setAuthStage("code");
      startResendCooldown();
      message.textContent = "Code sent. Check your email, then enter it below.";
      dialog.querySelector("#civicx-auth-code").focus();
    } catch (error) {
      console.error("[CivicX auth] Verification code request failed", error);
      message.textContent = otpErrorMessage(error);
      updateCooldownButtons();
    }
  }

  dialog.querySelector("#civicx-auth-email-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const email = dialog.querySelector("#civicx-auth-email").value.trim().toLowerCase();
    void sendOtp(email, authMode);
  });

  dialog.querySelector("#civicx-auth-resend").addEventListener("click", () => {
    if (pendingEmail) void sendOtp(pendingEmail, pendingMode);
  });

  dialog.querySelector("#civicx-auth-change-email").addEventListener("click", () => {
    setAuthStage("email");
    dialog.querySelector("#civicx-auth-message").textContent = "";
    dialog.querySelector("#civicx-auth-email").focus();
    updateCooldownButtons();
  });

  dialog.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setAuthMode(button.dataset.authMode);
      dialog.querySelector("#civicx-auth-message").textContent = "";
    });
  });

  dialog.querySelector("#civicx-auth-code-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = pendingEmail;
    const token = dialog.querySelector("#civicx-auth-code").value.trim();
    const message = dialog.querySelector("#civicx-auth-message");
    if (!client || !email || !/^\d{6}$/.test(token)) {
      message.textContent = "Enter the 6-digit code from your email.";
      return;
    }
    const submitButton = dialog.querySelector("#civicx-auth-submit");
    submitButton.disabled = true;
    message.textContent = "Verifying…";
    try {
      const { data, error } = await client.auth.verifyOtp({ email, token, type: "email" });
      if (error) throw error;
      if (!data.user?.id || !data.user.email) {
        throw new Error("Supabase verified the code without returning the account identity.");
      }
      user = data.user;
      profile = null;
      notify();
      const loaded = await loadOwnProfile(user);
      if (loaded.error || loaded.stale) {
        showUsernameStage(user, profileSetupMessage);
        return;
      }
      if (loaded.profile) {
        dialog.close();
        window.location.assign("dashboard.html");
        return;
      }
      showUsernameStage(user);
    } catch (error) {
      console.error("[CivicX auth] Verification failed", error);
      message.textContent = otpErrorMessage(error);
    } finally {
      submitButton.disabled = false;
    }
  });

  dialog.querySelector("#civicx-auth-username-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = dialog.querySelector("#civicx-auth-username").value.trim();
    const message = dialog.querySelector("#civicx-auth-message");
    if (!user || !client) {
      message.textContent = "Your verified session is unavailable. Sign in again to continue.";
      return;
    }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      message.textContent = "Use 3–20 letters, numbers, or underscores for your username.";
      return;
    }
    const saveButton = dialog.querySelector("#civicx-auth-save-username");
    saveButton.disabled = true;
    message.textContent = "Checking username availability…";
    try {
      const { data: available, error: availabilityError } = await client.rpc(
        "is_username_available",
        { p_username: username }
      );
      if (availabilityError) {
        if (availabilityError.code === "PGRST202" || availabilityError.code === "42883") {
          throw new Error("Username availability is not configured. Apply the CivicX user-profiles migration.");
        }
        throw availabilityError;
      }
      if (available !== true) {
        message.textContent = "That username is unavailable. Choose another one.";
        return;
      }
      const { data, error } = await client.from("profiles")
        .insert({
          id: user.id,
          email: user.email.toLowerCase(),
          username,
          role: "citizen"
        })
        .select("id,email,username,role")
        .single();
      if (error) {
        if (error.code === "23505") {
          message.textContent = "That username was just taken. Choose another one.";
          return;
        }
        throw error;
      }
      profile = data;
      profileSetupMessage = "";
      notify();
      dialog.close();
      window.location.assign("dashboard.html");
    } catch (error) {
      console.error("[CivicX auth] Profile creation failed", { code: error.code || "UNKNOWN" });
      message.textContent = error.message && error.message.startsWith("Username availability")
        ? error.message
        : profileErrorMessage(error);
    } finally {
      saveButton.disabled = Boolean(profileSetupMessage);
    }
  });

  dialog.querySelector("#civicx-auth-check-profile").addEventListener("click", async () => {
    if (!user || !client) return;
    const retryButton = dialog.querySelector("#civicx-auth-check-profile");
    retryButton.disabled = true;
    dialog.querySelector("#civicx-auth-message").textContent = "Checking account profile setup…";
    try {
      const loaded = await loadOwnProfile(user);
      if (loaded.profile) {
        dialog.close();
        window.location.assign("dashboard.html");
      } else if (!loaded.error) {
        showUsernameStage(user);
      } else {
        dialog.querySelector("#civicx-auth-message").textContent = profileSetupMessage;
      }
    } finally {
      retryButton.disabled = false;
    }
  });

  async function openDialog(mode = "login") {
    await ready;
    if (user && !profile) {
      showUsernameStage(user);
    } else if (authStage === "email" && !pendingEmail) {
      setAuthMode(mode);
    }
    dialog.querySelector("#civicx-auth-message").textContent =
      profileSetupMessage || configurationError || "";
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-civicx-auth-trigger]");
    if (!button) return;
    await ready;
    if (user && client) {
      try {
        const { error } = await client.auth.signOut();
        if (error) throw error;
      } catch (error) {
        console.error("[CivicX auth] Sign out failed", error);
        document.querySelectorAll("[data-civicx-auth-status]").forEach((element) => {
          element.textContent = "Could not sign out. Please try again.";
        });
      }
      return;
    }
    await openDialog(button.dataset.civicxAuthMode || "login");
  });

  window.CivicXAuth = {
    ready,
    get trackingReady() { return Boolean(client) && !trackingSetupMessage; },
    get trackingSetupMessage() { return trackingSetupMessage; },
    get reportsReady() { return Boolean(client) && !reportsSetupMessage; },
    get reportsSetupMessage() { return reportsSetupMessage; },
    get profileReady() { return Boolean(client) && !profileSetupMessage; },
    get profileSetupMessage() { return profileSetupMessage; },
    get profile() { return profile; },
    get client() { return client; },
    get user() { return user; },
    open: openDialog,
    async signOut() {
      await ready;
      if (!client) throw new Error(configurationError || "CivicX sign-out is unavailable.");
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
    onChange(listener) {
      listeners.add(listener);
      if (client || configurationError || profileSetupMessage || trackingSetupMessage) listener({
        client,
        user,
        profile,
        configured: Boolean(client),
        trackingReady: Boolean(client) && !trackingSetupMessage,
        reportsReady: Boolean(client) && !reportsSetupMessage,
        profileReady: Boolean(client) && !profileSetupMessage,
        configurationError,
        profileSetupMessage,
        trackingSetupMessage,
        reportsSetupMessage
      });
      return () => listeners.delete(listener);
    }
  };
})();
