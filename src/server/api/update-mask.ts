import { invalidArgument } from "./errors";

export function requestedFields(
  request: {
    updateMask?: string;
  },
  value: object,
  allowed: string[],
) {
  const fields: string[] = request.updateMask
    ? request.updateMask
        .split(",")
        .map((value: string) =>
          value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
        )
    : Object.keys(value).filter((field) => allowed.includes(field));
  const result = fields.includes("*") ? allowed : fields;
  if (result.some((field) => !allowed.includes(field))) {
    invalidArgument("invalid update mask");
  }
  return result;
}
