// Sends real email via Gmail SMTP (nodemailer's "gmail" service shorthand).
// Requires GMAIL_USER + GMAIL_APP_PASSWORD in server/.env — a Gmail
// account with 2-Step Verification on, and an App Password generated at
// myaccount.google.com/apppasswords (a regular Gmail password is
// rejected by Google over SMTP). Neither is committed to the repo
// (.env is gitignored) — fill them in locally.

const nodemailer = require("nodemailer");

let transporter = null;

function isMailerConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

// Built lazily (not at module load) so a server boot without mail
// credentials set yet doesn't crash — it only fails when something
// actually tries to send, with a clear error instead of a silent no-op.
function getTransporter() {
  if (!isMailerConfigured()) {
    throw new Error(
      "Email is not configured on this server. Set GMAIL_USER and GMAIL_APP_PASSWORD in server/.env."
    );
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

// to/subject/text required; html optional (falls back to the plain-text
// body). Throws on failure — callers decide how to surface that (e.g.
// passwordResetRequestsController leaves the request "pending" rather
// than "fulfilled" if the send fails, so Admin can retry).
async function sendMail({ to, subject, text, html }) {
  const fromName = process.env.GMAIL_FROM_NAME || "COPSYS — Police Station Management";
  await getTransporter().sendMail({
    from: `"${fromName}" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text,
    html: html || `<p>${text.replace(/\n/g, "<br>")}</p>`,
  });
}

module.exports = { sendMail, isMailerConfigured };
