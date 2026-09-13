// In-memory per-user Server-Sent-Events registry. This server runs as a
// single Node process (no separate socket/pubsub service, no multiple
// instances behind a load balancer), so a plain Map is enough — no Redis
// or similar needed. Each entry is a Set of open `res` streams for that
// user, since the same officer could have more than one tab/device open.
//
// SSE rather than WebSocket: every actual mutation in this app already
// goes through ordinary REST endpoints — the client never needs to send
// data back over this channel, only receive a "something changed, go
// refetch" nudge. That's a strictly one-directional need, which SSE
// covers with a plain HTTP connection (simpler than a WS upgrade, and
// friendlier to whatever's already proxying this app).
const subscribersByUser = new Map();

function subscribe(userId, res) {
  const key = String(userId);
  if (!subscribersByUser.has(key)) subscribersByUser.set(key, new Set());
  subscribersByUser.get(key).add(res);
}

function unsubscribe(userId, res) {
  const key = String(userId);
  const set = subscribersByUser.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) subscribersByUser.delete(key);
}

// Pushes one SSE event to every open stream for this user. A silent
// no-op if they have no tab open right now — this is purely a "reach
// them immediately while they're already online" layer on top of the
// normal on-open/on-load fetch (NotificationBell.jsx), never the only
// way an alert reaches them.
function sendToUser(userId, payload) {
  if (!userId) return;
  const key = String(userId);
  const set = subscribersByUser.get(key);
  if (!set || set.size === 0) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    res.write(data);
  }
}

module.exports = { subscribe, unsubscribe, sendToUser };
