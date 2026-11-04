import { requiredText } from "../validate";

/** A service failure with an HTTP equivalent, shared by REST and Connect. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function invalidArgument(message: string): never {
  throw new ApiError(400, message);
}

export function requireText(value: unknown): string {
  const parsed = requiredText(value, "text");
  if (!parsed.ok) {
    invalidArgument(parsed.error);
  }
  return parsed.value;
}
