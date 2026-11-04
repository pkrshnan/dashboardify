import type { DescMessage, Message } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import { ApiError } from "./errors";

const validator = createValidator();

/** Run the constraints declared in buf.validate options for either transport. */
export function validateMessage(schema: DescMessage, message: Message): void {
  const result = validator.validate(schema, message);
  if (result.kind === "invalid") {
    throw new ApiError(400, result.error.message);
  }
  if (result.kind === "error") {
    throw result.error;
  }
}
