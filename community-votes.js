(function (root, factory) {
  const votes = factory();
  if (typeof module === "object" && module.exports) module.exports = votes;
  else root.CivicXCommunityVotes = votes;
})(typeof globalThis === "object" ? globalThis : this, function () {
  function mutation(currentVote, nextVote) {
    if (![null, undefined, -1, 1].includes(currentVote) || ![-1, 0, 1].includes(nextVote)) {
      throw new TypeError("Community votes must be -1, 0, or 1.");
    }
    if ((currentVote || 0) === nextVote) return { operation: "none" };
    if (nextVote === 0) return { operation: "delete" };
    return { operation: "upsert", vote: nextVote };
  }

  return Object.freeze({ mutation });
});
