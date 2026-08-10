import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import HybridCoach from "./HybridCoach.jsx";

/* Puerta de entrada. Solo aparece si el servidor tiene contraseña puesta.
   Sin contraseña configurada, esto no se ve nunca.                          */
function Puerta({ onEntrar }) {
  const [pase, setPase] = useState("");
  const [error, setError] = useState("");
  const [espera, setEspera] = useState(false);

  const entrar = async (e) => {
    e.preventDefault();
    setEspera(true); setError("");
    try {
      const r = await fetch("/api/entrar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pase }),
      });
      if (r.ok) return onEntrar();
      setError("Esa no es la contraseña.");
    } catch { setError("No se pudo conectar con el servidor."); }
    setEspera(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0E1621", color: "#E9EFF4",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      fontFamily: "'IBM Plex Sans',system-ui,sans-serif" }}>
      <form onSubmit={entrar} style={{ width: "100%", maxWidth: 320 }}>
        <h1 style={{ fontFamily: "'Barlow Condensed',Impact,sans-serif", fontSize: 30,
          textTransform: "uppercase", letterSpacing: ".02em", margin: "0 0 6px" }}>Hybrid Coach</h1>
        <p style={{ color: "#8CA3B8", fontSize: 14, margin: "0 0 18px" }}>Esta instalación es privada.</p>
        <input type="password" value={pase} onChange={(e) => setPase(e.target.value)}
          placeholder="Contraseña" autoFocus
          style={{ width: "100%", padding: "13px 12px", background: "#1D2C3C", color: "#E9EFF4",
            border: "1px solid #27394C", borderRadius: 10, fontSize: 15, marginBottom: 10 }} />
        <button type="submit" disabled={espera || !pase}
          style={{ width: "100%", padding: "13px 16px", background: "#4CC9C0", color: "#0E1621",
            border: 0, borderRadius: 10, fontSize: 17, fontWeight: 600, cursor: "pointer",
            fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: ".04em",
            opacity: espera || !pase ? .5 : 1 }}>{espera ? "Comprobando…" : "Entrar"}</button>
        {error && <p style={{ color: "#E2685F", fontSize: 13, marginTop: 10 }}>{error}</p>}
      </form>
    </div>
  );
}

function Raiz() {
  const [estado, setEstado] = useState(null);
  useEffect(() => {
    fetch("/api/estado").then((r) => r.json())
      .then(setEstado)
      .catch(() => setEstado({ requierePase: false, dentro: true }));
  }, []);

  if (!estado) return <div style={{ minHeight: "100vh", background: "#0E1621" }} />;
  if (estado.requierePase && !estado.dentro) {
    return <Puerta onEntrar={() => setEstado({ ...estado, dentro: true })} />;
  }
  return <HybridCoach />;
}

createRoot(document.getElementById("raiz")).render(<Raiz />);
