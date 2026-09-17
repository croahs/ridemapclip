/**
 * Formats a duration in seconds to digital time format (e.g., "1:24:30" or "24:30").
 * If alwaysShowHours is true or seconds >= 3600, hours are included.
 */
export function formatDigitalTime(seconds: number | null, alwaysShowHours = false): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");

  if (hrs > 0 || alwaysShowHours) {
    return `${hrs}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Human-readable duration format (e.g., "1h 45m" or "25m 30s").
 */
export function formatHumanDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "Not recorded";
  }
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins >= 60) {
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
  return `${mins}m ${secs}s`;
}

/**
 * Formats ride elapsed time as hours and minutes (e.g., "1h 24m" or "0h 15m").
 */
export function formatRideElapsed(seconds: number | null, alwaysShowHours = false): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "--";
  }
  const totalMinutes = Math.floor(seconds / 60);
  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hrs > 0 || alwaysShowHours) {
    return `${hrs}h ${String(mins).padStart(2, "0")}m`;
  }
  return `${mins}m`;
}
