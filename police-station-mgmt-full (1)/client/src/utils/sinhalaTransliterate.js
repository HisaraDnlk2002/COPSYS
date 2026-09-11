// Converts phonetically-typed Singlish (e.g. "mama gedara yanawa") into
// Sinhala Unicode ("මම ගෙදර යනවා"), for officers who don't have a Sinhala
// keyboard/IME set up on their station PC. See InputField.jsx's
// `sinhalaTyping` prop for how this is wired into a field.
//
// Data tables (the actual Singlish->Sinhala mappings) live in
// sinhalaTransliterationMap.js, reused under MIT license from the
// `singlish-to-sinhala` npm package — see that file for full attribution.
// The matching algorithm below is our own: a longest-match walk over one
// word at a time (mirrors that package's own algorithm, which we read to
// confirm the intended behavior), committed at word boundaries so it
// plays nicely with a React controlled input instead of that package's
// approach of a global MutationObserver mutating every input on the page.
import { SYLLABLE_MAP, VOWEL_MODIFIERS, SPECIAL_MODIFIERS } from "./sinhalaTransliterationMap";

// No key in SYLLABLE_MAP is longer than this — bounds the search below.
const MAX_SYLLABLE_LENGTH = 5;
const MAX_VOWEL_MODIFIER_LENGTH = 4;
const MAX_SPECIAL_MODIFIER_LENGTH = 2;

// A field is "still mid-word" while the trailing character is a plain
// Latin letter — anything else (space, punctuation, a digit) means the
// word before it is finished and can be committed to Sinhala.
const LATIN_LETTER_RE = /[A-Za-z]/;

function isConsonantWithHal(fragment) {
  const mapped = SYLLABLE_MAP[fragment];
  return Boolean(mapped) && mapped.endsWith("්");
}

function consonantBase(consonantWithHal) {
  return consonantWithHal.endsWith("්") ? consonantWithHal.slice(0, -1) : consonantWithHal;
}

// Converts one word of Singlish to Sinhala. Any character that doesn't
// match anything (a digit, an already-Sinhala character, an unmapped
// symbol) is copied through unchanged rather than dropped, so partial or
// unrecognized input never loses data.
export function transliterateWord(word) {
  let result = "";
  let position = 0;

  while (position < word.length) {
    let matchLength = 0;
    let matchValue = null;

    const maxLength = Math.min(MAX_SYLLABLE_LENGTH, word.length - position);
    for (let len = maxLength; len > 0; len--) {
      const slice = word.slice(position, position + len);
      if (SYLLABLE_MAP[slice]) {
        matchLength = len;
        matchValue = SYLLABLE_MAP[slice];
        break;
      }
    }

    // Fallback: a bare consonant (SYLLABLE_MAP entry ending in the hal
    // mark, ්) combined with a vowel modifier that isn't already its own
    // direct entry above.
    if (!matchValue && position < word.length - 1 && isConsonantWithHal(word[position])) {
      const maxLen = Math.min(MAX_VOWEL_MODIFIER_LENGTH, word.length - position - 1);
      for (let len = maxLen; len > 0; len--) {
        const modifier = word.slice(position + 1, position + 1 + len);
        if (VOWEL_MODIFIERS[modifier] !== undefined) {
          matchLength = 1 + len;
          matchValue = consonantBase(SYLLABLE_MAP[word[position]]) + VOWEL_MODIFIERS[modifier];
          break;
        }
      }
    }

    // Fallback: a bare consonant + 'ya'/'ra' (yansaya/rakaransaya).
    if (!matchValue && position < word.length - 1 && isConsonantWithHal(word[position])) {
      const maxLen = Math.min(MAX_SPECIAL_MODIFIER_LENGTH, word.length - position - 1);
      for (let len = maxLen; len > 0; len--) {
        const modifier = word.slice(position + 1, position + 1 + len);
        if (SPECIAL_MODIFIERS[modifier]) {
          matchLength = 1 + len;
          matchValue = consonantBase(SYLLABLE_MAP[word[position]]) + SPECIAL_MODIFIERS[modifier];
          break;
        }
      }
    }

    if (matchValue) {
      result += matchValue;
      position += matchLength;
    } else {
      result += word[position];
      position += 1;
    }
  }

  return result;
}

// Called from a controlled field's onChange while Sinhala typing is on.
// If the character just typed completes a word (i.e. it's not a Latin
// letter itself — a space, punctuation, a digit), the Latin run
// immediately before it is transliterated in place; otherwise the value
// is returned untouched, so a word still being typed shows as plain
// Latin until it's "committed" (the same candidate-then-commit feel as
// any phonetic IME). Already-converted Sinhala text is never re-matched,
// since Sinhala characters aren't [A-Za-z] and stop the backward scan.
export function convertOnWordBoundary(value) {
  if (!value) return value;
  const boundaryIndex = value.length - 1;
  if (LATIN_LETTER_RE.test(value[boundaryIndex])) return value;

  let start = boundaryIndex - 1;
  while (start >= 0 && LATIN_LETTER_RE.test(value[start])) start--;
  const wordStart = start + 1;
  if (wordStart >= boundaryIndex) return value; // no Latin word right before the boundary char

  const word = value.slice(wordStart, boundaryIndex);
  const converted = transliterateWord(word);
  if (converted === word) return value;
  return value.slice(0, wordStart) + converted + value.slice(boundaryIndex);
}

// Called on blur, to commit whatever Latin word is left at the very end
// of the field when the officer finishes typing without a trailing space
// or punctuation (e.g. tabs away, or submits the form directly).
export function convertTrailingWord(value) {
  if (!value) return value;
  let start = value.length - 1;
  while (start >= 0 && LATIN_LETTER_RE.test(value[start])) start--;
  const wordStart = start + 1;
  if (wordStart >= value.length) return value;

  const word = value.slice(wordStart);
  const converted = transliterateWord(word);
  if (converted === word) return value;
  return value.slice(0, wordStart) + converted;
}
