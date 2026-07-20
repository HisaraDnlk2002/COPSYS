// One-off script to reset Sgt. Bandara's (77412) password back to a known
// value after a login lockout. Safe to delete after running once.
//
// Usage:  node reset-admin-password.js

require("dotenv").config();

// See src/index.js for why — some mobile-hotspot networks hijack the
// default DNS path for the Atlas hostnames even with 8.8.8.8 configured
// system-wide, so this forces Node's own resolver to use it directly.
require("dns").setServers(["8.8.8.8", "8.8.4.4"]);

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./src/models/User");

const USER_ID = "6a51c9bf139986d3e1ff446f";
const NEW_PASSWORD = "admin123";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const passwordHash = await bcrypt.hash(NEW_PASSWORD, 10);
  const updated = await User.findByIdAndUpdate(USER_ID, { passwordHash }, { new: true });
  if (!updated) {
    console.log("No user found with that id.");
  } else {
    console.log(`Password reset for ${updated.fullName} (${updated.rankAndNumber}).`);
    const verified = await bcrypt.compare(NEW_PASSWORD, updated.passwordHash);
    console.log("Verified new password matches:", verified);
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Reset failed:", err.message);
  process.exit(1);
});
