/* Dominio puro: no importa Express, repositorios ni proveedores externos. */
export function assertPlanInput(profile) {
  if (!profile || typeof profile !== "object") throw new TypeError("Se requiere un perfil");
  if (!profile.fechaCarrera && !profile.fecha_carrera) throw new Error("fechaCarrera es obligatoria para generar un plan");
  return profile;
}

export function onlyAllowedPlanChanges(changes, allowed = []) {
  return Object.fromEntries(Object.entries(changes || {}).filter(([key]) => allowed.includes(key)));
}
