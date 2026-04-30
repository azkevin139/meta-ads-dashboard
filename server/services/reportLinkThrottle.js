// Per-IP throttle for invalid report-token resolution attempts.
// Protects the DB from token enumeration and gives a fast 429 path.
const WINDOW_MS = 60 * 1000;
const THRESHOLD = 10;

const buckets = new Map();

function noteFailure(ip) {
  if (!ip) return 0;
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return 1;
  }
  bucket.count += 1;
  return bucket.count;
}

function isBlocked(ip) {
  if (!ip) return false;
  const bucket = buckets.get(ip);
  if (!bucket) return false;
  if (Date.now() - bucket.windowStart >= WINDOW_MS) {
    buckets.delete(ip);
    return false;
  }
  return bucket.count >= THRESHOLD;
}

function reset(ip) {
  if (ip) buckets.delete(ip);
}

const gc = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of buckets) {
    if (now - bucket.windowStart >= WINDOW_MS) buckets.delete(ip);
  }
}, WINDOW_MS);
gc.unref();

module.exports = { WINDOW_MS, THRESHOLD, noteFailure, isBlocked, reset };
