/** AIP error codes beyond the ones each HTTP status implies. */
export type ApiCode =
  | "invalid_argument"
  | "failed_precondition"
  | "not_found"
  | "already_exists"
  | "aborted"
  | "permission_denied"
  | "unavailable";

/** A service failure with an HTTP equivalent, shared by REST and Connect. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: ApiCode,
  ) {
    super(message);
  }
}

export function invalidArgument(message: string): never {
  throw new ApiError(400, message);
}

/** The request is fine but the state isn't, e.g. iCloud refused the password. */
export function failedPrecondition(message: string): never {
  throw new ApiError(400, message, "failed_precondition");
}
