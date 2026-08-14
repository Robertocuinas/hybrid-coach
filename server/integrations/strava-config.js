export function readLegacyStravaConfig(env = process.env) {
  const credentialsConfigured = Boolean(
    String(env.STRAVA_CLIENT_ID || "").trim()
    && String(env.STRAVA_CLIENT_SECRET || "").trim(),
  );
  const explicitlyEnabled = env.STRAVA_LEGACY_SINGLE_USER_ENABLED === "true";
  return {
    credentialsConfigured,
    explicitlyEnabled,
    enabled: credentialsConfigured && explicitlyEnabled,
  };
}

export function requireLegacyStrava(config) {
  return (_req, res, next) => config.enabled
    ? next()
    : res.status(503).json({
      ok: false,
      message: "La integración Strava heredada está desactivada hasta completar OAuth seguro por usuario.",
    });
}
