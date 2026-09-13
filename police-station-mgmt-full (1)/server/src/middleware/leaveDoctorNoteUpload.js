const { createUploader } = require("./fileUpload");

const { uploadDir, middleware } = createUploader("leave-requests");

module.exports = {
  uploadDoctorNote: middleware("doctorNote", 5),
  UPLOAD_DIR: uploadDir,
};
