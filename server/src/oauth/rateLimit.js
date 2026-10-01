// Small in-memory fixed-window limiter. The API runs as a single pm2
// process behind nginx, so per-process counters are enough here; the keys
// are caller IPs (req.ip honours the loopback-only trust proxy setting).
function rateLimit({ limit, windowMs = 60000, keyFn = (req) => req.ip }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs);
  timer.unref();
  return function limiter(req, res, next) {
    const key = keyFn(req) || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited', error_description: 'Too many requests. Slow down.' });
    }
    return next();
  };
}

module.exports = { rateLimit };
