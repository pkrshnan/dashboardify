import { isIsoDate } from "../../vault/time";
import { invalidArgument } from "./errors";
import type { DateParts, TimeParts } from "./requests";

export function toDateParts(value: string) {
  const date = Temporal.PlainDate.from(value);
  return { year: date.year, month: date.month, day: date.day };
}
export function fromDateParts(date: DateParts): string {
  const value = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  if (!isIsoDate(value)) {
    invalidArgument("invalid date");
  }
  return value;
}
export function toTimeParts(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return { hours, minutes };
}
export function fromTimeParts(time: TimeParts): string {
  const hours = time.hours ?? 0;
  const minutes = time.minutes ?? 0;
  if (!(inRange(hours, 0, 23) && inRange(minutes, 0, 59)) || time.seconds || time.nanos) {
    invalidArgument("invalid time");
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function inRange(value: number, min: number, max: number) {
  return Number.isInteger(value) && value >= min && value <= max;
}
