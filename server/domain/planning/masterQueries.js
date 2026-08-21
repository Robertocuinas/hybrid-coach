/* Consultas RAG para la generación del plan maestro. Deterministas: salen de
   hechos del perfil, no de una llamada de modelo. Cubren las decisiones de
   estructura que la evidencia debe sostener. */

export function construirConsultasMaestro(contexto = {}, analytics = {}, config = {}) {
  const p = contexto.profile || {};
  const objetivo = String(p.distancia_objetivo || p.distancia || "media maratón");
  const riesgo = analytics?.seguridad?.dolorMaximo ?? 0;
  const base = [
    { key: "volumen_progresion", required: true, query: `progresión de volumen semanal y riesgo de lesión en preparación de ${objetivo}` },
    { key: "tirada_larga", required: true, query: "tirada larga prescrita por tiempo duración segura media maratón" },
    { key: "fuerza_hibrido", required: true, query: "fuerza concurrentes carrera frecuencia intensidad RIR hipertrofia" },
    { key: "taper", required: true, query: "taper reducción volumen mantener intensidad rendimiento competición" },
    { key: "descargas", required: false, query: "semanas de descarga deload acumulación consolidación" },
    { key: "readaptacion", required: false, query: "caminar-correr readaptación tendón riesgo alto dolor" },
  ];
  if (riesgo >= 5) {
    base.push({ key: "dolor_clinico", required: true, query: "dolor en carrera cuándo detener impacto valoración profesional" });
  }
  return base;
}
