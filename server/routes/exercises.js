/* Catálogo de ejercicios: consulta de alternativas para un patrón.

   Solo lectura. Cambiar la rutina no ocurre aquí: el atleta elige una
   alternativa y el cliente la guarda en su catálogo propio con las mismas
   funciones que usa el editor de rutinas.

   El equipamiento sale SIEMPRE del perfil autenticado, nunca de la petición:
   si viniera del cliente, bastaría con manipularlo para que se propusieran
   ejercicios que el atleta no puede hacer. */
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireActiveProfile } from "../middleware/authorization.js";
import { cargarContexto } from "../db/repositories/coachContext.js";
import { createExerciseProvider } from "../integrations/exercises/factory.js";
import { alternativasA, patronesDisponibles } from "../domain/exercises/busqueda.js";

const router = express.Router();
router.use(requireAuth, requireActiveProfile);

let catalogo = null, iniciado = false;
const getCatalogo = () => {
  if (!iniciado) { try { catalogo = createExerciseProvider(); } catch { catalogo = null; } iniciado = true; }
  return catalogo;
};

router.get("/patrones", (_req, res) => res.json({ ok: true, patrones: patronesDisponibles() }));

router.get("/alternativas", async (req, res, next) => {
  try {
    const patron = String(req.query.patron || "").trim();
    if (!patron) return res.status(400).json({ ok: false, message: "Falta el patrón de movimiento" });

    const { perfil } = await cargarContexto(req.auth.athleteProfileId, {});
    const salida = await alternativasA(getCatalogo(), {
      patron,
      equipamiento: perfil?.equipamiento,
      ejercicioActual: req.query.actual ? { nombre: String(req.query.actual), canonico: String(req.query.actual).toLowerCase() } : null,
      soloEquipo: String(req.query.equipo || "").trim() || null,
      limite: 6,
    });

    /* Sin candidatos NO es un error: el catálogo puede no estar configurado o
       no tener nada para ese patrón. La interfaz lo dice y mantiene el
       ejercicio que ya había. */
    res.json({
      ok: true,
      candidatos: salida.candidatos,
      criterios: salida.criterios,
      motivo: salida.motivo,
      disponible: !!getCatalogo(),
    });
  } catch (error) { next(error); }
});

export default router;
