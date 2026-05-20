import type { Timestamp } from "firebase/firestore";

export const GAME_COLLECTION =
  process.env.NEXT_PUBLIC_FIREBASE_COLLECTION_ROOT || "Panstwa Miasta Gra";

export const DEFAULT_CATEGORIES: GameCategory[] = [
  { id: "panstwo", name: "Panstwo", locked: true },
  { id: "miasto", name: "Miasto", locked: true },
  { id: "rzeka", name: "Rzeka" },
  { id: "roslina", name: "Roslina" },
  { id: "zwierze", name: "Zwierze" },
  { id: "imie", name: "Imie" },
  { id: "zawod", name: "Zawod" },
  { id: "rzecz", name: "Rzecz" },
];

export const POLISH_GAME_LETTERS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "R",
  "S",
  "T",
  "U",
  "W",
  "Z",
];

export type GameCategory = {
  id: string;
  name: string;
  locked?: boolean;
};

export type PlayerProfile = {
  uid?: string;
  email?: string | null;
  intbaId: string;
  name: string;
  avatarUrl?: string;
};

export type LobbyPlayer = PlayerProfile & {
  id: string;
  isHost: boolean;
  ready: boolean;
  score: number;
  joinedAt?: Timestamp;
  lastSeenAt?: Timestamp;
};

export type GameStatus = "lobby" | "playing" | "review";

export type GameRoom = {
  id: string;
  code: string;
  name: string;
  hostId: string;
  maxPlayers: number;
  answerTimeSec: number;
  allowAiValidation: boolean;
  categories: GameCategory[];
  status: GameStatus;
  currentRound: number;
  letter?: string | null;
  usedLetters: string[];
  scoredRound?: number | null;
  startedAt?: Timestamp | null;
  endsAt?: Timestamp | null;
  revealedAt?: Timestamp | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type AnswerCheck = {
  answer: string;
  valid: boolean;
  points: number;
  confidence: number;
  reason: string;
  source: "ai" | "rule" | "manual" | "pending";
};

export type RoundAnswerDoc = {
  accountId?: string;
  playerId: string;
  playerName: string;
  avatarUrl?: string;
  lockedAt?: Timestamp;
  answers: Record<string, AnswerCheck>;
};

export type RoomSettings = {
  name: string;
  maxPlayers: number;
  answerTimeSec: number;
  allowAiValidation: boolean;
  categories: GameCategory[];
};

export function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () =>
    alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}

export function createCategoryId(name: string) {
  return normalizeId(name) || `kat-${Date.now()}`;
}

export function normalizeId(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createPlayerId(intbaId: string) {
  return normalizeId(intbaId).slice(0, 64) || `player-${Date.now()}`;
}

export function clampPlayers(value: number) {
  return Math.min(12, Math.max(2, Math.round(value || 2)));
}

export function clampAnswerTime(value: number) {
  return Math.min(300, Math.max(20, Math.round(value || 60)));
}

export function drawLetter(usedLetters: string[] = []) {
  const available = POLISH_GAME_LETTERS.filter(
    (letter) => !usedLetters.includes(letter),
  );
  const pool = available.length > 0 ? available : POLISH_GAME_LETTERS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function emptyAnswers(categories: GameCategory[]) {
  return categories.reduce<Record<string, string>>((acc, category) => {
    acc[category.id] = "";
    return acc;
  }, {});
}
