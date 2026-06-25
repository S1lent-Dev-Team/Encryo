// ratelimit.js — einfacher In-Memory Fixed-Window-Limiter. Reicht für das
// Single-Prozess-SQLite-Setup; bei mehreren Instanzen müsste ein geteilter
// Store (Redis) her. Schlüssel ist die Client-IP (req.ip respektiert dank
// trust proxy das X-Forwarded-For).

export function rateLimit({ windowMs, max, message = "Zu viele Anfragen. Bitte später erneut versuchen." }) {
  const hits = new Map(); // ip -> { count, resetAt }

  // Abgelaufene Einträge regelmäßig entfernen, damit die Map nicht wächst.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  timer.unref?.(); // hält den Prozess nicht künstlich am Leben

  return function limiter(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || "unknown";
    let e = hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + windowMs };
      hits.set(key, e);
    }
    e.count++;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - e.count)));
    if (e.count > max) {
      const retry = Math.ceil((e.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ error: message, retryAfter: retry });
    }
    next();
  };
}
