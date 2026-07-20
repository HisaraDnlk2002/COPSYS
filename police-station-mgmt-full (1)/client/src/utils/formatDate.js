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

// Converts a 24-hour "HH:mm" string (what a native <input type="time">
// stores) into 12-hour "h:mm AM/PM" for display.
function to12Hour(time24) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time24);
  if (!match) return time24;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  return `${hours}:${minutes} ${period}`;
}

// Combines a date value with a separate 24-hour "HH:mm" time string (e.g.
// an incident's date-of picker plus its own time-of field) into one
// "DD/MM/YYYY h:mm AM/PM" display. Falls back to just the date when no
// time was recorded.
export function formatDateAndTime(dateValue, timeValue) {
  const datePart = formatDate(dateValue);
  if (!timeValue) return datePart;
  return `${datePart} ${to12Hour(timeValue)}`;
}
