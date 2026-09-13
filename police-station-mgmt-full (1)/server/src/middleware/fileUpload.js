const multer = require("multer");
const path = require("path");
const fs = require("fs");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

// Shared multer factory for every file-upload feature in this app
// (complaint case-note attachments, leave-request doctor's notes, any
// future one) — same local-disk storage strategy, allowed types and
// size limits everywhere; only the subfolder and form field name differ
// per caller. Local disk under server/uploads/<subfolder> (gitignored)
// since this project has no cloud storage configured anywhere.
function createUploader(subfolder) {
  const uploadDir = path.join(__dirname, "..", "..", "uploads", subfolder);
  fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    // Never trust the original filename for the on-disk name — sidesteps
    // path traversal and collisions entirely. The real name is preserved
    // separately as `originalName` on the attachment subdocument.
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname).toLowerCase()}`);
    },
  });

  function fileFilter(req, file, cb) {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) return cb(null, true);
    cb(new Error("Unsupported file type — only JPG, PNG, WEBP, HEIC and PDF are allowed"));
  }

  const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024, files: 5 }, // 10MB/file, 5 files/request
  });

  // multer's own errors (bad type, too large, too many files) are
  // thrown from inside its own middleware, before any controller's
  // try/catch can see them — without this wrapper they'd fall through
  // to Express's default HTML error page instead of the JSON error body
  // every other endpoint in this app returns.
  function middleware(fieldName, maxCount = 5) {
    return function (req, res, next) {
      upload.array(fieldName, maxCount)(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || "Upload failed" });
        next();
      });
    };
  }

  return { uploadDir, middleware };
}

module.exports = { createUploader };
