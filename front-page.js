(() => {
  const steps = [
    {
      icon: "📍",
      title: "Prepare a clear report",
      detail: "Draft a local issue report with useful context. Sign in if you want to save an account-linked report.",
      phoneTitle: "Prepare a report",
      phoneCopy: "Describe the issue and add its location.",
      action: "Open dashboard",
      href: "dashboard.html?guest=1",
      badge: "CIVICX"
    },
    {
      icon: "💬",
      title: "Join a community discussion",
      detail: "Share neighbourhood updates, discuss solutions, and vote on community posts. A discussion is not an official complaint.",
      phoneTitle: "Community",
      phoneCopy: "Talk with neighbours about local issues.",
      action: "Open community",
      href: "community.html",
      badge: "COMMUNITY"
    },
    {
      icon: "🧾",
      title: "Keep track of next steps",
      detail: "Save a reference and record what you learn. Check official status directly with the relevant government portal.",
      phoneTitle: "Follow up",
      phoneCopy: "CivicX records do not verify government status.",
      action: "View guidance",
      href: "track.html",
      badge: "FOLLOW UP"
    },
    {
      icon: "✧",
      title: "Get optional AI guidance",
      detail: "CivicX AI can help explain reporting steps or improve draft wording. It cannot file a complaint or confirm official status.",
      phoneTitle: "CivicX AI",
      phoneCopy: "Guidance for civic questions and report wording.",
      action: "Explore AI",
      href: "ai.html",
      badge: "GUIDANCE"
    }
  ];

  const get = (id) => document.getElementById(id);
  const list = get("cx-tutorial-list");
  const progress = get("cx-tutorial-progress");
  const toggle = get("cx-tutorial-toggle");
  const home = get("home");
  const contact = get("contact");
  const city = get("cx-home-city");
  const form = get("cx-contact-form");
  const status = get("cx-contact-status");
  let current = 0;
  let playing = true;
  let startedAt = performance.now();
  const duration = 6000;

  function showStep(index) {
    current = index;
    const step = steps[index];
    get("cx-tutorial-icon").textContent = step.icon;
    get("cx-tutorial-phone-title").textContent = step.phoneTitle;
    get("cx-tutorial-phone-copy").textContent = step.phoneCopy;
    get("cx-tutorial-phone-action").textContent = step.action;
    get("cx-tutorial-phone-action").href = step.href;
    get("cx-tutorial-badge").textContent = step.badge;
    get("cx-tutorial-step-title").textContent = step.title;
    get("cx-tutorial-step-copy").textContent = step.detail;
    document.querySelectorAll(".cx-tutorial-item").forEach((item, itemIndex) => {
      item.classList.toggle("is-active", itemIndex === index);
      item.setAttribute("aria-current", itemIndex === index ? "step" : "false");
    });
    progress.style.width = "0%";
    startedAt = performance.now();
  }

  steps.forEach((step, index) => {
    const button = document.createElement("button");
    button.className = "cx-tutorial-item";
    button.type = "button";
    button.setAttribute("aria-label", `Show tutorial step ${index + 1}: ${step.title}`);
    const icon = document.createElement("span");
    icon.className = "cx-tutorial-item-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = step.icon;
    const copy = document.createElement("span");
    copy.className = "cx-tutorial-item-copy";
    const title = document.createElement("strong");
    title.textContent = step.title;
    const detail = document.createElement("small");
    detail.textContent = step.detail;
    copy.append(title, detail);
    button.append(icon, copy);
    button.addEventListener("click", () => showStep(index));
    list.append(button);
  });

  function animate(now) {
    if (playing) {
      const elapsed = now - startedAt;
      if (elapsed >= duration) {
        showStep((current + 1) % steps.length);
      } else {
        progress.style.width = `${(elapsed / duration) * 100}%`;
      }
    }
    window.requestAnimationFrame(animate);
  }

  toggle.addEventListener("click", () => {
    playing = !playing;
    toggle.textContent = playing ? "❚❚" : "▶";
    toggle.setAttribute("aria-label", playing ? "Pause tutorial" : "Play tutorial");
    toggle.setAttribute("aria-pressed", String(playing));
    if (playing) startedAt = performance.now();
  });

  function routeContact() {
    const isContact = window.location.hash === "#contact";
    home.hidden = isContact;
    contact.hidden = !isContact;
    if (isContact) window.scrollTo(0, 0);
    else if (window.location.hash && window.location.hash.length > 1) {
      const target = document.getElementById(window.location.hash.slice(1));
      if (target) target.scrollIntoView({ behavior: "smooth" });
    }
  }
  window.addEventListener("hashchange", routeContact);
  routeContact();

  if (city) {
    for (let index = 0; index < 22; index += 1) {
      const building = document.createElement("span");
      building.style.height = `${30 + Math.random() * 70}%`;
      building.style.animationDelay = `${-Math.random() * 4}s`;
      city.append(building);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const subject = `CIVICX website message from ${String(data.get("name")).trim()}`;
    const body = [
      `Name: ${String(data.get("name")).trim()}`,
      `Email: ${String(data.get("email")).trim()}`,
      "",
      String(data.get("message")).trim()
    ].join("\n");
    const url = `mailto:rajshreechaitanya123@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    status.textContent = "Opening your email app. Review the message there and press Send to contact CIVICX.";
    window.location.href = url;
  });

  showStep(0);
  window.requestAnimationFrame(animate);

  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    document.querySelectorAll(".cx-reveal").forEach((element) => revealObserver.observe(element));
  } else {
    document.querySelectorAll(".cx-reveal").forEach((element) => element.classList.add("is-visible"));
  }
})();
