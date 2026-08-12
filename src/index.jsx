import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import HybridCoach from "./HybridCoach.jsx";

const pageStyle = {
  minHeight: "100vh", background: "#0E1621", color: "#E9EFF4", display: "flex",
  alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
};
const inputStyle = {
  width: "100%", padding: "13px 12px", background: "#1D2C3C", color: "#E9EFF4", border: "1px solid #27394C", borderRadius: 10, fontSize: 15, marginBottom: 10,
};

function AuthForm({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const isRegister = mode === "register";

  useEffect(() => {
    let active = true;
    fetch("/api/auth/registration-status", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) setRegistrationEnabled(Boolean(data?.enabled)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setWaiting(true); setError("");
    try {
      const response = await fetch(`/api/auth/${isRegister ? "register" : "login"}`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isRegister ? { nombre, email, password } : { email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "No se pudo completar el acceso.");
      onAuthenticated({
        user: data.user,
        profiles: data.profiles || (data.profile ? [data.profile] : []),
        activeProfileId: data.activeProfileId || data.profile?.id || data.profiles?.[0]?.id || null,
      });
    } catch (requestError) {
      setError(requestError.message || "No se pudo conectar con el servidor.");
    } finally { setWaiting(false); }
  };

  const switchMode = () => {
    setMode(isRegister ? "login" : "register");
    setError(""); setPassword("");
  };

  return (
    <div style={pageStyle}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 340 }}>
        <p style={{ color: "#4CC9C0", fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", margin: "0 0 8px" }}>Entrenamiento híbrido</p>
        <h1 style={{ fontFamily: "'Barlow Condensed',Impact,sans-serif", fontSize: 34, textTransform: "uppercase", letterSpacing: ".02em", margin: "0 0 6px" }}>Hybrid Coach</h1>
        <p style={{ color: "#8CA3B8", fontSize: 14, margin: "0 0 18px" }}>{isRegister ? "Crea tu cuenta para empezar con un perfil vacío." : "Entra con tu cuenta."}</p>
        {isRegister && <input value={nombre} onChange={(event) => setNombre(event.target.value)} placeholder="Tu nombre" autoComplete="name" autoFocus required style={inputStyle} />}
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Correo electrónico" autoComplete="email" autoFocus={!isRegister} required style={inputStyle} />
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={isRegister ? "Contraseña (mínimo 12 caracteres)" : "Contraseña"}
          autoComplete={isRegister ? "new-password" : "current-password"} minLength={isRegister ? 12 : undefined} required style={inputStyle} />
        <button type="submit" disabled={waiting || !email || !password || (isRegister && !nombre.trim())}
          style={{ width: "100%", padding: "13px 16px", background: "#4CC9C0", color: "#0E1621", border: 0, borderRadius: 10, fontSize: 17, fontWeight: 600, cursor: "pointer", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: ".04em", opacity: waiting ? .5 : 1 }}>
          {waiting ? "Comprobando…" : isRegister ? "Crear cuenta" : "Entrar"}
        </button>
        {error && <p style={{ color: "#E2685F", fontSize: 13, marginTop: 10 }}>{error}</p>}
        {(isRegister || registrationEnabled) && (
          <button type="button" onClick={switchMode} style={{ display: "block", width: "100%", marginTop: 14, color: "#8CA3B8", background: "transparent", border: 0, cursor: "pointer", fontSize: 13 }}>
            {isRegister ? "Ya tengo cuenta" : "Necesito crear una cuenta"}
          </button>
        )}
      </form>
    </div>
  );
}

function Raiz() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) setSession(data || false); })
      .catch(() => { if (active) setSession(false); });
    return () => { active = false; };
  }, []);

  const logout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } finally { setSession(false); }
  };

  if (session === null) return <div style={pageStyle} />;
  if (!session) return <AuthForm onAuthenticated={setSession} />;
  const activeProfile = session.profiles?.find((profile) => profile.id === session.activeProfileId) || session.profiles?.[0] || null;
  return <HybridCoach user={session.user} activeProfile={activeProfile} onLogout={logout} />;
}

createRoot(document.getElementById("raiz")).render(<Raiz />);
