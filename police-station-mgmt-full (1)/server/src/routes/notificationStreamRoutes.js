const express = require("express");
const jwt = require("jsonwebtoken");
const { subscribe, unsubscribe } = require("../utils/sseHub");

const router = express.Router();

// GET /api/notifications/stream?token=<jwt> — the live-push half of the
// notification bell (NotificationBell.jsx). Deliberately NOT behind
// verifyToken: the browser's EventSource API cannot set an Authorization
// header, so the token travels as a query param on this one endpoint
// only — every other route in this app still requires the header.
router.get("/stream", (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).end();

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).end();
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // don't let a reverse proxy (e.g. nginx) buffer this away from being "live"
  });
  res.write("\n");

  subscribe(decoded.uid, res);

  // Keeps the connection alive through idle proxies/load balancers that
  // would otherwise time it out — a ":"-prefixed line is a comment per
  // the SSE spec, invisible to EventSource's onmessage.
  const heartbeat = setInterval(() => res.write(":\n\n"), 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe(decoded.uid, res);
  });
});

module.exports = router;
