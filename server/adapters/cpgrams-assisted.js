const { assertPortalAdapter } = require("./interface");

const adapter = assertPortalAdapter({
  async file(report) {
    return {
      mode: "assisted",
      status: report.registrationNumber ? "Filed" : "Prepared (awaiting user filing)",
      officialUrl: "https://pgportal.gov.in/Home/LodgeGrievance",
      message: "The citizen must sign in, complete OTP/CAPTCHA, review the form, and submit it on CPGRAMS."
    };
  },
  async checkStatus(registrationNumber) {
    return {
      mode: "manual",
      officialUrl: "https://pgportal.gov.in/Status",
      registrationNumber,
      message: "Complete any official verification on CPGRAMS, then enter the observed result in CivicX."
    };
  }
});

module.exports = adapter;
