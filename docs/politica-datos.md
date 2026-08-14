# Política operativa de datos

Documento técnico; no sustituye asesoramiento jurídico.

## Alcance y finalidad

Hybrid Coach procesa datos de cuenta, perfil deportivo, entrenamientos, nutrición,
recuperación, dolor y posibles lesiones para planificar y registrar entrenamiento. No debe
reutilizarlos para publicidad ni entrenar modelos externos.

## Fuente y acceso

- El usuario solo accede a perfiles asociados a su cuenta.
- La biblioteca científica es compartida; solo administradores pueden modificarla.
- Las claves permanecen en variables selladas del servidor.
- El registro público permanece cerrado salvo una ventana de alta deliberada.

## Retención inicial

- sesiones de acceso: hasta su caducidad/revocación y purga posterior;
- operaciones de sincronización y conciliación: 90 días tras el corte definitivo;
- conversaciones de IA: hasta que el usuario las elimine o 12 meses de inactividad;
- logs técnicos: 30 días, sin contenido sanitario ni secretos;
- backups: 30 días cuando exista automatización; copias manuales anteriores se reemplazan;
- cuenta y datos deportivos: mientras la cuenta esté activa o hasta una solicitud de borrado.

Estas ventanas deben revisarse antes de abrir la aplicación a terceros.

## Exportación y borrado

La pantalla de ajustes permite exportar la cuenta completa desde PostgreSQL y borrarla con
contraseña y confirmación explícita. El borrado revoca las sesiones y elimina en cascada
los perfiles y datos privados. Antes de abrir a terceros debe comunicarse la fecha en que
las copias de seguridad dejarán de contener los datos eliminados.

La exportación incluye las ejecuciones del planificador, revisiones y sesiones semanales,
evidencia referenciada, resultados de guardarraíles y propuestas de cambio. Las tablas raíz
se filtran por los perfiles de la cuenta; las tablas sin `athlete_profile_id` se recorren
solo desde IDs de ejecución o revisión ya autorizados. No incluye hashes de contraseña,
sesiones de acceso, tokens ni claves de proveedores.

No se borra directamente una fila aislada desde la consola como procedimiento habitual.

## Proveedores externos

IA, embeddings, R2 y Strava permanecen desactivados hasta configurar finalidad,
minimización, retención, permisos y consentimiento. Nunca se envía el historial sanitario
completo si una selección mínima permite resolver la tarea.

## Respuesta a incidentes

1. Revocar o rotar el secreto afectado.
2. Cerrar registro y, si procede, desactivar la integración.
3. Conservar logs técnicos sin copiar datos sensibles.
4. Determinar alcance, cuentas y periodo.
5. Restaurar en un servicio separado si hay corrupción.
6. Documentar causa, corrección y medidas preventivas.
