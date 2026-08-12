# Totales de origen

**Fecha de la auditoría:** 2026-08-12

**Resultado:** inicio limpio aprobado por el propietario; no había datos históricos que importar.

**Fuente autoritativa desde el alta:** navegador normal usado para crear la primera ficha, respaldado mediante dual write en PostgreSQL.

## Datos históricos a importar

- Sesiones de carrera: 0
- Kilómetros: 0
- Series de fuerza: 0
- Volumen peso × repeticiones: 0
- Check-ins: 0
- Registros de recuperación: 0
- Referencias personales: 0
- Rango temporal: no aplicable

## Método

Declaración expresa del propietario durante la puesta en marcha: no existían datos en
otros dispositivos, Excel o Google Sheets que debieran conservarse. La ficha creada
después no forma parte de una migración histórica; se valida mediante dual write y
conciliación diaria.

Por tanto, los pasos `01`–`05` de importación histórica no se ejecutan contra staging. Los
scripts se conservan para una futura importación explícita y sus pruebas permanecen activas.
