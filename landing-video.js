(() => {
  const playlist = window.CivicXLandingVideoConfig;
  const video = document.getElementById("landing-video");
  if (!Array.isArray(playlist) || playlist.length !== 2 || !video) return;

  const elements = {
    placeholder: document.getElementById("landing-video-placeholder"),
    stageTag: document.getElementById("video-stage-tag"),
    number: document.getElementById("video-number"),
    title: document.getElementById("video-title"),
    description: document.getElementById("video-description"),
    status: document.getElementById("video-status"),
    mute: document.getElementById("video-mute"),
    next: document.getElementById("video-next"),
    progress: document.getElementById("video-progress"),
    time: document.getElementById("video-time")
  };
  let activeIndex = 0;
  let previewTimer = 0;
  let previewElapsed = 0;
  let previewStartedAt = 0;
  let playing = false;
  let resumeAfterVisibility = false;

  function formatTime(seconds) {
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
  }

  function activeClip() {
    return playlist[activeIndex];
  }

  function shownDuration() {
    return activeClip().durationSeconds;
  }

  function updateProgress(seconds) {
    const duration = shownDuration();
    const clamped = Math.min(duration, Math.max(0, seconds));
    elements.progress.max = String(duration);
    elements.progress.value = String(clamped);
    elements.time.textContent = `${formatTime(clamped)} / ${formatTime(duration)}`;
  }

  function stopPreviewTimer() {
    if (previewTimer) window.clearInterval(previewTimer);
    previewTimer = 0;
  }

  function stopPlayback() {
    playing = false;
    stopPreviewTimer();
    video.pause();
  }

  function advance(autoplay) {
    activeIndex = (activeIndex + 1) % playlist.length;
    loadClip(autoplay);
  }

  function play() {
    if (playing) return;
    playing = true;
    if (activeClip().src) {
      video.play().catch((error) => {
        stopPlayback();
        elements.status.textContent = `Playback could not start: ${error.message || "check the video source and try again."}`;
      });
      return;
    }

    previewStartedAt = Date.now();
    previewTimer = window.setInterval(() => {
      previewElapsed += (Date.now() - previewStartedAt) / 1000;
      previewStartedAt = Date.now();
      if (previewElapsed >= shownDuration()) {
        stopPreviewTimer();
        previewElapsed = 0;
        advance(true);
        return;
      }
      updateProgress(previewElapsed);
    }, 250);
  }

  function loadClip(autoplay) {
    stopPlayback();
    previewElapsed = 0;
    const clip = activeClip();
    elements.number.textContent = String(activeIndex + 1).padStart(2, "0");
    elements.title.textContent = clip.title;
    elements.description.textContent = clip.description;
    elements.stageTag.textContent = `VIDEO ${activeIndex + 1} OF ${playlist.length}`;
    elements.placeholder.hidden = Boolean(clip.src);
    video.hidden = !clip.src;
    video.onended = () => advance(true);
    video.ontimeupdate = () => {
      updateProgress(video.currentTime);
      if (video.currentTime >= clip.durationSeconds) advance(true);
    };
    video.onerror = () => {
      if (!clip.src) return;
      stopPlayback();
      video.hidden = true;
      elements.placeholder.hidden = false;
      elements.status.textContent = "The video source could not be loaded. Update video-config.js and try again.";
    };
    if (clip.src) {
      video.src = clip.src;
      video.load();
      elements.status.textContent = "CIVICX video";
      elements.placeholder.hidden = true;
      video.hidden = false;
    } else {
      video.removeAttribute("src");
      video.load();
      elements.status.textContent = "";
      elements.placeholder.hidden = false;
      video.hidden = true;
    }
    updateProgress(0);
    if (autoplay) play();
  }

  elements.next.addEventListener("click", () => advance(playing));
  elements.mute.addEventListener("click", () => {
    video.muted = !video.muted;
    elements.mute.textContent = video.muted ? "◖̸" : "◖";
    elements.mute.setAttribute("aria-label", video.muted ? "Unmute video" : "Mute video");
    elements.mute.setAttribute("aria-pressed", String(video.muted));
  });
  elements.progress.addEventListener("input", () => {
    const value = Number(elements.progress.value);
    if (activeClip().src) video.currentTime = value;
    else {
      previewElapsed = value;
      previewStartedAt = Date.now();
    }
    updateProgress(value);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && playing) {
      resumeAfterVisibility = true;
      if (!activeClip().src) {
        previewElapsed += (Date.now() - previewStartedAt) / 1000;
        stopPreviewTimer();
        updateProgress(previewElapsed);
      } else {
        video.pause();
      }
      playing = false;
    } else if (!document.hidden && resumeAfterVisibility) {
      resumeAfterVisibility = false;
      play();
    }
  });

  video.muted = true;
  elements.mute.textContent = "◖̸";
  elements.mute.setAttribute("aria-label", "Unmute video");
  elements.mute.setAttribute("aria-pressed", "true");
  loadClip(true);
})();
