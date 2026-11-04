/** Narrow values that the caller has already established must exist. */
export function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a defined value");
  }
  return value;
}
