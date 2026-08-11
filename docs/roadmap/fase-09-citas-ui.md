# Fase 9 · Citas y evidencia en la interfaz

**Dificultad:** baja · **Depende de:** Fase 8

Es la fase que el usuario **percibe** como "ahora sí se justifica de verdad".

---

## Objetivo

Poder pulsar en una cita y ver el fragmento exacto del paper que respalda la recomendación,
con su página y su DOI.

## Referencias

- [`../05-rag.md`](../05-rag.md) §10

## Resultado esperado

```
Motivo
  Se reduce el volumen de hoy por RPE elevado y recuperación insuficiente.

Evidencia
  [Wilson 2012]  [Bosquet 2007]

  → Ver evidencia
      · fragmento textual exacto del paper
      · página 4 · sección Discussion
      · J Strength Cond Res · meta-análisis · evidencia fuerte
      · DOI 10.xxxx/xxxxx
      · abrir PDF original
```

## Tareas

- [x] Ampliar el componente `RefChips` (ya existe y ya abre un modal) para mostrar:
      fragmento, sección, página, tipo de estudio, grado de evidencia, DOI
- [x] Enlace al PDF original en R2, con URL firmada de caducidad corta
- [x] Distinguir visualmente citas fuertes de citas de relleno (`_relleno`), usando
      `similarity_score`
- [x] Mostrar el aviso de "sin respaldo" cuando una decisión no tiene citas
- [x] Mostrar el nivel de confianza de cada propuesta (ya existe el campo)
- [x] Presentar `evidencia_mixta` cuando los estudios discrepan: ambas posturas con sus citas
- [x] Mantener visible el aviso sobre las referencias semilla (sin DOI, autoría no verificada)

## Criterio de terminado

- [x] Pulsar una cita muestra el fragmento textual real, no solo el título del paper
- [ ] La página mostrada corresponde con la del PDF original (verificado a mano en 3 casos)
- [ ] El PDF original se abre desde la ficha
- [x] Una decisión sin respaldo se ve claramente marcada como tal
- [x] Un caso de evidencia mixta muestra ambas posturas, no una elegida arbitrariamente

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **Falsa sensación de rigor** por el aspecto pulido de las citas | Mantener siempre visibles el grado de evidencia, la población del estudio y el aviso de "sin respaldo". Una cita bonita de un estudio en población distinta sigue siendo mala evidencia |
| Números de página desfasados respecto al PDF | Verificar a mano en varios documentos; el offset entre página del PDF y página impresa del paper es un error clásico |
| URLs de R2 públicas indefinidamente | URL firmada con caducidad corta |

## Notas

Este es el punto donde el sistema empieza a poder equivocarse de forma convincente. La
defensa no es técnica sino de diseño de interfaz: **la incertidumbre tiene que verse tanto
como la certeza**. Grado de evidencia, población del estudio y avisos de "sin respaldo" no
son letra pequeña, son parte del contenido principal.
