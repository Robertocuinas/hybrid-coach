export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; connect-src 'self' https://script.google.com; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com");
  if (req.path?.startsWith("/api/") || req.path?.startsWith("/auth/")) res.setHeader("Cache-Control", "no-store");
  next();
}

export function requireTrustedOrigin(req, res, next) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  const allowed = process.env.APP_ORIGIN;
  if (origin && allowed && origin !== allowed) return res.status(403).json({ ok: false, message: "Origen no permitido" });
  if (!origin && allowed && req.headers.cookie) return res.status(403).json({ ok: false, message: "Falta el origen de la petición" });
  next();
}
