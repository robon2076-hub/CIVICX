function createEmailChannel({ send, logDelivery, authorityEmails = [] } = {}) {
  return {
    async file(report, { consent, recipient } = {}) {
      if (consent !== true) throw new Error("Citizen consent is required before sending.");
      if (!recipient || typeof recipient !== "string") throw new Error("No verified authority email is configured.");
      if (!authorityEmails.includes(recipient)) throw new Error("The recipient is not in the verified authority registry.");
      if (typeof send !== "function") throw new Error("Email delivery is not configured.");
      await send({ report, recipient });
      if (typeof logDelivery === "function") {
        await logDelivery({
          reportId: report.id,
          recipient,
          sentAt: new Date().toISOString(),
          payloadType: "civic-issue-report",
          outcome: "sent"
        });
      }
      return { status: "Sent to authority (email)" };
    },
    async checkStatus() {
      return {
        mode: "unavailable",
        message: "Email delivery receipts do not provide an official complaint status."
      };
    }
  };
}

module.exports = { createEmailChannel };
