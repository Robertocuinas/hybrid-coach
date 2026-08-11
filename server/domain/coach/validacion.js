/* Guardarraíles: todo lo que devuelve el modelo pasa por aquí antes de poder
   mostrarse siquiera (CLAUDE.md §4.3 y §4.4).

   LA LÓGICA NO CAMBIA respecto al sistema anterior. Cambia CONTRA QUÉ valida:
   antes los "refs" eran ids de ficha bibliográfica ("b5", "n12"); ahora son
   document_chunk_id reales. Todo id citado que no estuviera en los fragmentos
   ENTREGADOS en el prompt se descarta y se registra como aviso — mecanismo 4
   de grounding (docs/05-rag.md §8).

   Se valida contra lo entregado y no contra "lo que exista en la base de
   datos": citar un fragmento real que nunca se le enseñó al modelo sigue
   siendo una cita inventada. */
import { randomUUID } from "node:crypto";
import { AJUSTES_PERMITIDOS, CAMPOS_BLOQUEADOS } from "./prompt.js";

const texto = (valor, max) => String(valor ?? "").slice(0, max);

/**
 * @param propuesta  JSON ya extraído de la respuesta del modelo
 * @param entregados fragmentos que REALMENTE se enviaron en el prompt
 */
export function validarPropuesta(propuesta = {}, { entregados = [] } = {}) {
  const avisos = [];
  const porId = new Map(entregados.map((c) => [String(c.id), c]));

  /* Se conserva el orden en que el modelo cita, porque es el que usa para
     construir el argumento; el rank de la cita sale de ahí. */
  const filtrarRefs = (refs, contexto) => (Array.isArray(refs) ? refs : [])
    .map((x) => String(x).trim())
    .filter((x) => {
      if (porId.has(x)) return true;
      avisos.push(`Cita descartada: el fragmento "${x.slice(0, 40)}" no estaba entre los entregados${contexto ? ` (${contexto})` : ""}.`);
      return false;
    });

  const decisiones = (Array.isArray(propuesta.decisiones) ? propuesta.decisiones : []).map((d) => {
    const refs = filtrarRefs(d.refs, texto(d.t, 40));
    const cuerpo = `${d.t || ""} ${d.p || ""}`.toLowerCase();
    /* Misma detección que antes: si el texto propone tocar la estructura de
       seguridad, se marca y se muestra como texto, pero no altera un número. */
    const invade = CAMPOS_BLOQUEADOS.some((campo) =>
      new RegExp(`(sub|baj|ampl|reduc|elimin|cambi)\\w*\\s+(el\\s+|la\\s+|los\\s+|las\\s+)?${campo}`).test(cuerpo));
    if (invade) avisos.push(`Propuesta marcada: "${texto(d.t, 60)}" parece tocar la estructura de seguridad. Se muestra como texto, no altera ningún número.`);

    return {
      id: randomUUID(),
      t: texto(d.t, 160),
      p: texto(d.p, 600),
      refs,
      /* Los fragmentos citados viajan resueltos para poder mostrar página y
         sección sin volver a consultar la base de datos. */
      citas: refs.map((id, indice) => {
        const chunk = porId.get(id);
        return {
          chunkId: id,
          rank: indice + 1,
          similarityScore: chunk?.scores?.umbral ?? chunk?.scores?.similitudCoseno ?? null,
          titulo: chunk?.titulo ?? null,
          autores: chunk?.autores ?? null,
          anio: chunk?.anio ?? null,
          seccion: chunk?.seccion ?? null,
          paginaInicio: chunk?.paginaInicio ?? null,
          paginaFin: chunk?.paginaFin ?? null,
          relleno: !!chunk?._relleno,
        };
      }),
      confianza: ["alta", "media", "baja"].includes(d.confianza) ? d.confianza : "media",
      sinRespaldo: !refs.length,
      invade,
      estado: "pendiente",
    };
  }).filter((d) => d.t && d.p);

  const adaptaciones = (Array.isArray(propuesta.adaptaciones) ? propuesta.adaptaciones : [])
    .map((a) => ({ id: randomUUID(), z: texto(a.z, 80), a: texto(a.a, 400), estado: "pendiente" }))
    .filter((a) => a.z && a.a);

  const ajustes = (Array.isArray(propuesta.ajustes) ? propuesta.ajustes : []).filter((a) => {
    if (AJUSTES_PERMITIDOS.includes(a.campo)) return true;
    avisos.push(`Ajuste rechazado: "${texto(a.campo, 40)}" no está entre los campos que la IA puede tocar.`);
    return false;
  }).map((a) => ({
    id: randomUUID(), campo: a.campo, valor: texto(a.valor, 200), motivo: texto(a.motivo, 200), estado: "pendiente",
  }));

  const sinRespaldo = (Array.isArray(propuesta.sin_respaldo) ? propuesta.sin_respaldo : []).map((x) => texto(x, 300));

  /* Nuevo en la Fase 8: cuando la literatura entregada se contradice, el
     modelo debe decirlo en vez de elegir o promediar (docs/05-rag.md §9). */
  const evidenciaMixta = (Array.isArray(propuesta.evidencia_mixta) ? propuesta.evidencia_mixta : [])
    .map((e) => ({
      tema: texto(e.tema, 160),
      posiciones: texto(e.posiciones, 600),
      refs: filtrarRefs(e.refs, "evidencia mixta"),
    }))
    .filter((e) => e.tema && e.posiciones);

  if (!decisiones.length) avisos.push("La IA no devolvió ninguna decisión utilizable. Se mantienen las deterministas.");

  return { decisiones, adaptaciones, ajustes, sinRespaldo, evidenciaMixta, avisos };
}

/* El coach conversacional propone cambios con un bloque <<CAMBIO>>. Se valida
   igual que antes: tipo dentro de la lista y nada que toque la estructura. */
const TIPOS_CAMBIO = ["mover", "sustituir", "reducir_volumen", "reducir_intensidad", "eliminar", "descansar"];

export function extraerCambio(respuesta) {
  const encontrado = String(respuesta || "").match(/<<CAMBIO>>([\s\S]*?)<<FIN>>/);
  if (!encontrado) return { texto: String(respuesta || "").trim(), cambio: null, avisos: [] };

  const limpio = String(respuesta).replace(encontrado[0], "").trim();
  const avisos = [];
  let cambio = null;
  try {
    const bruto = JSON.parse(encontrado[1].trim());
    if (!TIPOS_CAMBIO.includes(bruto.tipo)) {
      avisos.push(`Cambio descartado: tipo "${texto(bruto.tipo, 30)}" no permitido.`);
    } else {
      cambio = {
        tipo: bruto.tipo,
        dia: texto(bruto.dia, 20) || null,
        de: texto(bruto.de, 40) || null,
        a: texto(bruto.a, 40) || null,
        motivo: texto(bruto.motivo, 200) || null,
      };
    }
  } catch {
    avisos.push("Cambio descartado: el bloque <<CAMBIO>> no era JSON válido.");
  }
  return { texto: limpio, cambio, avisos };
}
