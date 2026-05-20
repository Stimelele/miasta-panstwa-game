import type { AnswerCheck } from "@/lib/game";

const POLISH_DIACRITICS: Record<string, string> = {
  a: "a",
  ą: "a",
  c: "c",
  ć: "c",
  e: "e",
  ę: "e",
  l: "l",
  ł: "l",
  n: "n",
  ń: "n",
  o: "o",
  ó: "o",
  s: "s",
  ś: "s",
  z: "z",
  ź: "z",
  ż: "z",
};

export function normalizePolish(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (char) => POLISH_DIACRITICS[char] || char)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function startsWithLetter(answer: string, letter: string) {
  const normalizedAnswer = normalizePolish(answer);
  const normalizedLetter = normalizePolish(letter);
  return (
    normalizedAnswer.length > 0 &&
    normalizedLetter.length > 0 &&
    normalizedAnswer.startsWith(normalizedLetter)
  );
}

export function ruleValidateAnswer(
  category: string,
  letter: string,
  answer: string,
): AnswerCheck {
  const trimmed = answer.trim();

  if (!trimmed) {
    return {
      answer: "",
      valid: false,
      points: 0,
      confidence: 1,
      reason: "Brak odpowiedzi.",
      source: "rule",
    };
  }

  if (!startsWithLetter(trimmed, letter)) {
    return {
      answer: trimmed,
      valid: false,
      points: 0,
      confidence: 0.98,
      reason: `Odpowiedz w kategorii ${category} musi zaczynac sie na litere ${letter}.`,
      source: "rule",
    };
  }

  return {
    answer: trimmed,
    valid: true,
    points: 10,
    confidence: 0.5,
    reason:
      "Odpowiedz zaczyna sie od poprawnej litery. Po dodaniu tokenu AI system sprawdzi tez sens kategorii.",
    source: "rule",
  };
}
