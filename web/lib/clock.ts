// The current date and time in the server's time zone, which is the one the vault and the
// calendar use, whatever time zone the browser is in.

export interface Now {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  /** Minutes after midnight. */
  minutes: number;
}

export function nowIn(timeZone: string, at: Date = new Date()): Now {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour");
  const minute = get("minute");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${minute}`,
    minutes: Number(hour) * 60 + Number(minute),
  };
}
