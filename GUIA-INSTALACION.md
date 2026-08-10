# Hybrid Coach v2.0 — Arquitectura, perfiles y evidencia razonada

---

## 1. Qué cambia respecto a la versión anterior

| | v1 | v2 |
|---|---|---|
| Plan | Fijo, escrito a mano para un atleta | **Generado** desde el perfil: distancia, fecha, nivel, lesiones, días y material |
| Usuarios | Uno | **Varios perfiles**, cada uno con su plan, su historial y su chat |
| Evidencia | Implícita en el código | **Biblioteca editable**: 22 referencias de partida, decisiones del plan enlazadas a ellas y coach que las cita |
| Gimnasio | Dos sesiones fijas | 1, 2, 3 o 4 sesiones según disponibilidad, con ejercicios sustituidos según el equipamiento |
| Lesiones | Codificadas para un caso | Cuestionario estructurado que modifica ejercicios, progresión y volumen máximo |

Los datos de la versión anterior **se migran solos** la primera vez que abras la nueva: aparece un perfil con todo el historial y el plan regenerado.

---

## 1 bis. Novedades de la 2.0

### Perfil precargado

La aplicación arranca con el perfil de **Roberto** ya cargado (100 % del cuestionario) y el plan generado: no pasa por el asistente. Se define en `perfilSemilla()`.

- Editable en **Perfiles → Editar cuestionario**; al guardar, el plan se regenera.
- El historial arranca vacío y se llena al registrar.
- `SEMILLA_ACTIVA = false` devuelve el arranque en blanco.
- Un estado guardado previo (v2 o v1) tiene prioridad: la semilla solo actúa en instalación limpia.

### Módulo de nutrición

En el icono **◐**, y con presencia en Hoy (tarjeta con las tomas del día) y en el planificador semanal (una línea por día con kcal, macros y el pre-entreno).

**Las calorías varían con la sesión del día.** El metabolismo basal se calcula por Katch-McArdle cuando hay porcentaje de grasa —parte de la masa magra, es más fiable— y por Mifflin-St Jeor cuando no. A eso se le suma la actividad diaria y el gasto de la sesión concreta. La proteína se mantiene estable; lo que se mueve es el carbohidrato, escalado de 3,5 a 7,5 g/kg según los minutos de entreno.

**El cronograma depende de a qué hora entrenas.** Las mismas 105 minutos de tirada larga generan pautas distintas si van antes del trabajo, al mediodía o por la tarde: cambia qué comer, cuánto antes, si hace falta pre-entreno y dónde cae la fibra.

**La fibra se gestiona sola.** El plan mediterráneo busca fibra alta y almidón resistente, pero la fibra en las 2-3 h previas a correr causa molestias digestivas. El módulo concentra legumbre, verdura y almidón resistente en las comidas alejadas de la sesión y marca explícitamente cuáles deben ir bajas en fibra. Ese conflicto está resuelto, no ignorado.

**Suelo de seguridad no negociable.** Por debajo de 30 kcal por kg de masa magra disponibles aparecen problemas hormonales, óseos e inmunitarios. El módulo se niega a bajar de ahí aunque fijes una cifra menor: la sube y te avisa. Tampoco es configurable.

**Catálogo de comidas.** Opcional: sin él el módulo da cantidades y momentos igualmente. Con él, las recomendaciones citan tus propias comidas. Un usuario nuevo arranca vacío y puede cargar un catálogo de ejemplo que después edita entero.

**Ajustes manuales.** Si sigues la pauta de un profesional, puedes fijar calorías diarias y g/kg de proteína en «Cómo se calcula». El módulo respeta tu cifra salvo que caiga por debajo del suelo.

El módulo no diagnostica intolerancias ni problemas digestivos y no sustituye a un dietista-nutricionista.

### Rutinas de gimnasio editables

En el icono **≡** de la barra superior, o desde **Entrenar → Editar rutina**. Para cada sesión (GYM A, GYM B…) puedes reordenar, cambiar series, repeticiones y RIR, marcar ejercicios como prioritarios, quitar los que no quieras y añadir otros del catálogo o **creados por ti** (nombre, grupo e incremento de carga).

Tres cosas que conviene saber:

- **Al primer cambio la rutina pasa a ser tuya** y deja de recortarse automáticamente por tiempo. Se te muestra la duración estimada (3,2 min por serie) y decides tú qué quitar. Con «Restaurar» vuelves a la generada.
- **Las adaptaciones por lesión se siguen aplicando encima.** Si quitas el sóleo teniendo historial de gemelo o Aquiles, el motor lo reañade y te lo dice en un aviso. Puedes cambiarle series y repeticiones, no eliminarlo.
- **Las fases del plan siguen actuando**: en descarga se quita una serie a los accesorios, en mantenimiento se recorta volumen sin tocar cargas, y en taper desaparece el trabajo de pierna.

La progresión de carga se asocia al **nombre** del ejercicio, así que reordenar o editar la rutina no pierde tu historial. Los ejercicios propios progresan igual, con el incremento que les hayas puesto.

### Importación de PDF

En **◈ → Referencias → Importar PDF**. El texto se extrae en tu navegador con pdf.js; solo ese texto se envía para clasificarlo. El PDF no se sube ni se guarda: lo que queda es la ficha estructurada.

La IA propone autores, año, título, fuente, DOI, tema, palabras clave, grado de evidencia, población, hallazgos, límites y **aplicación práctica**. La ficha queda marcada como *sin revisar* hasta que la confirmas. Límites: 14 páginas y 55 000 caracteres por documento; los PDF escaneados como imagen no funcionan porque no llevan texto extraíble.

### Selección de referencias por relevancia

Con una biblioteca grande no se manda entera en cada consulta. `refsRelevantes()` puntúa cada referencia contra la pregunta (tema y palabras clave pesan 4, título y aplicación 2,5, hallazgos 1,5) y pondera por grado de evidencia. El coach recibe entre 4 y 10 referencias por mensaje; el generador de razonamiento, hasta 14.

Si nada de la biblioteca trata el tema, se rellena con las de mayor grado **marcadas como sin relación directa**, para que el modelo no las fuerce como si respondieran a la pregunta.

### Razonamiento IA sobre las decisiones

En **◈ → Razonamiento**. La IA recibe los hechos del motor y las referencias relevantes, y devuelve decisiones justificadas con citas reales, adaptaciones y matices. Cada propuesta lleva un nivel de confianza y se marca cuando no tiene respaldo en tu biblioteca.

**Nada se aplica solo.** Aceptas o rechazas una por una; lo aceptado pasa a las decisiones del plan y al contexto del coach, etiquetado como `IA`. Sin generar razonamiento, el plan funciona igual con sus decisiones deterministas.

### Guardarraíles

La IA no calcula ni puede modificar la estructura que protege el tejido:

| Lo calcula el motor (bloqueado) | Puede proponer la IA |
|---|---|
| Semanas, taper, descargas | Justificación de cada decisión |
| Techo de tirada larga | Adaptaciones por lesión |
| Riesgo estructural | RIR, énfasis, tempo, accesorios |
| Reparto carrera/gimnasio | Nutrición, calentamiento, superficie |

`validarPropuesta()` descarta citas a referencias inexistentes, rechaza ajustes fuera de la lista permitida y marca las propuestas que rozan la estructura. Todos los recortes se muestran en un bloque de avisos: si la IA intenta algo que no puede, lo ves.

**Requisito**: el razonamiento, la importación de PDF y el coach necesitan la API de Anthropic, que solo funciona ejecutando la app como artifact dentro de claude.ai. Fuera de ahí fallan con aviso, y el resto de la aplicación sigue funcionando.

---

## 2. El cuestionario: 7 pasos, 38 preguntas

| Paso | Qué cubre | Para qué se usa realmente |
|---|---|---|
| 01 · Quién eres | Edad, sexo, altura, peso, grasa | Proteína diaria, referencias de FC, estimación de carga de impacto |
| 02 · Tu carrera | Distancia, fecha, qué buscas, prioridades ordenadas | Número de semanas, techo de la tirada larga, y **quién manda cuando hay que recortar** |
| 03 · Tu nivel corriendo | Experiencia, km actuales, sesiones, tirada más larga, ritmo, marca, parón, superficie | Punto de partida real de la progresión y decisión de empezar o no con caminar-correr |
| 04 · Tu nivel en el gimnasio | Experiencia, equipamiento, cargas, técnica | Cada ejercicio se sustituye por su equivalente disponible; las cargas iniciales salen de aquí |
| 05 · Lesiones y molestias | Lesiones previas con zona/recurrencia, molestias actuales con intensidad y cuándo aparecen, particularidades estructurales, cirugías, banderas médicas | **Lo que más condiciona el plan.** Cambia ejercicios, añade trabajo preventivo, frena la progresión y baja el techo de volumen |
| 06 · Disponibilidad | Días, minutos por sesión, minutos del fin de semana, momento del día, cross-training | Reparto carrera/gimnasio, duración real de cada sesión y techo verdadero de la tirada larga |
| 07 · Recuperación y contexto | Sueño, calidad, estrés, trabajo, nutrición, suplementos, reloj | Riesgo, decisiones de descarga y si el plan se prescribe por ritmos o por sensación |

El sistema muestra en todo momento el **porcentaje de perfil completo** y qué falta. Lo opcional está marcado como tal: no te pregunta nada que no vaya a usar.

---

## 3. Cómo se construye el plan

```
Perfil ─► riesgo estructural (0-10) ─┐
                                     ├─► techo de tirada larga
Distancia + fecha ─► nº de semanas ──┤     nº de sesiones y reparto
                                     ├─► ciclo de descargas (cada 3 o 4 semanas)
Días + minutos ─► reparto run/gym ───┤     duración de cada sesión
                                     ├─► plantilla de gimnasio (1-4 días)
Lesiones + material ─► adaptaciones ─┘     sustitución de ejercicios
```

**Riesgo estructural** suma lesión recurrente, molestia activa, parón, ausencia de volumen, particularidades del pie, sueño corto y carga de impacto. Con 6 o más: descargas cada 3 semanas en lugar de 4, techo de tirada larga reducido, arranque en caminar-correr y sin pliometría. Es una heurística de planificación explícita, no una predicción validada de lesión, y así se dice dentro de la app.

**Reparto de sesiones** según días disponibles y tu orden de prioridades. Con 5 días y la masa muscular primero: 3 carreras + 2 gimnasios. Con la misma disponibilidad y el rendimiento primero, el orden de prioridad al recortar cambia, no el número de sesiones.

**Plantillas de gimnasio**: 1 día → full body; 2 → full body A/B (frecuencia 2× por grupo); 3 → A/B/C; 4 → torso-pierna. Cada ejercicio existe en tres versiones (gimnasio completo, básico, casa) y la sesión se recorta automáticamente para caber en tus minutos, empezando siempre por los accesorios y nunca por el trabajo marcado como prioritario por tu historial.

---

## 4. La base de evidencia

Está en el icono ◈ de la barra superior, con dos vistas:

**Decisiones del plan** — cada decisión (techo de la tirada larga, número de sesiones, tipo de división, ciclo de descarga, taper, recorte de series frente a recorte de cargas, RIR 1-3, ausencia de pliometría, nutrición) aparece con su justificación en una frase y las referencias que la apoyan. Tocando una referencia se abre para leerla o editarla.

**Referencias** — 22 entradas de partida heredadas de tu revisión bibliográfica, filtrables por tema, con grado de evidencia (fuerte / moderada / débil / práctica) y un campo de *aplicación práctica*. Puedes añadir, editar y borrar.

Dos cosas importantes:

- El campo **aplicación práctica es lo que el coach usa al razonar**. Si añades una referencia, escribe ahí qué decisión justifica y con qué límites, no un resumen del abstract.
- Las referencias de partida vienen de tu revisión previa y **no llevan DOI**: prefiero dejarlo vacío a inventarlo. Verifica autoría, título y DOI antes de citarlas en cualquier trabajo formal. Aquí sirven para justificar decisiones de entrenamiento, no como cita académica verificada.

El coach recibe la biblioteca completa en su contexto y tiene instrucción de citar `[Autor año]` cuando se apoye en ella y de decir explícitamente cuándo algo es práctica habitual sin respaldo.

---

## 5. Estado de cada función

| Función | Estado |
|---|---|
| Perfiles múltiples, cuestionario, generación de plan, planificador semanal, registro, dashboard, biblioteca | 🟢 Funciona ya, sin configurar nada |
| Edición manual de rutinas y ejercicios propios | 🟢 Local, sin IA |
| Módulo de nutrición: objetivos, cronograma y catálogo | 🟢 Local, sin IA |
| Perfil precargado y plan generado al abrir | 🟢 Automático |
| Búsqueda de referencias por relevancia | 🟢 Local, sin IA |
| Chat del coach, importación de PDF, razonamiento IA | 🟡 Requiere ejecutarse como artifact de claude.ai |
| Persistencia entre sesiones y migración desde la versión anterior | 🟢 Automática |
| Google Sheets como fuente de verdad (con columna `perfil`) | 🟡 Requiere desplegar el Apps Script |
| Importación desde Strava | 🟡 Apps Script + OAuth |
| Webhook en tiempo real | 🔴 Sustituido por importación cada 3 h + botón manual |
| Garmin directo | 🔴 No viable para particulares: ruta Garmin → Strava → sistema |

---

## 6. Pasos para conectar Google Sheets y Strava

1. **Hoja**: crea una en `sheets.new` y copia el ID de la URL.
2. **Script**: Extensiones → Apps Script, pega `Codigo.gs`, sustituye el ID, guarda, ejecuta `inicializarHojas` y acepta permisos.
3. **Despliegue**: Implementar → Nueva implementación → Aplicación web → ejecutar como *Yo*, acceso *Cualquier usuario*. Copia la URL `/exec` y pégala en Ajustes → Google Sheets → Probar conexión.
4. **Strava**: crea la app en `strava.com/settings/api` con dominio de callback `script.google.com`. Guarda `STRAVA_CLIENT_ID` y `STRAVA_CLIENT_SECRET` en Propiedades del script. Abre `TU_URL_EXEC?action=auth` y autoriza. Prueba con `?action=sync`.
5. **Automatización**: ejecuta `instalarTrigger` una vez.

Propiedades opcionales del script: `SYNC_DESDE` (fecha desde la que importar), `SEMANA1_INICIO` (lunes de la semana 1 para etiquetar las actividades) y `STRAVA_PERFIL` (a qué perfil se asignan las actividades importadas).

**Sobre Strava**: el nivel estándar de su API exige suscripción de pago y sus condiciones prohíben usar los datos de la API para alimentar modelos de IA. Por eso las actividades importadas van a tu hoja, pero al chat del entrenador solo se le pasan las métricas que tú registras o confirmas. Es una decisión deliberada.

---

## 7. Límites, dichos claramente

El sistema no diagnostica lesiones y no lo hará. Distingue agujetas, fatiga y dolor potencialmente preocupante, y ante dolor en reposo, dolor que empeora al correr, dolor punzante localizado o hinchazón recomienda parar el impacto y consultar con un profesional sanitario. Si en el cuestionario marcas dolor torácico, mareos, tensión no controlada, problema cardíaco o embarazo, la aplicación te pedirá valoración médica antes de empezar.

El plan generado es una propuesta razonada de organización del entrenamiento a partir de lo que le cuentas. No sustituye a un entrenador que te vea moverte ni a un fisioterapeuta que te explore.
