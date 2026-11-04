import { defined } from "../../defined";
import { invalidArgument } from "./errors";
export function filterItems<T extends object>(
  input: T[],
  expression: string | undefined,
  allowed: string[],
) {
  let items = input;
  if (!expression) {
    return items;
  }
  for (const part of expression.split(/\s+AND\s+/)) {
    const match = part.match(/^([a-z_]+)\s*(<=|>=|!=|=|<|>)\s*(?:"([^"]*)"|([A-Z_]+))$/);
    if (!(match && allowed.includes(defined(match[1])))) {
      invalidArgument("unsupported filter");
    }
    const [, key, operator, quoted, bare] = defined(match);
    const value = quoted ?? bare;
    items = items.filter((item) => {
      const actual = (item as Record<string, string | undefined>)[defined(key)];
      if (actual == null) {
        return false;
      }
      switch (operator) {
        case "=":
          return actual === value;
        case "!=":
          return actual !== value;
        case "<":
          return actual < defined(value);
        case ">":
          return actual > defined(value);
        case "<=":
          return actual <= defined(value);
        default:
          return actual >= defined(value);
      }
    });
  }
  return items;
}
