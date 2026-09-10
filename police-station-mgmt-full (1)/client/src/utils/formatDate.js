// Formats to "DD/MM/YYYY". Reads UTC components directly rather than
// converting to the viewer's local timezone, since leave dates are
// calendar days, not precise moments — a local-timezone conversion
// could otherwise shift the displayed date depending on where the
// browser is.
export function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();

  return `${day}/${month}/${year}`;
}

// Normalizes a 24-hour time string (what a native <input type="time">
// already stores, and what the backend already sends) to zero-padded
// "HH:mm" for military-clock display — no AM/PM conversion, station
// operations run on 24-hour time throughout.
function toMilitary(time24) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time24);
  if (!match) return time24;

  const hours = match[1].padStart(2, "0");
  return `${hours}:${match[2]}`;
}

// Combines a date value with a separate 24-hour "HH:mm" time string (e.g.
// an incident's date-of picker plus its own time-of field) into one
// "DD/MM/YYYY HH:mm" display. Falls back to just the date when no time
// was recorded.
export function formatDateAndTime(dateValue, timeValue) {
  const datePart = formatDate(dateValue);
  if (!timeValue) return datePart;
  return `${datePart} ${toMilitary(timeValue)}`;
}
