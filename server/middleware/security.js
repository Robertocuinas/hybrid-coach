export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' https://api.anthropic.com https://script.google.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com");
  next();
}

export function requireTrustedOrigin(req, res, next) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  const allowed = process.env.APP_ORIGIN;
  if (origin && allowed && origin !== allowed) return res.status(403).json({ ok: false, message: "Origen no permitido" });
  next();
}
