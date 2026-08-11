/* Cálculos deterministas de nutrición: aislados de HTTP y PostgreSQL. */
export function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
