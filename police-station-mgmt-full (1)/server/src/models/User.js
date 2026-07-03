const mongoose = require("mongoose");

const ROLES = ["admin", "oic", "duty_officer", "inventory_officer", "officer"];

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },

    // Doubles as the login username — authController.js looks users up
    // by this field, not by email.
    rankAndNumber: { type: String, required: true, unique: true, trim: true },

    department: { type: String, default: "" },

    role: { type: String, enum: ROLES, required: true },

    status: {
      type: String,
      enum: ["active", "disabled", "pending"],
      default: "active",
    },

    passwordHash: { type: String, required: true },

    stationId: { type: String, default: "default-station" },
  },
  { timestamps: true }
);

// Never let the password hash leak into an API response. authController.js
// calls user.toJSON() directly when returning the logged-in user.
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
module.exports.ROLES = ROLES;
