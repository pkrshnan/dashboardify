import { invalidArgument } from "./errors";
import type { PageRequest } from "./requests";
export function paginate<T>(items: T[], request: PageRequest) {
  const size = Number(request.pageSize || 50);
  if (!Number.isInteger(size) || size < 1) {
    invalidArgument("invalid page size");
  }
  let offset = 0;
  if (request.pageToken) {
    try {
      offset = Number(Buffer.from(request.pageToken, "base64url").toString());
    } catch {
      invalidArgument("invalid page token");
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      invalidArgument("invalid page token");
    }
  }
  const end = offset + Math.min(size, 500);
  return {
    items: items.slice(offset, end),
    nextPageToken: end < items.length ? Buffer.from(String(end)).toString("base64url") : "",
  };
}
