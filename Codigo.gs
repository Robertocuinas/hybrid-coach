/**
 * HYBRID COACH — Backend (Google Apps Script)
 * Roberto · Media maratón 18/10/2026
 *
 * Hace tres cosas:
 *   1. Recibe datos de la app y los escribe en Google Sheets (fuente de verdad).
 *   2. Gestiona el OAuth de Strava (la clave secreta vive AQUÍ, nunca en la app).
 *   3. Importa actividades de Strava, evita duplicados y las empareja con la sesión prevista.
 *
 * Instalación: ver GUIA-INSTALACION.md
 */

// ====================== CONFIGURACIÓN ======================
const SHEET_ID = 'PEGA_AQUI_EL_ID_DE_TU_HOJA';   // el trozo largo de la URL de la hoja
const PROPS = PropertiesService.getScriptProperties();
// Guarda en Propiedades del script: STRAVA_CLIENT_ID y STRAVA_CLIENT_SECRET

const HEADERS = {
  Perfiles:      ['perfil','clave','valor','etiqueta'],
  Plan_Maestro:  ['perfil','semana','fecha_inicio','fase','sesion','tipo','objetivo','volumen_min','intensidad','estado'],
  Plan_Semanal:  ['perfil','fecha','semana','dia','sesion_prevista','sesion_adaptada','motivo_adaptacion','estado'],
  Running:       ['id','perfil','date','source','external_id','session_code','semana','distancia_km','duracion_min','ritmo','fc_media','fc_max','desnivel','cadencia','rpe','dolor','notas','match_confianza'],
  Fuerza:        ['id','perfil','date','semana','session','exercise','set','weight','reps','rir','rpe','notes'],
  Recovery:      ['perfil','date','sueno','calidad','fatiga','agujetas','estres','motivacion','dolor'],
  Feedback:      ['perfil','date','semana','rpe','feelTxt','dolor','loc','tipo','cuando','energia','comentario'],
  Cambios_Plan:  ['perfil','fecha','semana','plan_original','cambio','motivo','datos'],
  Bibliografia:  ['id','autores','anio','titulo','fuente','tema','grado','aplicacion','doi','tags','origen','poblacion','resumen','limites','revisado'],
  Config:        ['fecha','clave','valor','prueba'],
  // --- v2.0 ---
  Rutinas:            ['perfil','sesion','orden','ejercicio_id','ejercicio','grupo','series','reps','rir','prioritario','incremento_kg','nota','origen'],
  Ejercicios_Propios: ['id','perfil','nombre','grupo','incremento_kg','creado'],
  Decisiones_Plan:    ['perfil','n','decision','justificacion','referencias','fuente'],
  Nutricion_Objetivos:['perfil','fecha','semana','dia','sesiones','min_entreno','kcal','proteina_g','carbohidrato_g','grasa_g','fibra_g','agua_l','momento','fijado_por_usuario'],
  Nutricion_Catalogo: ['perfil','categoria','opcion'],
  Nutricion_Config:   ['perfil','clave','valor','nota']
};

/**
 * MULTIPERFIL: todas las hojas de datos llevan una columna `perfil`.
 * Para ver solo un atleta, usa un filtro sobre esa columna o una hoja
 * con =FILTER(Running!A:R; Running!B:B="Nombre").
 */

// ====================== ENTRADA HTTP ======================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'append') {
      const rows = body.rows || [];
      const esEstado = HOJAS_ESTADO.indexOf(body.sheet) >= 0;
      const n = esEstado
        ? replaceRows(body.sheet, body.perfil || (rows[0] && rows[0].perfil) || '', rows)
        : appendRows(body.sheet, rows);
      return json({ ok: true, message: n + ' filas ' + (esEstado ? 'sustituidas' : 'escritas') + ' en ' + body.sheet });
    }
    return json({ ok: false, message: 'Acción desconocida: ' + body.action });
  } catch (err) {
    return json({ ok: false, message: String(err) });
  }
}

function doGet(e) {
  const a = (e.parameter || {}).action;
  if (a === 'auth')     return HtmlService.createHtmlOutput('<script>location.href="' + stravaAuthUrl() + '"</script>');
  if (a === 'callback') return HtmlService.createHtmlOutput(stravaExchange(e.parameter.code));
  if (a === 'sync')     return json(syncStrava());
  if (a === 'read')     return json({ ok: true, rows: readSheet(e.parameter.sheet) });
  return json({ ok: true, message: 'Hybrid Coach backend activo' });
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ====================== HOJAS ======================
function ss() { return SpreadsheetApp.openById(SHEET_ID); }

function getSheet(name) {
  const book = ss();
  let sh = book.getSheetByName(name);
  if (!sh) {
    sh = book.insertSheet(name);
    const h = HEADERS[name] || ['fecha','dato'];
    sh.appendRow(h);
    sh.getRange(1, 1, 1, h.length).setFontWeight('bold').setBackground('#16222F').setFontColor('#E9EFF4');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Hojas que representan un ESTADO, no un historial: al escribirlas se sustituye
 * lo que hubiera de ese perfil en lugar de acumular filas. Si no, cada vez que
 * editas una rutina tendrías una copia más y la hoja dejaría de significar nada.
 */
const HOJAS_ESTADO = ['Rutinas', 'Ejercicios_Propios', 'Decisiones_Plan', 'Perfiles', 'Nutricion_Catalogo', 'Nutricion_Config'];

function replaceRows(name, perfil, rows) {
  const sh = getSheet(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const pCol = head.indexOf('perfil');
  if (pCol >= 0 && sh.getLastRow() > 1) {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();
    const quedan = v.filter(function (r) { return String(r[pCol]) !== String(perfil); });
    sh.getRange(2, 1, sh.getLastRow() - 1, head.length).clearContent();
    if (quedan.length) sh.getRange(2, 1, quedan.length, head.length).setValues(quedan);
  }
  if (!rows.length) return 0;
  const out = rows.map(function (row) {
    return head.map(function (h) { return row[h] === undefined || row[h] === null ? '' : row[h]; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, head.length).setValues(out);
  return out.length;
}

function appendRows(name, rows) {
  if (!rows.length) return 0;
  const sh = getSheet(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  // Deduplicación por id (o por external_id en Running)
  const idCol = head.indexOf('id') >= 0 ? head.indexOf('id') : -1;
  const existing = {};
  if (idCol >= 0 && sh.getLastRow() > 1) {
    sh.getRange(2, idCol + 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { existing[String(r[0])] = true; });
  }
  const out = [];
  rows.forEach(function (row) {
    if (idCol >= 0 && row.id !== undefined && existing[String(row.id)]) return;
    out.push(head.map(function (h) { return row[h] === undefined || row[h] === null ? '' : row[h]; }));
  });
  if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, head.length).setValues(out);
  return out.length;
}

function readSheet(name) {
  const sh = ss().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues();
  const head = v.shift();
  return v.map(function (r) { const o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o; });
}

// ====================== STRAVA — OAUTH ======================
function redirectUri() { return ScriptApp.getService().getUrl(); }

function stravaAuthUrl() {
  return 'https://www.strava.com/oauth/authorize'
    + '?client_id=' + PROPS.getProperty('STRAVA_CLIENT_ID')
    + '&response_type=code'
    + '&redirect_uri=' + encodeURIComponent(redirectUri() + '?action=callback')
    + '&approval_prompt=auto&scope=activity:read_all';
}

function stravaExchange(code) {
  const r = UrlFetchApp.fetch('https://www.strava.com/oauth/token', {
    method: 'post', muteHttpExceptions: true,
    payload: {
      client_id: PROPS.getProperty('STRAVA_CLIENT_ID'),
      client_secret: PROPS.getProperty('STRAVA_CLIENT_SECRET'),
      code: code, grant_type: 'authorization_code'
    }
  });
  const d = JSON.parse(r.getContentText());
  if (!d.refresh_token) return 'Error autorizando Strava: ' + r.getContentText();
  PROPS.setProperty('STRAVA_REFRESH', d.refresh_token);
  PROPS.setProperty('STRAVA_ACCESS', d.access_token);
  PROPS.setProperty('STRAVA_EXPIRES', String(d.expires_at));
  return 'Strava conectado correctamente. Ya puedes cerrar esta pestaña.';
}

function stravaToken() {
  const exp = Number(PROPS.getProperty('STRAVA_EXPIRES') || 0);
  if (exp > Date.now() / 1000 + 120) return PROPS.getProperty('STRAVA_ACCESS');
  const r = UrlFetchApp.fetch('https://www.strava.com/oauth/token', {
    method: 'post', muteHttpExceptions: true,
    payload: {
      client_id: PROPS.getProperty('STRAVA_CLIENT_ID'),
      client_secret: PROPS.getProperty('STRAVA_CLIENT_SECRET'),
      refresh_token: PROPS.getProperty('STRAVA_REFRESH'), grant_type: 'refresh_token'
    }
  });
  const d = JSON.parse(r.getContentText());
  if (!d.access_token) throw new Error('No se pudo refrescar el token de Strava: ' + r.getContentText());
  PROPS.setProperty('STRAVA_ACCESS', d.access_token);
  PROPS.setProperty('STRAVA_EXPIRES', String(d.expires_at));
  if (d.refresh_token) PROPS.setProperty('STRAVA_REFRESH', d.refresh_token);
  return d.access_token;
}

// ====================== STRAVA — IMPORTACIÓN ======================
function syncStrava() {
  if (!PROPS.getProperty('STRAVA_REFRESH')) return { ok: false, message: 'Strava no está autorizado todavía' };
  const token = stravaToken();
  const desde = PROPS.getProperty('SYNC_DESDE') || '2026-01-01';   // fecha de inicio de la importación
  const after = Math.floor(new Date(desde + 'T00:00:00Z').getTime() / 1000);
  const res = UrlFetchApp.fetch('https://www.strava.com/api/v3/athlete/activities?after=' + after + '&per_page=50',
    { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  const acts = JSON.parse(res.getContentText());
  if (!Array.isArray(acts)) return { ok: false, message: res.getContentText() };

  const sh = getSheet('Running');
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const extCol = head.indexOf('external_id');
  const yaEstan = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, extCol + 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0]) yaEstan[String(r[0])] = true; });
  }

  const nuevas = [];
  acts.forEach(function (a) {
    if (String(a.type).toLowerCase().indexOf('run') < 0 && String(a.type).toLowerCase().indexOf('ride') < 0) return;
    if (yaEstan[String(a.id)]) return;                       // nunca duplicar
    const fecha = a.start_date_local.slice(0, 10);
    const min = Math.round(a.moving_time / 60);
    const km = +(a.distance / 1000).toFixed(2);
    const m = matchSession(fecha, min);
    nuevas.push({
      id: 'strava-' + a.id, perfil: PROPS.getProperty('STRAVA_PERFIL') || 'principal',
      date: fecha, source: 'Strava', external_id: a.id,
      session_code: m.code, semana: semanaDe(fecha),
      distancia_km: km, duracion_min: min, ritmo: paceStr(min, km),
      fc_media: a.average_heartrate || '', fc_max: a.max_heartrate || '',
      desnivel: a.total_elevation_gain || '', cadencia: a.average_cadence ? Math.round(a.average_cadence * 2) : '',
      rpe: '', dolor: '', notas: a.name, match_confianza: m.conf
    });
  });
  const n = appendRows('Running', nuevas);
  return { ok: true, message: n + ' actividades nuevas importadas', importadas: n, revisadas: acts.length };
}

function paceStr(min, km) {
  if (!km) return '';
  const s = (min * 60) / km;
  return Math.floor(s / 60) + ':' + ('0' + Math.round(s % 60)).slice(-2);
}
function semanaDe(fecha) {
  const inicio = PROPS.getProperty('SEMANA1_INICIO');   // lo escribe la app al generar el plan
  if (!inicio) return '';
  const d0 = new Date(inicio + 'T12:00:00');
  const d = new Date(fecha + 'T12:00:00');
  return Math.floor((d - d0) / 86400000 / 7) + 1;
}

/**
 * Empareja la actividad con la sesión prevista de la hoja Plan_Semanal.
 * Puntuación: mismo día (50) + duración parecida (hasta 50).
 * ≥70 se acepta automáticamente; 40-69 queda marcado para revisión; <40 sin asignar.
 */
function matchSession(fecha, min) {
  const plan = readSheet('Plan_Semanal').filter(function (p) {
    return String(p.fecha).slice(0, 10) === fecha && p.sesion_prevista;
  });
  if (!plan.length) return { code: '', conf: 'sin plan' };
  let best = null;
  plan.forEach(function (p) {
    const esperado = Number(p.volumen_min || 0);
    let score = 50;
    if (esperado) {
      const ratio = Math.min(min, esperado) / Math.max(min, esperado);
      score += Math.round(ratio * 50);
    }
    if (!best || score > best.score) best = { score: score, code: p.sesion_adaptada || p.sesion_prevista };
  });
  return { code: best.score >= 40 ? best.code : '', conf: best.score >= 70 ? 'auto' : best.score >= 40 ? 'revisar' : 'sin match' };
}

// ====================== AUTOMATIZACIÓN ======================
/** Ejecuta esto UNA vez para crear el disparador que importa Strava cada 3 horas. */
function instalarTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncStrava').timeBased().everyHours(3).create();
  return 'Trigger instalado: importación de Strava cada 3 h';
}

/** Ejecuta esto UNA vez para crear todas las hojas con sus cabeceras. */
function inicializarHojas() {
  Object.keys(HEADERS).forEach(function (n) { getSheet(n); });
  return 'Hojas creadas: ' + Object.keys(HEADERS).join(', ');
}
