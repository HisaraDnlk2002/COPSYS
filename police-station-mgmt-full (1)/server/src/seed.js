// Run this ONCE to create starter accounts for every role, since the
// normal "create user" route requires you to already be logged in as
// an admin — chicken-and-egg problem for the very first accounts.
//
// Usage:  node src/seed.js
//
// Safe to re-run — skips any account whose rankAndNumber already exists.

require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { connectDB } = require("./config/db");
const User = require("./models/User");
const LeaveBalance = require("./models/LeaveBalance");
const SystemSettings = require("./models/SystemSettings");

// One account per role so every screen/permission is testable right away.
const STARTER_ACCOUNTS = [
  { fullName: "Sgt. Bandara", rankAndNumber: "77412", department: "Administration", role: "admin", password: "admin123", phoneNumber: "0771234567", address: "Police Headquarters, Colombo" },
  { fullName: "Insp. Wijesinghe", rankAndNumber: "88214", department: "Command", role: "oic", password: "oic123", phoneNumber: "0772345678", address: "Police Headquarters, Colombo" },
  { fullName: "PC Perera", rankAndNumber: "91022", department: "Traffic Control", role: "duty_officer", password: "duty123", phoneNumber: "0773456789", address: "Police Headquarters, Colombo" },
  { fullName: "WPC Silva", rankAndNumber: "73310", department: "Stores", role: "inventory_officer", password: "inv123", phoneNumber: "0774567890", address: "Police Headquarters, Colombo" },
  { fullName: "PC Nishadi", rankAndNumber: "65521", department: "Crime", role: "officer", password: "officer123", phoneNumber: "0775678901", address: "Police Headquarters, Colombo" },
];
async function seed() {
  await connectDB();

  for (const account of STARTER_ACCOUNTS) {
    const existing = await User.findOne({ rankAndNumber: account.rankAndNumber });
    if (existing) {
      console.log(`Skipping ${account.rankAndNumber} (${account.role}) — already exists`);
      continue;
    }
const passwordHash = await bcrypt.hash(account.password, 10);
    const user = await User.create({
      fullName: account.fullName,
      rankAndNumber: account.rankAndNumber,
      department: account.department,
      role: account.role,
      phoneNumber: account.phoneNumber,
      address: account.address,
      passwordHash,
      status: "active",
    });
    await LeaveBalance.create({ officerId: user._id });
    console.log(`Created ${account.role}: username=${account.rankAndNumber} password=${account.password}`);
  }

  // Make sure a default settings doc exists so the OIC Settings screen
  // isn't empty on first load.
  const existingSettings = await SystemSettings.findOne({ stationId: "default-station" });
  if (!existingSettings) {
    await SystemSettings.create({ stationId: "default-station" });
    console.log("Created default SystemSettings doc");
  }

  console.log("\nDone. CHANGE THESE PASSWORDS after first login — there's no");
  console.log("change-password screen yet, so for now that means editing the");
  console.log("database directly. Tracked as a TODO in server/README.md.");

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
