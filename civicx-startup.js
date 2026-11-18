(function (root, factory) {
  const startup = factory();
  if (typeof module === "object" && module.exports) module.exports = startup;
  else root.CivicXStartup = startup;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const RETRYABLE_STATUSES = new Set([404, 408, 429, 500, 502, 503, 504]);
  const RETRY_DELAYS = [700, 1400];

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function fetchWithRetry(fetcher, input, init = {}, options = {}) {
    if (typeof fetcher !== "function") throw new TypeError("A fetch function is required.");
    const wait = options.delay || delay;
    const attempts = options.attempts || RETRY_DELAYS.length + 1;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetcher(input, init);
        if (!RETRYABLE_STATUSES.has(response.status) || attempt === attempts) return response;
        lastError = new Error(`Request returned HTTP ${response.status}.`);
        lastError.status = response.status;
      } catch (error) {
        lastError = error;
        if (attempt === attempts || !(error instanceof TypeError || error.name === "AbortError")) {
          throw error;
        }
      }

      options.onRetry?.(attempt, lastError);
      await wait(RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)]);
    }

    throw lastError;
  }

  return Object.freeze({ fetchWithRetry });
});
