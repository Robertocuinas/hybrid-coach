# Hybrid Coach — despliegue en Railway

Aplicación de plan de media maratón con fuerza híbrida, base de evidencia y módulo de nutrición. Todo se sirve desde un único servicio: la aplicación, el proxy de IA, el puente a Google Sheets y Strava.

---

## Ponerla en marcha

### 1. Subir el código a GitHub

Railway despliega desde un repositorio. Desde esta carpeta:

```bash
git init
git add .
git commit -m "Hybrid Coach v2"
```

Crea un repositorio **privado** en github.com y sigue las dos líneas que te da GitHub (`git remote add origin …` y `git push -u origin main`).

Privado importa: aunque las claves van en variables de entorno y no en el código, tu perfil, tus lesiones y tu plan sí están en el repositorio.

### 2. Crear el servicio en Railway

1. Entra en [railway.app](https://railway.app) y regístrate con GitHub.
2. **New Project → Deploy from GitHub repo** → elige el repositorio.
3. Railway detecta Node, instala y compila solo. El primer despliegue tarda 2-3 minutos.

### 3. Poner las variables de entorno

En el servicio → pestaña **Variables** → **New Variable**. Ninguna es obligatoria, pero la primera sí la necesitas en cuanto compartas la dirección:

| Variable | Para qué | Si la dejas vacía |
|---|---|---|
| `APP_PASSWORD` | Contraseña única de acceso | **Entra cualquiera que tenga la dirección** |
| `ANTHROPIC_API_KEY` | Razonamiento sobre el plan, lectura de PDF, coach | La app funciona igual, sin capa de IA |
| `APPS_SCRIPT_URL` | Puente a tu Google Sheets | No se respalda nada en la hoja |
| `STRAVA_CLIENT_ID` | Importar carreras | Se registran a mano |
| `STRAVA_CLIENT_SECRET` | Lo mismo | — |

Tu `APPS_SCRIPT_URL` es la que ya tienes desplegada:

```
https://script.google.com/macros/s/AKfycbz50W3xTmnUebgUNhlO4mrasp_nT2Qe_R-OKfpvil0tdVqlyn4T1bRs_jHzPh-_Tl7BqQ/exec
```

La clave de Anthropic se saca en [console.anthropic.com](https://console.anthropic.com) → API Keys. **Va aquí, en el servidor.** Nunca la pegues en el código de la aplicación: cualquiera que abra la web podría leerla desde las herramientas del navegador.

Cada vez que guardas una variable, Railway redespliega solo.

### 4. Generar la dirección pública

**Settings → Networking → Generate Domain**. Te da algo como `hybridcoach-production.up.railway.app`. Esa es tu aplicación.

### 5. Comprobar que todo está enchufado

Abre `https://tu-dominio.up.railway.app/api/estado`. Responde qué hay configurado:

```json
{"ok":true,"requierePase":true,"ia":true,"hoja":true,"strava":false}
```

Lo que salga en `false` es lo que falta por configurar.

### 6. Strava (opcional)

En [strava.com/settings/api](https://www.strava.com/settings/api), pon como *Authorization Callback Domain* tu dominio de Railway **sin `https://`**. Luego entra una vez en `https://tu-dominio.up.railway.app/api/strava/entrar` para autorizar.

---

## Usarla en el móvil

Ábrela en el navegador y **Añadir a pantalla de inicio**. Se comporta como una aplicación nativa: pantalla completa, sin barra de direcciones, icono propio.

---

## Compartirla con otra persona

Le pasas la dirección y la contraseña. No hace falta que instale nada.

Antes de hacerlo, ten en cuenta tres cosas:

**Los datos son por navegador.** Cada persona tiene su plan y su perfil en su propio dispositivo. No se ven entre ellos. Pero si esa persona cambia de móvil, empieza de cero.

**La hoja de cálculo es compartida.** Todos escriben en la misma, separados por la columna `perfil`. Verás sus datos y ellos podrían ver los tuyos si les das acceso a la hoja. Si prefieres que no, cada uno despliega su propio servicio: es gratis hasta agotar el crédito mensual.

**La IA la pagas tú.** Las llamadas van con tu clave. Con pocos usuarios es calderilla, pero conviene saberlo antes de repartir la dirección.

Si en vez de eso quieres que cada uno monte lo suyo, pásales el repositorio y este archivo: son los mismos seis pasos.

---

## Lo que cuesta

El plan gratuito de Railway da unos 5 $ de crédito al mes. Una aplicación como esta, con uso personal, consume bastante menos: es un servidor pequeño que la mayor parte del tiempo está parado. Si crece, el plan Hobby son 5 $/mes.

---

## Qué hace cada archivo

```
server.js              Servidor: aplicación, proxy de IA, puente a Sheets, Strava
build.mjs              Compila la aplicación a public/app.js
src/HybridCoach.jsx    La aplicación entera
src/index.jsx          Arranque y pantalla de contraseña
public/index.html      Documento que la carga
railway.json           Cómo construye y arranca Railway
.env.example           Plantilla de variables (referencia; las reales van en Railway)
```

---

## Si algo falla

**El despliegue se cae al construir.** Mira los *Deploy Logs* en Railway. Casi siempre es que `npm run build` no encontró algo: comprueba que subiste `src/` y `build.mjs`.

**Carga en negro y no aparece nada.** Abre la consola del navegador (F12). Si dice que no encuentra `/app.js`, la compilación no llegó a generarse: vuelve a desplegar.

**La IA responde "no tiene clave configurada".** Falta `ANTHROPIC_API_KEY` o se guardó con espacios al principio o al final.

**No se guarda nada en la hoja.** Comprueba `/api/estado`. Si `hoja` es `false`, falta `APPS_SCRIPT_URL`. Si es `true` pero no aparecen filas, el Apps Script está desplegado con acceso restringido: en Google Apps Script, *Implementar → Gestionar implementaciones → Quién tiene acceso: Cualquier usuario*.

**Pide la contraseña una y otra vez.** El navegador está bloqueando la cookie. Comprueba que entras por `https://`, no por `http://`.

---

## Sobre los datos

Esta aplicación guarda peso, porcentaje de grasa, lesiones y sensaciones de entrenamiento. Son datos de salud. Repositorio privado, contraseña puesta y cuidado con a quién le das acceso a la hoja.

El módulo de nutrición no diagnostica nada ni sustituye a un dietista-nutricionista, y el plan de entrenamiento no sustituye a un fisioterapeuta ni a un médico. Ante dolor persistente o cualquier bandera médica, eso lo valora un profesional sanitario.
