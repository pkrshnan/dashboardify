// The task a reminder becomes, as CreateTask fields. Shared by the capture box and
// CaptureService, so the task saved is the one the preview showed.

import type { CaptureParse } from "./parse";

/** CreateTask fields for a parsed reminder; what wasn't said is left out. */
export function taskFields(parse: CaptureParse) {
  const [year, month, day] = (parse.dueDate ?? "").split("-").map(Number);
  const [hours, minutes] = (parse.dueTime ?? "").split(":").map(Number);
  return {
    description: parse.title,
    ...(parse.dueDate && { dueDate: { year, month, day } }),
    ...(parse.dueTime && { dueTime: { hours, minutes } }),
    ...(parse.recurrence && { recurrence: parse.recurrence }),
  };
}
