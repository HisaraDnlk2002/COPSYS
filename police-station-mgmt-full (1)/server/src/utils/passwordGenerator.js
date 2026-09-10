const crypto = require("crypto");

// Character sets deliberately exclude visually-ambiguous characters
// (0/O, 1/l/I) since the generated password is read off a screen or an
// email and retyped by hand at the next login.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

function randomChar(charset) {
  // crypto.randomInt, not Math.random() — this is a login credential.
  return charset[crypto.randomInt(charset.length)];
}

// Fisher-Yates using crypto.randomInt so the final character order isn't
// predictable from array-index alone either.
function shuffle(chars) {
  const arr = chars.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

// Generates a random password guaranteed to contain at least one
// uppercase, lowercase, digit and symbol character — used everywhere a
// password used to be typed by hand (new account creation, Admin's
// "Reset Password" action, and approved forgot-password requests) so a
// credential is never chosen by (or known in advance to) the person
// issuing it.
function generatePassword(length = 10) {
  const required = [randomChar(UPPER), randomChar(LOWER), randomChar(DIGITS), randomChar(SYMBOLS)];
  const rest = Array.from({ length: length - required.length }, () => randomChar(ALL));
  return shuffle([...required, ...rest].join(""));
}

module.exports = { generatePassword };
