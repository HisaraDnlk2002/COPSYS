const mongoose = require("mongoose");

// Called once at server startup (see index.js) and again by seed.js.
// mongoose.connect resolves once the initial connection succeeds, then
// keeps the connection pooled/open for the lifetime of the process.
async function connectDB() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      throw new Error("MONGO_URI is not set — check your .env file");
    }

    await mongoose.connect(uri);
    console.log(`MongoDB connected -> ${mongoose.connection.name}`);
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    // Fail loudly and exit rather than let the server run against no DB.
    process.exit(1);
  }
}

module.exports = { connectDB };
