(() => {
  const pageLinks = [
    ["Home", "/index.html"],
    ["Dashboard", "/dashboard.html"],
    ["Community", "/community.html"],
    ["Tutorial", "/index.html#tutorial"],
    ["Contact", "/index.html#contact"]
  ];
  const pathname = window.location.pathname.replace(/\/$/, "") || "/index.html";
  const currentPage = pathname === "/" ? "/index.html" : pathname;

  function makeSiteNav() {
    const menu = document.createElement("details");
    menu.className = "site-nav-menu";
    const mobileNav = window.matchMedia("(max-width: 900px)");
    menu.open = !mobileNav.matches;
    const syncMenu = (event) => { menu.open = !event.matches; };
    if (mobileNav.addEventListener) mobileNav.addEventListener("change", syncMenu);
    else mobileNav.addListener(syncMenu);
    const summary = document.createElement("summary");
    summary.textContent = "Menu";
    summary.setAttribute("aria-label", "Open site navigation");
    const links = document.createElement("div");
    links.className = "site-nav-links";
    links.setAttribute("role", "navigation");
    links.setAttribute("aria-label", "Site navigation");
    pageLinks.forEach(([label, href]) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      if (href.split("#")[0] === currentPage && (href.indexOf("#") === -1 || window.location.hash === href.slice(href.indexOf("#")))) {
        link.setAttribute("aria-current", "page");
      }
      link.addEventListener("click", () => {
        if (mobileNav.matches) menu.open = false;
      });
      links.append(link);
    });
    menu.append(summary, links);
    return menu;
  }

  document.querySelectorAll(".cx-home-nav, .app-header, .environment-topbar, .track-header, .sponsor-admin-header").forEach((header) => {
    header.classList.add("nav");
    const oldNav = header.querySelector(".app-nav, .cx-home-nav-links");
    const sharedNav = makeSiteNav();
    if (oldNav) oldNav.replaceWith(sharedNav);
    else {
      const brand = header.querySelector(".cx-brand, .brand, .cx-home-logo");
      if (brand && brand.parentElement === header) brand.after(sharedNav);
      else header.prepend(sharedNav);
    }
  });

  document.querySelectorAll("main").forEach((main) => main.classList.add("page"));
  document.querySelectorAll("main section").forEach((section) => section.classList.add("section"));
  document.querySelectorAll(".cx-contact-view").forEach((page) => page.classList.add("page--bright"));
  document.querySelectorAll(".cx-home-hero").forEach((hero) => hero.classList.add("hero"));
  document.querySelectorAll(".cx-contact-grid").forEach((grid) => grid.classList.add("two-col"));
  document.querySelectorAll("[data-civicx-auth-trigger]").forEach((button) => {
    const mode = button.dataset.civicxAuthMode;
    if (mode === "login" || mode === "signup") button.dataset.auth = mode;
  });
  document.querySelectorAll(".civicx-auth-dialog [data-auth-mode]").forEach((button) => {
    button.dataset.auth = button.dataset.authMode;
  });
  document.querySelectorAll(".hero__bg").forEach((background) => {
    if (background.querySelector(".city")) return;
    const city = document.createElement("div");
    city.className = "city";
    city.id = "cx-home-city";
    city.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 22; index += 1) {
      const building = document.createElement("b");
      building.style.height = `${30 + Math.random() * 70}%`;
      building.style.animationDelay = `${-Math.random() * 4}s`;
      city.append(building);
    }
    background.append(city);
  });
  document.querySelectorAll(".dashboard-welcome, .ai-locked-card").forEach((hero) => {
    hero.classList.add("hero", "hero--short");
  });
  if (pathname === "/authority.html") {
    const title = document.querySelector(".portal-welcome .page-overline");
    if (title) {
      const authorityBadge = document.createElement("span");
      authorityBadge.className = "badge badge--authority";
      authorityBadge.textContent = "Municipal authorities only";
      title.append(" ", authorityBadge);
    }
  }
  document.querySelectorAll(".environment-shell, .sponsor-admin-content, .track-card").forEach((shell) => {
    const eyebrow = shell.querySelector(":scope > .eyebrow, :scope > .page-overline");
    const title = shell.querySelector(":scope > h1");
    const intro = shell.querySelector(":scope > .environment-intro, :scope > .sponsor-admin-intro, :scope > p:not(.eyebrow)");
    if (!eyebrow || !title || !intro) return;
    const hero = document.createElement("header");
    hero.className = "hero hero--short";
    shell.insertBefore(hero, eyebrow);
    hero.append(eyebrow, title, intro);
  });
  document.querySelectorAll(".civicx-auth-dialog").forEach((dialog) => {
    if (dialog.querySelector(":scope > .modal")) return;
    const media = dialog.querySelector(".civicx-auth-visual");
    const content = dialog.querySelector(".civicx-auth-content");
    const close = dialog.querySelector(".community-dialog-close");
    if (!media || !content) return;

    const firstTrack = media.querySelector(".civicx-auth-moving-track");
    const scenes = firstTrack ? [...firstTrack.querySelectorAll(".civicx-auth-scene")] : [];
    const visualCopy = media.querySelector(".civicx-auth-visual-copy")?.cloneNode(true);
    media.className = "modal__media";
    media.replaceChildren();
    const columns = document.createElement("div");
    columns.className = "civicx-auth-moving-column";
    const split = Math.ceil(scenes.length / 2);
    [scenes.slice(0, split), scenes.slice(split)].forEach((group, index) => {
      if (!group.length) return;
      const track = document.createElement("div");
      track.className = `civicx-auth-moving-track${index ? " is-reverse" : ""}`;
      [...group, ...group].forEach((scene) => track.append(scene.cloneNode(true)));
      columns.append(track);
    });
    media.append(columns);
    if (visualCopy) media.append(visualCopy);

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.append(media, content);
    if (close) modal.append(close);
    dialog.classList.add("modal-overlay");
    dialog.replaceChildren(modal);
  });
  document.querySelectorAll(".metric-card, .shortcut-card, .dashboard-map-card, .dashboard-summary, .report-item, .portal-key-panel, .portal-owner-settings, .portal-owner-reports, .portal-report, .environment-metric, .environment-panel, .environment-aqi-card, .community-intro-card, .community-compose, .community-post, .community-moderation, .track-card, .sponsor-admin-stat, .sponsor-admin-table-wrap, .landing-video-section, .landing-overview-card, .cx-tutorial-stage, .cx-tutorial-item, .cx-contact-card, .cx-contact-form, .cx-explore-card").forEach((card) => {
    card.classList.add("card");
    if (card.matches("a, button, .shortcut-card, .cx-explore-card")) card.classList.add("card--hover");
  });
  document.querySelectorAll(".cx-explore-grid, .landing-overview-grid, .metric-grid, .shortcut-grid, .environment-metrics").forEach((grid) => grid.classList.add("grid-auto"));
  document.querySelectorAll(".cx-explore-card").forEach((card, index) => {
    card.classList.add("card--scene", `scene-${index + 1}`);
  });
  document.querySelectorAll(".cx-contact-card").forEach((row) => {
    row.classList.add("row");
    row.querySelector(".cx-contact-card-icon")?.classList.add("row__icon");
  });
  document.querySelectorAll(".cx-contact-form, #report-form, .track-form, .portal-key-panel form, .portal-owner-settings form, .community-compose form").forEach((form) => form.classList.add("form-card"));
  document.querySelectorAll(".sponsor-admin-table-wrap").forEach((table) => table.classList.add("table-wrap"));
  document.querySelectorAll(".button, .action-dark, .action-light").forEach((button) => {
    button.classList.add("btn");
    if (button.classList.contains("button-primary") || button.classList.contains("action-dark")) button.classList.add("btn--primary");
    else if (button.classList.contains("button-secondary") || button.classList.contains("action-light")) button.classList.add("btn--outline");
  });
  document.querySelectorAll(".cx-home-hero .button-primary").forEach((button) => button.classList.add("btn--pulse"));
  const badgeSelector = ".report-status-pill, .data-source-tag, .live-pill, .live-indicator, .community-category";
  const applyBadgeStyle = (badge) => {
    if (!badge.classList.contains("badge")) badge.classList.add("badge");
    const variants = ["badge--ok", "badge--warn", "badge--bad", "badge--info"];
    if (badge.matches(".data-source-tag, .community-category")) {
      variants.forEach((current) => badge.classList.remove(current));
      return;
    }
    const label = `${badge.textContent} ${badge.className}`.toLowerCase();
    const variant = /resolved|active|live|approved|success/.test(label) ? "badge--ok"
      : /error|failed|rejected|denied|cannot/.test(label) ? "badge--bad"
      : /pending|review|submitted|assigned/.test(label) ? "badge--warn"
      : "badge--info";
    if (!badge.classList.contains(variant)) {
      variants.forEach((current) => badge.classList.remove(current));
      badge.classList.add(variant);
    }
  };
  document.querySelectorAll(badgeSelector).forEach(applyBadgeStyle);
  const badgeObserver = new MutationObserver((records) => {
    records.forEach((record) => {
      const changed = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      const badge = changed?.closest(badgeSelector);
      if (badge) applyBadgeStyle(badge);
      record.addedNodes?.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const addedBadge = node.matches(badgeSelector) ? node : node.querySelector(badgeSelector);
        if (addedBadge) applyBadgeStyle(addedBadge);
      });
    });
  });
  badgeObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  document.querySelectorAll("footer").forEach((footer) => {
    footer.classList.add("footer");
    const nav = document.createElement("nav");
    nav.className = "footer-links";
    nav.setAttribute("aria-label", "Footer navigation");
    pageLinks.forEach(([label, href]) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      nav.append(link);
    });
    footer.append(nav);
  });

  const assistantScript = document.createElement("script");
  assistantScript.src = "/assistant.js";
  assistantScript.async = true;
  assistantScript.addEventListener("error", () => {
    console.error("[CivicX assistant] Widget failed to load.");
  });
  document.body.append(assistantScript);

  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const targets = document.querySelectorAll(
    ".reveal:not([hidden]), main > section:not([hidden]), main article:not([hidden]), .environment-panel:not([hidden]), " +
    ".environment-metric:not([hidden]), .environment-aqi-card:not([hidden]), .community-post:not([hidden]), " +
    ".portal-report:not([hidden]), .sponsor-admin-table-wrap:not([hidden]), .track-card:not([hidden])"
  );
  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      currentObserver.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -24px 0px" });

  targets.forEach((target) => {
    target.classList.add("reveal");
    observer.observe(target);
  });
})();
