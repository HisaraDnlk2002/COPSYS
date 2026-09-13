const { createUploader } = require("./fileUpload");

const { uploadDir, middleware } = createUploader("complaints");

module.exports = {
  uploadAttachments: middleware("attachments", 5),
  UPLOAD_DIR: uploadDir,
};
