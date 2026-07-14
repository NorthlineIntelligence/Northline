export const INVITE_TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern (America/New_York)" },
  { value: "America/Chicago", label: "Central (America/Chicago)" },
  { value: "America/Denver", label: "Mountain (America/Denver)" },
  { value: "America/Phoenix", label: "Arizona (America/Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (America/Los_Angeles)" },
  { value: "America/Anchorage", label: "Alaska (America/Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Pacific/Honolulu)" },
  { value: "UTC", label: "UTC" },
] as const;

export function isValidTimezone(timezone: string) {
  return INVITE_TIMEZONE_OPTIONS.some((option) => option.value === timezone);
}

export function zonedLocalToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    throw new Error("Invalid local date or time.");
  }

  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let i = 0; i < 4; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(utcMs));

    const got = Object.fromEntries(
      parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
    );
    const gotHour = Number(got.hour === "24" ? "0" : got.hour);
    const target = Date.UTC(year, month - 1, day, hour, minute, 0);
    const actual = Date.UTC(
      Number(got.year),
      Number(got.month) - 1,
      Number(got.day),
      gotHour,
      Number(got.minute),
      0
    );
    utcMs += target - actual;
  }

  return new Date(utcMs);
}

export function formatScheduledLocalDisplay(args: {
  localDate: string;
  localTime: string;
  timezone: string;
}) {
  return `${args.localDate} ${args.localTime} (${args.timezone})`;
}

export function formatScheduledUtcDisplay(iso: string | Date) {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
