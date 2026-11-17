(() => {
  const categories = window.CivicXCommunityPosts.categories;
  const status = document.getElementById("community-status");
  const feed = document.getElementById("community-feed");
  const formMessage = document.getElementById("community-form-message");
  const submitButton = document.getElementById("community-post-submit");
  const postColumns = "id,author_id,category,city,locality,body,image_path,linked_report_id,support_count,upvote_count,downvote_count,created_at,updated_at,community_profiles(display_name),community_comments(count)";
  const requestedPostId = new URLSearchParams(window.location.search).get("post");
  let pendingPostId = requestedPostId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedPostId)
    ? requestedPostId
    : "";
  let client = null;
  let user = null;
  let profile = null;
  let realtimeChannel = null;
  let notificationChannel = null;
  let notificationUserId = null;
  let followedPosts = new Set();
  let votesByPost = new Map();
  let feedTimer = null;

  function setFormMessage(message, isError) {
    formMessage.textContent = message;
    formMessage.classList.toggle("is-error", Boolean(isError));
  }

  function updateAuthView() {
    const signedIn = Boolean(user);
    document.getElementById("community-user-label").textContent = signedIn
      ? `Signed in · ${profile?.display_name || user.email || "verified citizen"}`
      : "Sign in to join the conversation";
    document.getElementById("community-user-location").textContent = profile
      ? `${profile.locality}, ${profile.city} · Public profile shows only your display name and broad locality.`
      : "Choose a broad locality in your profile. CivicX never publishes precise addresses here.";
    document.getElementById("community-auth-open").textContent = signedIn ? "Sign out" : "Sign in";
    submitButton.disabled = signedIn && !client;
    submitButton.textContent = signedIn ? "Post discussion" : "Sign in to post";
    ["profile-display-name", "profile-city", "profile-locality", "post-category", "post-body", "post-image", "post-report-id"]
      .forEach((id) => { document.getElementById(id).disabled = !signedIn || !client; });
  }

  function escapeLike(value) {
    return value.replace(/[\\%_,]/g, (character) => `\\${character}`);
  }

  function localTimestamp(value) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function publicImage(path) {
    if (!path) return "";
    const { data } = client.storage.from("civicx-community").getPublicUrl(path);
    return data.publicUrl;
  }

  function createButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderPost(post) {
    const article = document.createElement("article");
    article.className = "community-post";
    article.dataset.postId = post.id;
    article.id = `community-post-${post.id}`;
    article.tabIndex = -1;

    const heading = document.createElement("div");
    heading.className = "community-post-heading";
    const author = document.createElement("strong");
    author.textContent = post.community_profiles?.display_name || "CivicX neighbour";
    const metadata = document.createElement("span");
    metadata.textContent = `${post.locality}, ${post.city} · ${localTimestamp(post.updated_at || post.created_at)}`;
    const category = document.createElement("span");
    category.className = "community-category";
    category.textContent = post.category;
    const authorBlock = document.createElement("div");
    authorBlock.className = "community-post-author";
    authorBlock.append(author, metadata);
    heading.append(authorBlock, category);

    const body = document.createElement("p");
    body.className = "community-post-body";
    body.textContent = post.body;
    article.append(heading, body);
    if (post.linked_report_id) {
      const reportRef = document.createElement("p");
      reportRef.className = "community-linked-report";
      reportRef.textContent = `Related CivicX report: ${post.linked_report_id} · This discussion does not submit or update a complaint.`;
      article.append(reportRef);
    }
    if (post.image_path) {
      const image = document.createElement("img");
      image.className = "community-post-image";
      image.src = publicImage(post.image_path);
      image.alt = `Photo attached to ${post.category} discussion`;
      image.loading = "lazy";
      article.append(image);
    }

    const upvotes = post.upvote_count || 0;
    const downvotes = post.downvote_count || 0;
    const currentVote = votesByPost.get(post.id) || 0;
    const commentCount = post.community_comments?.[0]?.count || 0;
    const actions = document.createElement("div");
    actions.className = "community-post-actions";
    const upvote = createButton(`▲ Upvote (${upvotes})`, `community-action community-vote${currentVote === 1 ? " is-selected" : ""}`, () => toggleVote(post.id, 1));
    const downvote = createButton(`▼ Downvote (${downvotes})`, `community-action community-vote${currentVote === -1 ? " is-selected" : ""}`, () => toggleVote(post.id, -1));
    upvote.setAttribute("aria-pressed", String(currentVote === 1));
    downvote.setAttribute("aria-pressed", String(currentVote === -1));
    actions.append(
      upvote,
      downvote,
      createButton(followedPosts.has(post.id) ? "Following" : "Follow discussion", "community-action", () => toggleFollow(post.id)),
      createButton(`Replies (${commentCount})`, "community-action", () => loadComments(post.id, article)),
      createButton("Report", "community-action community-report-action", () => reportPost(post.id))
    );
    if (user?.id === post.author_id) {
      actions.append(
        createButton("Edit", "community-action", () => editPost(post)),
        createButton("Delete", "community-action community-report-action", () => deletePost(post.id))
      );
    }
    article.append(actions);
    const comments = document.createElement("div");
    comments.className = "community-comments";
    comments.dataset.commentsFor = post.id;
    article.append(comments);
    return article;
  }

  async function loadFeed() {
    if (!client) return false;
    const city = document.getElementById("feed-city").value.trim();
    const locality = document.getElementById("feed-locality").value.trim();
    const category = document.getElementById("feed-category").value;
    const search = escapeLike(document.getElementById("feed-search").value.trim());
    let query = client.from("community_posts")
      .select(postColumns)
      .eq("visibility", "published")
      .order("created_at", { ascending: false })
      .limit(60);
    if (city) query = query.eq("city", city);
    if (locality) query = query.eq("locality", locality);
    if (category) query = query.eq("category", category);
    if (search) query = query.ilike("body", `%${search}%`);
    const { data, error } = await query;
    if (error) {
      status.textContent = error.code === "PGRST205"
        ? "Community database tables are missing. Apply the community migration in Supabase to enable discussions."
        : "Community feed could not be loaded. Check Supabase configuration and database migration.";
      return false;
    }
    const posts = data || [];
    let requestedPostUnavailable = false;
    if (pendingPostId) {
      const postId = pendingPostId;
      pendingPostId = "";
      if (!posts.some((post) => post.id === postId)) {
        const { data: requestedPost, error: requestedPostError } = await client.from("community_posts")
          .select(postColumns)
          .eq("id", postId)
          .eq("visibility", "published")
          .maybeSingle();
        if (requestedPostError) {
          status.textContent = "The linked Community post could not be loaded. Please try again.";
          return false;
        }
        if (requestedPost) posts.unshift(requestedPost);
        else requestedPostUnavailable = true;
      }
    }
    if (user && posts.length) {
      const { data: follows, error: followError } = await client.from("community_follows")
        .select("post_id").eq("user_id", user.id).in("post_id", posts.map((post) => post.id));
      if (followError) {
        setFormMessage("Follow status could not be loaded.", true);
        followedPosts = new Set();
      } else {
        followedPosts = new Set((follows || []).map((follow) => follow.post_id));
      }
      const { data: votes, error: votesError } = await client.from("community_reactions")
        .select("post_id,vote").eq("user_id", user.id).in("post_id", posts.map((post) => post.id));
      if (votesError) {
        status.textContent = "Your vote state could not be loaded. Refresh and retry before voting.";
        return false;
      }
      votesByPost = new Map((votes || []).map((vote) => [vote.post_id, vote.vote]));
    } else {
      followedPosts = new Set();
      votesByPost = new Map();
    }
    if (document.getElementById("feed-sort").value === "popular") {
      posts.sort((first, second) =>
        (((second.upvote_count || 0) - (second.downvote_count || 0)) + (second.community_comments?.[0]?.count || 0)) -
        (((first.upvote_count || 0) - (first.downvote_count || 0)) + (first.community_comments?.[0]?.count || 0))
      );
    }
    feed.replaceChildren();
    if (!posts.length) {
      const empty = document.createElement("p");
      empty.className = "community-empty";
      empty.textContent = "No discussions match these filters yet. Sign in to start a civic-focused conversation.";
      feed.append(empty);
    } else {
      posts.forEach((post) => feed.append(renderPost(post)));
    }
    document.getElementById("community-feed-subtitle").textContent =
      `${posts.length} recent civic discussions · ${locality || city || "all cities"}`;
    status.textContent = requestedPostUnavailable
      ? "That Community post is no longer public or is unavailable."
      : "";
    if (requestedPostId && !requestedPostUnavailable) {
      window.requestAnimationFrame(() => {
        document.getElementById(`community-post-${requestedPostId}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    }
    return true;
  }

  function scheduleFeedReload() {
    window.clearTimeout(feedTimer);
    feedTimer = window.setTimeout(loadFeed, 200);
  }

  async function loadProfile() {
    if (!user) {
      profile = null;
      updateAuthView();
      await loadNotifications();
      document.getElementById("moderation-panel").hidden = true;
      return;
    }
    const { data, error } = await client.from("community_profiles")
      .select("user_id,display_name,city,locality")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      status.textContent = "Your profile could not be loaded. Apply the community database migration and retry.";
      return;
    }
    profile = data;
    if (profile) {
      document.getElementById("profile-display-name").value = profile.display_name;
      document.getElementById("profile-city").value = profile.city;
      document.getElementById("profile-locality").value = profile.locality;
    }
    updateAuthView();
    await loadNotifications();
    await checkModerator();
  }

  async function saveProfile() {
    const nextProfile = {
      user_id: user.id,
      display_name: document.getElementById("profile-display-name").value.trim(),
      city: document.getElementById("profile-city").value.trim(),
      locality: document.getElementById("profile-locality").value.trim(),
      updated_at: new Date().toISOString()
    };
    const { data, error } = await client.from("community_profiles")
      .upsert(nextProfile, { onConflict: "user_id" })
      .select("user_id,display_name,city,locality")
      .single();
    if (error) throw new Error("The public profile could not be saved.");
    profile = data;
    document.getElementById("feed-city").value = profile.city;
    document.getElementById("feed-locality").value = profile.locality;
    updateAuthView();
  }

  async function toggleVote(postId, nextVote) {
    if (!user) {
      setFormMessage("Please sign in or sign up to like or dislike Community posts.", false);
      return openAuthDialog();
    }
    const change = window.CivicXCommunityVotes.mutation(votesByPost.get(postId) ?? null, nextVote);
    if (change.operation === "none") return;
    const result = change.operation === "delete"
      ? await client.from("community_reactions").delete().eq("post_id", postId).eq("user_id", user.id)
      : await client.from("community_reactions").upsert({
        post_id: postId,
        user_id: user.id,
        vote: change.vote
      }, { onConflict: "post_id,user_id" });
    if (result.error) setFormMessage("Your vote could not be saved. Check your sign-in and database migration.", true);
    else {
      setFormMessage(change.operation === "delete" ? "Your vote was removed." : "Your vote was saved.", false);
      await loadFeed();
    }
  }

  async function toggleFollow(postId) {
    if (!user) return openAuthDialog();
    const { data: existing, error: readError } = await client.from("community_follows")
      .select("post_id").eq("post_id", postId).eq("user_id", user.id).maybeSingle();
    if (readError) return setFormMessage("Follow status could not be updated.", true);
    const result = existing
      ? await client.from("community_follows").delete().eq("post_id", postId).eq("user_id", user.id)
      : await client.from("community_follows").insert({ post_id: postId, user_id: user.id });
    if (result.error) setFormMessage("Follow status could not be updated.", true);
    else {
      setFormMessage(existing ? "You unfollowed this discussion." : "You are following this discussion.", false);
      if (existing) followedPosts.delete(postId);
      else followedPosts.add(postId);
      await loadFeed();
    }
  }

  async function loadComments(postId, article) {
    const container = article.querySelector(`[data-comments-for="${postId}"]`);
    container.replaceChildren();
    const { data, error } = await client.from("community_comments")
      .select("id,post_id,parent_comment_id,author_id,body,created_at,community_profiles(display_name)")
      .eq("post_id", postId).eq("visibility", "published").order("created_at", { ascending: true });
    if (error) {
      const message = document.createElement("p");
      message.textContent = "Replies are temporarily unavailable.";
      container.append(message);
      return;
    }
    const commentsById = new Map();
    (data || []).forEach((comment) => {
      const item = document.createElement("div");
      item.className = "community-comment";
      item.dataset.commentId = comment.id;
      const heading = document.createElement("strong");
      heading.textContent = comment.community_profiles?.display_name || "CivicX neighbour";
      const text = document.createElement("p");
      text.textContent = comment.body;
      item.append(heading, text);
      if (user?.id === comment.author_id) {
        item.append(createButton("Edit reply", "community-action", async () => {
          const next = window.prompt("Edit your reply", comment.body);
          if (next === null || next.trim() === comment.body) return;
          const result = await client.from("community_comments").update({
            body: next.trim(), updated_at: new Date().toISOString()
          }).eq("id", comment.id).eq("author_id", user.id);
          if (result.error) setFormMessage("Reply could not be edited. Remove contact details or try again later.", true);
          else loadComments(postId, article);
        }));
        item.append(createButton("Delete reply", "community-action community-report-action", async () => {
          const result = await client.from("community_comments").delete().eq("id", comment.id).eq("author_id", user.id);
          if (result.error) setFormMessage("Reply could not be deleted.", true);
          else loadComments(postId, article);
        }));
      }
      if (user) item.append(createButton("Report reply", "community-action community-report-action", () => reportComment(comment.id)));
      if (user) item.append(createButton("Reply", "community-action", () => {
        if (item.querySelector(".community-reply-form")) return;
        item.append(createReplyForm(postId, article, comment.id));
      }));
      const parent = comment.parent_comment_id ? commentsById.get(comment.parent_comment_id) : null;
      (parent || container).append(item);
      commentsById.set(comment.id, item);
    });
    if (user) container.append(createReplyForm(postId, article, null));
  }

  function createReplyForm(postId, article, parentCommentId) {
    const replyForm = document.createElement("form");
    replyForm.className = "community-reply-form";
    const input = document.createElement("textarea");
    input.required = true;
    input.maxLength = 1500;
    input.rows = 2;
    input.placeholder = "Write a civic-focused reply";
    const button = document.createElement("button");
    button.className = "button button-secondary";
    button.textContent = "Reply";
    replyForm.append(input, button);
    replyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const reply = input.value.trim();
      if (reply.length < 1) return;
      const result = await client.from("community_comments").insert({
        post_id: postId, parent_comment_id: parentCommentId, author_id: user.id, body: reply
      });
      if (result.error) {
        setFormMessage("Reply was not saved. Remove contact details or try again later.", true);
        return;
      }
      await loadComments(postId, article);
      loadFeed();
    });
    return replyForm;
  }

  async function editPost(post) {
    const next = window.prompt("Edit your civic discussion", post.body);
    if (next === null || next.trim() === post.body) return;
    const { error } = await client.from("community_posts")
      .update({ body: next.trim(), updated_at: new Date().toISOString() })
      .eq("id", post.id).eq("author_id", user.id);
    if (error) setFormMessage("Post could not be edited. Check its length and remove personal contact details.", true);
    else loadFeed();
  }

  async function deletePost(postId) {
    if (!window.confirm("Delete this discussion and its replies?")) return;
    const { error } = await client.from("community_posts").delete().eq("id", postId).eq("author_id", user.id);
    if (error) setFormMessage("Post could not be deleted.", true);
    else loadFeed();
  }

  async function reportPost(postId) {
    if (!user) return openAuthDialog();
    const { error } = await client.from("community_reports").insert({
      reporter_id: user.id, post_id: postId, reason: "other"
    });
    setFormMessage(error ? "The report could not be sent." : "Thanks. The post was sent to the moderation queue.", Boolean(error));
  }

  async function reportComment(commentId) {
    if (!user) return openAuthDialog();
    const { error } = await client.from("community_reports").insert({
      reporter_id: user.id, comment_id: commentId, reason: "other"
    });
    setFormMessage(error ? "The report could not be sent." : "Thanks. The reply was sent to the moderation queue.", Boolean(error));
  }

  async function loadNotifications() {
    const panel = document.getElementById("community-notifications");
    panel.replaceChildren();
    if (!user) return;
    const { data, error } = await client.from("community_notifications")
      .select("id,kind,post_id,created_at,read_at")
      .eq("user_id", user.id).is("read_at", null).order("created_at", { ascending: false }).limit(10);
    if (error || !data?.length) return;
    const heading = document.createElement("strong");
    heading.textContent = `${data.length} new community notification${data.length === 1 ? "" : "s"}`;
    panel.append(heading);
    data.forEach((notification) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "community-notification";
      item.textContent = `${notification.kind === "reply" ? "New reply" : "Discussion update"} · ${localTimestamp(notification.created_at)}`;
      item.addEventListener("click", async () => {
        await client.from("community_notifications").update({ read_at: new Date().toISOString() }).eq("id", notification.id);
        if (notification.post_id) document.querySelector(`[data-post-id="${notification.post_id}"]`)?.scrollIntoView({ behavior: "smooth" });
        await loadNotifications();
      });
      panel.append(item);
    });
  }

  async function checkModerator() {
    document.getElementById("moderation-panel").hidden = true;
    if (!user) return;
    const { data } = await client.from("community_moderators").select("user_id").eq("user_id", user.id).maybeSingle();
    if (data) {
      document.getElementById("moderation-panel").hidden = false;
      loadModerationQueue();
    }
  }

  async function loadModerationQueue() {
    const container = document.getElementById("moderation-queue");
    const { data, error } = await client.from("community_reports")
      .select("id,post_id,comment_id,reason,details,created_at")
      .eq("status", "open").order("created_at", { ascending: true }).limit(50);
    container.replaceChildren();
    if (error) {
      container.textContent = "Moderation queue unavailable.";
      return;
    }
    (data || []).forEach((report) => {
      const row = document.createElement("article");
      row.className = "community-moderation-row";
      const summary = document.createElement("p");
      summary.textContent = `${report.reason} · ${report.details || "No details"} · ${report.post_id ? "Post" : "Reply"}`;
      const actioned = createButton("Hide content and close", "community-action community-report-action", async () => {
        const table = report.post_id ? "community_posts" : "community_comments";
        const column = report.post_id ? "post_id" : "comment_id";
        await client.from(table).update({ visibility: "hidden" }).eq("id", report[column]);
        const result = await client.from("community_reports").update({ status: "actioned" }).eq("id", report.id);
        if (result.error) setFormMessage("Moderation action could not be saved.", true);
        loadModerationQueue();
        loadFeed();
      });
      const dismiss = createButton("Dismiss", "community-action", async () => {
        await client.from("community_reports").update({ status: "dismissed" }).eq("id", report.id);
        loadModerationQueue();
      });
      row.append(summary, actioned, dismiss);
      container.append(row);
    });
    if (!data?.length) container.textContent = "No open reports.";
  }

  function openAuthDialog() {
    window.CivicXAuth.open("login").catch((error) => {
      console.error("[CivicX community] Sign-in could not be opened", error);
      setFormMessage("Sign-in is unavailable. Check the CivicX authentication setup and retry.", true);
    });
  }

  async function syncNotificationChannel() {
    const nextUserId = user?.id || null;
    if (notificationUserId === nextUserId) return;
    notificationUserId = nextUserId;
    if (notificationChannel) {
      const result = await client.removeChannel(notificationChannel);
      notificationChannel = null;
      if (result !== "ok") status.textContent = "Live notifications could not reconnect.";
    }
    await loadNotifications();
    if (nextUserId) {
      notificationChannel = client.channel(`civicx-notifications-${nextUserId}`)
        .on("postgres_changes", {
          event: "INSERT", schema: "public", table: "community_notifications",
          filter: `user_id=eq.${nextUserId}`
        }, loadNotifications)
        .subscribe();
    }
  }

  submitButton.addEventListener("click", (event) => {
    if (!user) {
      event.preventDefault();
      openAuthDialog();
    }
  });
  document.getElementById("community-post-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!user) return openAuthDialog();
    const category = document.getElementById("post-category").value;
    const body = document.getElementById("post-body").value.trim();
    const city = document.getElementById("profile-city").value.trim();
    const locality = document.getElementById("profile-locality").value.trim();
    const displayName = document.getElementById("profile-display-name").value.trim();
    const file = document.getElementById("post-image").files[0];
    const reportId = document.getElementById("post-report-id").value.trim();
    const validationMessage = window.CivicXCommunityPosts.validatePost({
      category,
      body,
      city,
      locality,
      displayName,
      file,
      linkedReportId: reportId
    });
    if (validationMessage) {
      setFormMessage(validationMessage, true);
      return;
    }
    submitButton.disabled = true;
    try {
      await saveProfile();
      const imagePath = await window.CivicXCommunityPosts.uploadImage(client, user, file);
      await window.CivicXCommunityPosts.create(client, {
        author_id: user.id,
        category,
        city,
        locality,
        body,
        image_path: imagePath,
        linked_report_id: reportId || null
      });
      event.target.reset();
      document.getElementById("profile-display-name").value = profile.display_name;
      document.getElementById("profile-city").value = profile.city;
      document.getElementById("profile-locality").value = profile.locality;
      setFormMessage("Discussion posted.", false);
      await loadFeed();
    } catch (error) {
      setFormMessage(error.message || "Discussion could not be posted.", true);
    } finally {
      submitButton.disabled = false;
      updateAuthView();
    }
  });
  ["feed-city", "feed-locality", "feed-search", "feed-category", "feed-sort"].forEach((id) => {
    document.getElementById(id).addEventListener(id === "feed-search" ? "input" : "change", scheduleFeedReload);
  });

  async function initialize() {
    try {
      try {
        const savedCity = JSON.parse(localStorage.getItem("civicx-selected-city-v1") || "null");
        if (savedCity?.name) {
          const cityName = savedCity.name.split(",")[0].trim();
          const profileCityInput = document.getElementById("profile-city");
          if (profileCityInput && !profileCityInput.value) profileCityInput.value = cityName;
        }
      } catch {}

      const auth = await window.CivicXAuth.ready;
      if (!auth.configured || !window.CivicXAuth.client) {
        status.textContent = "Community is not connected yet. Configure Supabase URL/key and apply the community migration to enable persistent discussions.";
        updateAuthView();
        return;
      }
      client = window.CivicXAuth.client;
      client.auth.onAuthStateChange((_event, session) => {
        user = session?.user || null;
        updateAuthView();
        window.setTimeout(async () => {
          await loadProfile();
          await syncNotificationChannel();
          await loadFeed();
        }, 0);
      });
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      user = data.session?.user || null;
      await loadProfile();
      await syncNotificationChannel();
      const feedLoaded = await loadFeed();
      if (!feedLoaded) return;
      realtimeChannel = client.channel("civicx-community-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "community_posts" }, scheduleFeedReload)
        .on("postgres_changes", { event: "*", schema: "public", table: "community_comments" }, scheduleFeedReload)
        .subscribe();
      status.textContent = "Connected · neighbourhood discussions are live.";
    } catch (error) {
      status.textContent = "Community could not connect. Check Supabase configuration, auth providers and migration status.";
    }
  }

  window.addEventListener("beforeunload", () => {
    if (client && realtimeChannel) client.removeChannel(realtimeChannel);
    if (client && notificationChannel) client.removeChannel(notificationChannel);
  });
  initialize();
})();
