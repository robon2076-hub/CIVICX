const { assertPortalAdapter } = require("./interface");

module.exports = assertPortalAdapter({
  async file() {
    return {
      mode: "unavailable",
      message: "Automatic CPGRAMS filing is not implemented. Use the assisted portal flow."
    };
  },
  async checkStatus() {
    return {
      mode: "unavailable",
      message: "Automatic status checks are not implemented. Use the official status page."
    };
  }
});
