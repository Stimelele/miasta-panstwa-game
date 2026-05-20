"use client";

/* eslint-disable @next/next/no-img-element, react-hooks/set-state-in-effect */

import {
  Activity,
  BadgeCheck,
  Bot,
  BrainCircuit,
  Check,
  Copy,
  Crown,
  Dice5,
  Eye,
  Image as ImageIcon,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  Play,
  Settings2,
  ShieldCheck,
  Timer,
  Trash2,
  Upload,
  User,
  UserPlus,
  Users,
  Wand2,
  X,
} from "lucide-react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clampAnswerTime,
  clampPlayers,
  createCategoryId,
  createPlayerId,
  createRoomCode,
  DEFAULT_CATEGORIES,
  drawLetter,
  emptyAnswers,
  GAME_COLLECTION,
  type AnswerCheck,
  type GameCategory,
  type GameRoom,
  type LobbyPlayer,
  type PlayerProfile,
  type RoomSettings,
  type RoundAnswerDoc,
} from "@/lib/game";
import {
  ensureAnonymousUser,
  getFirebaseClient,
  isFirebaseConfigured,
} from "@/lib/firebase";
import { ruleValidateAnswer } from "@/lib/validation";

const PROFILE_STORAGE_KEY = "panstwa-miasta-intba-session";
const GAME_DOC_ID = "panstwa-miasta";

const initialSettings: RoomSettings = {
  name: "INTBA Panstwa Miasta",
  maxPlayers: 8,
  answerTimeSec: 90,
  allowAiValidation: true,
  categories: DEFAULT_CATEGORIES,
};

function userRef(db: Firestore, playerId: string) {
  return doc(db, GAME_COLLECTION, "uzytkownicy", "lista", playerId);
}

function userGameRef(db: Firestore, playerId: string) {
  return doc(userRef(db, playerId), "gra", GAME_DOC_ID);
}

function roomRef(db: Firestore, code: string) {
  return doc(db, GAME_COLLECTION, "lobby", "pokoje", code.toUpperCase());
}

function playersRef(db: Firestore, code: string) {
  return collection(roomRef(db, code), "gracze");
}

function playerRef(db: Firestore, code: string, playerId: string) {
  return doc(playersRef(db, code), playerId);
}

function roundRef(db: Firestore, code: string, round: number) {
  return doc(roomRef(db, code), "rundy", String(round));
}

function answersRef(db: Firestore, code: string, round: number) {
  return collection(roundRef(db, code, round), "odpowiedzi");
}

function answerRef(
  db: Firestore,
  code: string,
  round: number,
  playerId: string,
) {
  return doc(answersRef(db, code, round), playerId);
}

function cleanCategories(categories: GameCategory[]) {
  return categories
    .map((category) => ({
      ...category,
      id: category.id || createCategoryId(category.name),
      name: category.name.trim(),
    }))
    .filter((category) => category.name.length > 0)
    .slice(0, 16);
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "I"
  );
}

function statusText(status: GameRoom["status"]) {
  if (status === "playing") {
    return "Runda trwa";
  }
  if (status === "review") {
    return "Odpowiedzi odsloniete";
  }
  return "Lobby";
}

export function GameShell() {
  const firebaseReady = isFirebaseConfigured();
  const [profile, setProfile] = useState<PlayerProfile>({
    intbaId: "",
    name: "",
  });
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [settings, setSettings] = useState<RoomSettings>(initialSettings);
  const [newCategory, setNewCategory] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [activeCode, setActiveCode] = useState("");
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [roundAnswers, setRoundAnswers] = useState<
    Record<string, RoundAnswerDoc>
  >({});
  const [myAnswers, setMyAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [status, setStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const revealRequestedRef = useRef(false);

  const playerId = useMemo(
    () => createPlayerId(profile.intbaId),
    [profile.intbaId],
  );
  const currentPlayer = players.find((player) => player.id === playerId);
  const isHost = Boolean(room && room.hostId === playerId);
  const isLocked = Boolean(currentPlayer?.ready);
  const allReady =
    players.length > 0 && players.every((player) => Boolean(player.ready));
  const roundTotals = useMemo(() => {
    return Object.values(roundAnswers).reduce<Record<string, number>>(
      (totals, answerDoc) => {
        totals[answerDoc.playerId] = Object.values(answerDoc.answers).reduce(
          (sum, answer) => sum + (answer.points || 0),
          0,
        );
        return totals;
      },
      {},
    );
  }, [roundAnswers]);

  const revealRoom = useCallback(
    async (force: boolean) => {
      if (!room || !firebaseReady || room.status !== "playing") {
        return;
      }

      if (!force && !allReady) {
        return;
      }

      const { db } = getFirebaseClient();
      await updateDoc(roomRef(db, room.code), {
        status: "review",
        revealedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
    [allReady, firebaseReady, room],
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!saved) {
      return;
    }

    try {
      const savedProfile = JSON.parse(saved) as PlayerProfile;
      if (savedProfile.intbaId && savedProfile.name) {
        setProfile(savedProfile);
        setIsAuthenticated(true);
        setStatus("Sesja INTBA ID przywrocona.");
      }
    } catch {
      window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!room || settingsDirty) {
      return;
    }

    setSettings({
      name: room.name,
      maxPlayers: room.maxPlayers,
      answerTimeSec: room.answerTimeSec,
      allowAiValidation: room.allowAiValidation,
      categories: room.categories?.length
        ? room.categories
        : DEFAULT_CATEGORIES,
    });
  }, [room, settingsDirty]);

  useEffect(() => {
    if (!firebaseReady || !activeCode) {
      return;
    }

    const { db } = getFirebaseClient();
    const roomUnsub = onSnapshot(roomRef(db, activeCode), (snapshot) => {
      if (!snapshot.exists()) {
        setRoom(null);
        setStatus("Ten pokoj juz nie istnieje.");
        return;
      }
      setRoom({ id: snapshot.id, ...snapshot.data() } as GameRoom);
    });

    const playersUnsub = onSnapshot(playersRef(db, activeCode), (snapshot) => {
      const nextPlayers = snapshot.docs
        .map((playerDoc) => ({
          id: playerDoc.id,
          ...playerDoc.data(),
        }))
        .sort((a, b) => {
          const left = a as LobbyPlayer;
          const right = b as LobbyPlayer;
          if (left.isHost !== right.isHost) {
            return left.isHost ? -1 : 1;
          }
          return left.name.localeCompare(right.name, "pl");
        }) as LobbyPlayer[];
      setPlayers(nextPlayers);
    });

    return () => {
      roomUnsub();
      playersUnsub();
    };
  }, [activeCode, firebaseReady]);

  useEffect(() => {
    if (!firebaseReady || !activeCode || !room?.currentRound) {
      setRoundAnswers({});
      return;
    }

    const { db } = getFirebaseClient();
    return onSnapshot(answersRef(db, activeCode, room.currentRound), (snap) => {
      const answers = snap.docs.reduce<Record<string, RoundAnswerDoc>>(
        (acc, answerDoc) => {
          acc[answerDoc.id] = answerDoc.data() as RoundAnswerDoc;
          return acc;
        },
        {},
      );
      setRoundAnswers(answers);
    });
  }, [activeCode, firebaseReady, room?.currentRound]);

  useEffect(() => {
    if (!firebaseReady || !activeCode || !room || !playerId) {
      return;
    }

    const { db } = getFirebaseClient();
    void setDoc(
      playerRef(db, activeCode, playerId),
      { lastSeenAt: serverTimestamp() },
      { merge: true },
    );
  }, [activeCode, firebaseReady, playerId, room]);

  useEffect(() => {
    revealRequestedRef.current = false;
    setMyAnswers(room?.categories ? emptyAnswers(room.categories) : {});
  }, [room?.currentRound, room?.letter, room?.status, room?.categories]);

  useEffect(() => {
    if (room?.status !== "playing" || !room.endsAt) {
      setTimeLeft(0);
      return;
    }

    const tick = () => {
      const endTime = room.endsAt?.toDate().getTime() || Date.now();
      const nextLeft = Math.ceil((endTime - Date.now()) / 1000);
      setTimeLeft(Math.max(0, nextLeft));

      if (nextLeft <= 0 && !revealRequestedRef.current) {
        revealRequestedRef.current = true;
        void revealRoom(true);
      }
    };

    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [room?.status, room?.endsAt, room?.code, revealRoom]);

  useEffect(() => {
    if (room?.status === "playing" && allReady && !revealRequestedRef.current) {
      revealRequestedRef.current = true;
      void revealRoom(false);
    }
  }, [allReady, room?.status, revealRoom]);

  function persistProfile(nextProfile: PlayerProfile) {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
    setProfile(nextProfile);
    setIsAuthenticated(true);
  }

  async function registerAccount() {
    const trimmedProfile = {
      ...profile,
      intbaId: profile.intbaId.trim(),
      name: profile.name.trim(),
    };

    if (!trimmedProfile.intbaId || !trimmedProfile.name) {
      setStatus("Do rejestracji podaj INTBA ID i nick.");
      return;
    }

    if (!firebaseReady) {
      setStatus("Firebase musi byc podpiety, zeby rejestrowac INTBA ID.");
      return;
    }

    setAuthBusy(true);
    try {
      const { db } = getFirebaseClient();
      await ensureAnonymousUser();
      const id = createPlayerId(trimmedProfile.intbaId);
      const existing = await getDoc(userRef(db, id));

      if (existing.exists()) {
        setStatus("Ten INTBA ID juz istnieje. Uzyj logowania.");
        setAuthMode("login");
        return;
      }

      await setDoc(userRef(db, id), {
        ...trimmedProfile,
        id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(
        userGameRef(db, id),
        {
          gameId: GAME_DOC_ID,
          stats: {
            totalScore: 0,
            roundsPlayed: 0,
            gamesCreated: 0,
            gamesJoined: 0,
            answersSubmitted: 0,
            loginCount: 1,
          },
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      persistProfile(trimmedProfile);
      setStatus("Konto INTBA ID utworzone. Mozesz grac.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Nie udalo sie.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function loginAccount() {
    const intbaId = profile.intbaId.trim();

    if (!intbaId) {
      setStatus("Podaj INTBA ID, zeby sie zalogowac.");
      return;
    }

    if (!firebaseReady) {
      setStatus("Firebase musi byc podpiety, zeby logowac INTBA ID.");
      return;
    }

    setAuthBusy(true);
    try {
      const { db } = getFirebaseClient();
      await ensureAnonymousUser();
      const id = createPlayerId(intbaId);
      const snapshot = await getDoc(userRef(db, id));

      if (!snapshot.exists()) {
        setStatus("Nie znaleziono INTBA ID. Zarejestruj konto.");
        setAuthMode("register");
        return;
      }

      const savedUser = snapshot.data() as PlayerProfile;
      const nextProfile = {
        intbaId: savedUser.intbaId || intbaId,
        name: savedUser.name || profile.name || intbaId,
        avatarUrl: savedUser.avatarUrl || "",
      };

      await setDoc(
        userGameRef(db, id),
        {
          gameId: GAME_DOC_ID,
          stats: {
            loginCount: increment(1),
          },
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      persistProfile(nextProfile);
      setStatus("Zalogowano przez INTBA ID.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Nie udalo sie.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function saveProfile(nextProfile = profile) {
    const trimmedProfile = {
      ...nextProfile,
      intbaId: nextProfile.intbaId.trim(),
      name: nextProfile.name.trim(),
    };

    if (!trimmedProfile.intbaId || !trimmedProfile.name) {
      setStatus("Podaj INTBA ID i nazwe gracza.");
      return null;
    }

    persistProfile(trimmedProfile);

    if (firebaseReady) {
      const { db } = getFirebaseClient();
      await ensureAnonymousUser();
      const id = createPlayerId(trimmedProfile.intbaId);
      await setDoc(
        userRef(db, id),
        {
          ...trimmedProfile,
          id,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await setDoc(
        userGameRef(db, id),
        {
          gameId: GAME_DOC_ID,
          lastProfileUpdateAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    setStatus("Profil INTBA zapisany.");
    return trimmedProfile;
  }

  function logoutAccount() {
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    setIsAuthenticated(false);
    setActiveCode("");
    setRoom(null);
    setPlayers([]);
    setRoundAnswers({});
    setProfile({ intbaId: "", name: "" });
    setStatus("Wylogowano z INTBA ID.");
  }

  async function createLobby() {
    if (!isAuthenticated) {
      setStatus("Najpierw zaloguj sie przez INTBA ID.");
      return;
    }

    const savedProfile = await saveProfile();
    if (!savedProfile) {
      return;
    }

    if (!firebaseReady) {
      setStatus("Dodaj Firebase config w .env.local, zeby stworzyc lobby.");
      return;
    }

    setIsBusy(true);
    try {
      const { db } = getFirebaseClient();
      await ensureAnonymousUser();
      const activePlayerId = createPlayerId(savedProfile.intbaId);
      const categories = cleanCategories(settings.categories);
      let code = createRoomCode();
      let ref = roomRef(db, code);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const existing = await getDoc(ref);
        if (!existing.exists()) {
          break;
        }
        code = createRoomCode();
        ref = roomRef(db, code);
      }

      await setDoc(ref, {
        code,
        name: settings.name.trim() || "Panstwa Miasta",
        hostId: activePlayerId,
        maxPlayers: clampPlayers(settings.maxPlayers),
        answerTimeSec: clampAnswerTime(settings.answerTimeSec),
        allowAiValidation: settings.allowAiValidation,
        categories,
        status: "lobby",
        currentRound: 0,
        letter: null,
        usedLetters: [],
        scoredRound: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(playerRef(db, code, activePlayerId), {
        ...savedProfile,
        id: activePlayerId,
        isHost: true,
        ready: false,
        score: 0,
        joinedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      });

      await setDoc(
        userGameRef(db, activePlayerId),
        {
          currentLobby: code,
          stats: {
            gamesCreated: increment(1),
            gamesJoined: increment(1),
          },
          lastPlayedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setSettingsDirty(false);
      setActiveCode(code);
      setJoinCode(code);
      setStatus(`Lobby ${code} utworzone.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Nie udalo sie.");
    } finally {
      setIsBusy(false);
    }
  }

  async function joinLobby() {
    if (!isAuthenticated) {
      setStatus("Najpierw zaloguj sie przez INTBA ID.");
      return;
    }

    const savedProfile = await saveProfile();
    if (!savedProfile) {
      return;
    }

    if (!firebaseReady) {
      setStatus("Dodaj Firebase config w .env.local, zeby dolaczyc do lobby.");
      return;
    }

    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setStatus("Wpisz kod lobby.");
      return;
    }

    setIsBusy(true);
    try {
      const { db } = getFirebaseClient();
      await ensureAnonymousUser();
      const activePlayerId = createPlayerId(savedProfile.intbaId);
      const snapshot = await getDoc(roomRef(db, code));

      if (!snapshot.exists()) {
        setStatus("Nie znaleziono lobby o takim kodzie.");
        return;
      }

      const targetRoom = snapshot.data() as GameRoom;
      const roomPlayers = await getDocs(playersRef(db, code));
      const alreadyInRoom = roomPlayers.docs.some(
        (docSnap) => docSnap.id === activePlayerId,
      );

      if (!alreadyInRoom && roomPlayers.size >= targetRoom.maxPlayers) {
        setStatus("Lobby jest pelne.");
        return;
      }

      await setDoc(
        playerRef(db, code, activePlayerId),
        {
          ...savedProfile,
          id: activePlayerId,
          isHost: targetRoom.hostId === activePlayerId,
          ready: false,
          score: alreadyInRoom
            ? (roomPlayers.docs
                .find((docSnap) => docSnap.id === activePlayerId)
                ?.data().score as number | undefined) || 0
            : 0,
          joinedAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
        },
        { merge: true },
      );

      await setDoc(
        userGameRef(db, activePlayerId),
        {
          currentLobby: code,
          stats: {
            gamesJoined: increment(alreadyInRoom ? 0 : 1),
          },
          lastPlayedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setSettingsDirty(false);
      setActiveCode(code);
      setStatus(`Dolaczono do ${code}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Nie udalo sie.");
    } finally {
      setIsBusy(false);
    }
  }

  async function saveRoomSettings() {
    if (!room || !isHost || !firebaseReady) {
      return;
    }

    const { db } = getFirebaseClient();
    const nextCategories = cleanCategories(settings.categories);
    await updateDoc(roomRef(db, room.code), {
      name: settings.name.trim() || room.name,
      maxPlayers: clampPlayers(settings.maxPlayers),
      answerTimeSec: clampAnswerTime(settings.answerTimeSec),
      allowAiValidation: settings.allowAiValidation,
      categories: nextCategories,
      updatedAt: serverTimestamp(),
    });
    setSettings((current) => ({ ...current, categories: nextCategories }));
    setSettingsDirty(false);
    setStatus("Ustawienia lobby zapisane.");
  }

  function addCategory() {
    const name = newCategory.trim();
    if (!name) {
      return;
    }

    const nextCategory = { id: createCategoryId(name), name };
    setSettings((current) => ({
      ...current,
      categories: cleanCategories([...current.categories, nextCategory]),
    }));
    setSettingsDirty(true);
    setNewCategory("");
  }

  function removeCategory(id: string) {
    setSettings((current) => ({
      ...current,
      categories: current.categories.filter(
        (category) => category.id !== id || category.locked,
      ),
    }));
    setSettingsDirty(true);
  }

  async function scoreRoundIfNeeded() {
    if (
      !room ||
      !firebaseReady ||
      room.status !== "review" ||
      room.scoredRound === room.currentRound
    ) {
      return;
    }

    const { db } = getFirebaseClient();
    const batch = writeBatch(db);

    Object.values(roundAnswers).forEach((answerDoc) => {
      const points = Object.values(answerDoc.answers).reduce(
        (sum, answer) => sum + (answer.points || 0),
        0,
      );

      if (points > 0) {
        batch.update(playerRef(db, room.code, answerDoc.playerId), {
          score: increment(points),
        });
      }

      batch.set(
        userGameRef(db, answerDoc.playerId),
        {
          stats: {
            roundsPlayed: increment(1),
            totalScore: increment(points),
          },
          lastScore: points,
          lastRoundAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });

    batch.update(roomRef(db, room.code), {
      scoredRound: room.currentRound,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  }

  async function startRound() {
    if (!room || !isHost || !firebaseReady) {
      return;
    }

    setIsBusy(true);
    try {
      await scoreRoundIfNeeded();
      const { db } = getFirebaseClient();
      const nextRound = room.status === "lobby" ? 1 : room.currentRound + 1;
      const letter = drawLetter(room.usedLetters || []);
      const now = new Date();
      const endsAt = Timestamp.fromDate(
        new Date(now.getTime() + room.answerTimeSec * 1000),
      );
      const batch = writeBatch(db);

      players.forEach((player) => {
        batch.set(
          playerRef(db, room.code, player.id),
          { ready: false, lastSeenAt: serverTimestamp() },
          { merge: true },
        );
      });

      batch.set(
        roundRef(db, room.code, nextRound),
        {
          round: nextRound,
          letter,
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );
      batch.update(roomRef(db, room.code), {
        status: "playing",
        currentRound: nextRound,
        letter,
        usedLetters: [...(room.usedLetters || []), letter],
        startedAt: Timestamp.fromDate(now),
        endsAt,
        revealedAt: null,
        scoredRound: null,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setStatus(`Runda ${nextRound}: litera ${letter}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Nie udalo sie.");
    } finally {
      setIsBusy(false);
    }
  }

  async function validateAnswer(
    category: GameCategory,
    answer: string,
  ): Promise<AnswerCheck> {
    const fallback = ruleValidateAnswer(
      category.name,
      room?.letter || "",
      answer,
    );

    if (!room?.allowAiValidation) {
      return fallback;
    }

    try {
      const response = await fetch("/api/validate-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: category.name,
          letter: room.letter,
          answer,
        }),
      });

      if (!response.ok) {
        return fallback;
      }

      return (await response.json()) as AnswerCheck;
    } catch {
      return fallback;
    }
  }

  async function lockAnswers() {
    if (!room || !firebaseReady || room.status !== "playing") {
      return;
    }

    setIsBusy(true);
    try {
      const { db } = getFirebaseClient();
      const pendingAnswers = room.categories.reduce<Record<string, AnswerCheck>>(
        (acc, category) => {
          const answer = (myAnswers[category.id] || "").trim();
          acc[category.id] = answer
            ? {
                answer,
                valid: false,
                points: 0,
                confidence: 0,
                reason: "Czeka na sprawdzenie.",
                source: "pending",
              }
            : ruleValidateAnswer(category.name, room.letter || "", answer);
          return acc;
        },
        {},
      );

      await setDoc(
        answerRef(db, room.code, room.currentRound, playerId),
        {
          playerId,
          playerName: profile.name,
          avatarUrl: profile.avatarUrl || "",
          lockedAt: serverTimestamp(),
          answers: pendingAnswers,
        },
        { merge: true },
      );
      await updateDoc(playerRef(db, room.code, playerId), {
        ready: true,
        lastSeenAt: serverTimestamp(),
      });

      const checkedEntries = await Promise.all(
        room.categories.map(async (category) => [
          category.id,
          await validateAnswer(category, myAnswers[category.id] || ""),
        ]),
      );
      const checkedAnswers = Object.fromEntries(checkedEntries);

      await setDoc(
        answerRef(db, room.code, room.currentRound, playerId),
        { answers: checkedAnswers },
        { merge: true },
      );
      await setDoc(
        userGameRef(db, playerId),
        {
          stats: {
            answersSubmitted: increment(1),
          },
          lastSubmitAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setStatus("Odpowiedzi zapisane. Czekamy na reszte graczy.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Nie udalo sie.");
    } finally {
      setIsBusy(false);
    }
  }

  async function toggleAnswer(
    answerDoc: RoundAnswerDoc,
    categoryId: string,
    valid: boolean,
  ) {
    if (!room || !isHost || !firebaseReady) {
      return;
    }

    const { db } = getFirebaseClient();
    await updateDoc(answerRef(db, room.code, room.currentRound, answerDoc.playerId), {
      [`answers.${categoryId}.valid`]: valid,
      [`answers.${categoryId}.points`]: valid ? 10 : 0,
      [`answers.${categoryId}.confidence`]: 1,
      [`answers.${categoryId}.source`]: "manual",
      [`answers.${categoryId}.reason`]: valid
        ? "Host zaakceptowal odpowiedz recznie."
        : "Host odrzucil odpowiedz recznie.",
    });
  }

  async function leaveRoom() {
    if (!room || !firebaseReady) {
      setActiveCode("");
      return;
    }

    const { db } = getFirebaseClient();
    await deleteDoc(playerRef(db, room.code, playerId));
    await setDoc(
      userGameRef(db, playerId),
      {
        currentLobby: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    setActiveCode("");
    setRoom(null);
    setPlayers([]);
    setRoundAnswers({});
    setStatus("Opuszczono lobby.");
  }

  async function uploadAvatar(file: File | null) {
    if (!file) {
      return;
    }

    const savedProfile = await saveProfile();
    if (!savedProfile) {
      return;
    }

    setAvatarBusy(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("intbaId", savedProfile.intbaId);
      const response = await fetch("/api/avatar", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        url?: string;
        error?: string;
      };

      if (!response.ok || !payload.url) {
        setStatus(payload.error || "Nie udalo sie wyslac avatara.");
        return;
      }

      const nextProfile = { ...savedProfile, avatarUrl: payload.url };
      persistProfile(nextProfile);

      if (firebaseReady) {
        const { db } = getFirebaseClient();
        const activePlayerId = createPlayerId(nextProfile.intbaId);
        await setDoc(userRef(db, activePlayerId), nextProfile, { merge: true });
        await setDoc(
          userGameRef(db, activePlayerId),
          {
            avatarUpdatedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        if (activeCode) {
          await setDoc(playerRef(db, activeCode, activePlayerId), nextProfile, {
            merge: true,
          });
        }
      }

      setStatus("Avatar zapisany w repo GitHub.");
    } finally {
      setAvatarBusy(false);
    }
  }

  function copyCode() {
    if (!room?.code) {
      return;
    }
    void navigator.clipboard.writeText(room.code);
    setStatus("Kod lobby skopiowany.");
  }

  const authCopy =
    authMode === "login"
      ? "Zaloguj sie swoim INTBA ID. Profil i staty gry sa trzymane w tym samym uzytkowniku."
      : "Zarejestruj INTBA ID do Panstwa Miasta. Nie robimy osobnego konta gry.";

  return (
    <main className="intba-game-shell">
      <div className="intro-loader" aria-hidden="true">
        <div className="intro-loader-card">
          <img src="/intba-logo.svg" alt="" />
          <span>INTBA</span>
        </div>
      </div>

      <header className="topbar" aria-label="Nawigacja gry">
        <Link className="brand" href="/" aria-label="INTBA Panstwa Miasta">
          <span className="brand-mark">I</span>
          <span>INTBA</span>
        </Link>
        <nav className="nav-links" aria-label="Sekcje gry">
          <a href="#lobby">Lobby</a>
          <a href="#ustawienia">Ustawienia</a>
          <a href="#ranking">Gracze</a>
        </nav>
        <div className="topbar-user">
          {isAuthenticated ? (
            <>
              <span>{profile.name}</span>
              <button
                className="icon-button"
                type="button"
                onClick={logoutAccount}
                title="Wyloguj"
                aria-label="Wyloguj"
              >
                <LogOut />
              </button>
            </>
          ) : (
            <span>INTBA ID</span>
          )}
        </div>
      </header>

      {!isAuthenticated ? (
        <section className="auth-hero" id="login">
          <div className="signal-canvas" aria-hidden="true" />
          <div className="hero-content">
            <p className="eyebrow">Panstwa Miasta / INTBA ID</p>
            <h1>Najpierw INTBA ID, potem lobby i szybka runda.</h1>
            <p className="hero-copy">
              Konto gry jest podlaczone pod uzytkownika INTBA. W Firebase
              zapisujemy profil, gre, staty, avatar i ostatnie lobby pod jednym
              ID.
            </p>
            <div className="hero-stats">
              <div>
                <strong>12</strong>
                <span>osob w lobby</span>
              </div>
              <div>
                <strong>AI</strong>
                <span>sprawdzanie odpowiedzi</span>
              </div>
              <div>
                <strong>ID</strong>
                <span>wspolne statystyki</span>
              </div>
            </div>
          </div>

          <aside className="auth-card">
            <div className="auth-card-head">
              <User />
              <div>
                <h2>{authMode === "login" ? "Logowanie" : "Rejestracja"}</h2>
                <p>{authCopy}</p>
              </div>
            </div>

            <div className="segmented-control" aria-label="Tryb konta">
              <button
                type="button"
                className={authMode === "login" ? "active" : ""}
                onClick={() => setAuthMode("login")}
              >
                <LogIn /> Login
              </button>
              <button
                type="button"
                className={authMode === "register" ? "active" : ""}
                onClick={() => setAuthMode("register")}
              >
                <UserPlus /> Rejestruj
              </button>
            </div>

            <label htmlFor="authIntbaId">INTBA ID</label>
            <input
              id="authIntbaId"
              value={profile.intbaId}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  intbaId: event.target.value,
                }))
              }
              placeholder="np. intba_123"
              autoComplete="username"
            />

            {authMode === "register" ? (
              <label htmlFor="authNick">
                Nick w grze
                <input
                  id="authNick"
                  value={profile.name}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Twoj nick"
                />
              </label>
            ) : null}

            <button
              className="primary-action wide-action"
              type="button"
              onClick={() =>
                authMode === "login"
                  ? void loginAccount()
                  : void registerAccount()
              }
              disabled={authBusy}
            >
              {authBusy ? (
                <Loader2 className="spin-icon" />
              ) : authMode === "login" ? (
                <LogIn />
              ) : (
                <UserPlus />
              )}
              {authMode === "login" ? "Zaloguj INTBA ID" : "Utworz INTBA ID"}
            </button>

            <pre className="json-hint">{`${GAME_COLLECTION}/uzytkownicy/lista/{INTBA_ID}
  gra/${GAME_DOC_ID}
  stats.totalScore
  stats.roundsPlayed`}</pre>
            <p className="status-message">{status || "Czekam na INTBA ID."}</p>
          </aside>
        </section>
      ) : (
        <>
          <section className="game-hero">
            <div className="signal-canvas" aria-hidden="true" />
            <div className="hero-content">
              <p className="eyebrow">INTBA game room</p>
              <h1>Panstwa Miasta w stylu INTBA.</h1>
              <p className="hero-copy">
                Lobby, gotowosc graczy, losowana litera, kategorie hosta,
                timer, avatar z GitHuba i sprawdzanie odpowiedzi przez AI.
              </p>
              <div className="hero-actions">
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => void createLobby()}
                  disabled={isBusy || !firebaseReady}
                >
                  {isBusy ? <Loader2 className="spin-icon" /> : <Play />}
                  Stworz lobby
                </button>
                <a className="secondary-action" href="#lobby">
                  <Users /> Dolacz kodem
                </a>
              </div>
            </div>
            <aside className="hero-console" aria-label="Podglad statusu">
              <div className="console-header">
                <span />
                <span />
                <span />
              </div>
              <div className="console-line">
                <span className="muted">$ intba game status</span>
                <strong>{room ? statusText(room.status) : "ready"}</strong>
              </div>
              <div className="console-card">
                <Bot />
                <div>
                  <span>INTBA ID</span>
                  <p>{profile.name} / {profile.intbaId}</p>
                </div>
              </div>
              <div className="console-card">
                <BrainCircuit />
                <div>
                  <span>AI validation</span>
                  <p>{room?.allowAiValidation ? "Aktywne" : "Opcjonalne"}</p>
                </div>
              </div>
            </aside>
          </section>

          <section className="game-workspace" id="lobby">
            <aside className="side-stack">
              <section className="panel-card">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">Konto</p>
                    <h2>Profil INTBA</h2>
                  </div>
                  <BadgeCheck />
                </div>
                <div className="profile-row">
                  <div className="avatar-preview">
                    {profile.avatarUrl ? (
                      <img src={profile.avatarUrl} alt="" />
                    ) : (
                      getInitials(profile.name || "INTBA")
                    )}
                  </div>
                  <label className="secondary-action avatar-upload">
                    {avatarBusy ? <Loader2 className="spin-icon" /> : <Upload />}
                    Avatar
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) =>
                        uploadAvatar(event.target.files?.[0] || null)
                      }
                    />
                  </label>
                </div>
                <label htmlFor="profileNick">Nick</label>
                <input
                  id="profileNick"
                  value={profile.name}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Nick w grze"
                />
                <button
                  className="secondary-action wide-action"
                  type="button"
                  onClick={() => void saveProfile()}
                >
                  <Check /> Zapisz profil
                </button>
              </section>

              <section className="panel-card" id="ustawienia">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">Host</p>
                    <h2>Ustawienia</h2>
                  </div>
                  <Settings2 />
                </div>
                <label htmlFor="roomName">Nazwa lobby</label>
                <input
                  id="roomName"
                  value={settings.name}
                  onChange={(event) => {
                    setSettings((current) => ({
                      ...current,
                      name: event.target.value,
                    }));
                    setSettingsDirty(true);
                  }}
                />
                <div className="form-grid-2">
                  <label htmlFor="maxPlayers">
                    Gracze
                    <input
                      id="maxPlayers"
                      type="number"
                      min={2}
                      max={12}
                      value={settings.maxPlayers}
                      onChange={(event) => {
                        setSettings((current) => ({
                          ...current,
                          maxPlayers: clampPlayers(Number(event.target.value)),
                        }));
                        setSettingsDirty(true);
                      }}
                    />
                  </label>
                  <label htmlFor="answerTime">
                    Czas
                    <input
                      id="answerTime"
                      type="number"
                      min={20}
                      max={300}
                      value={settings.answerTimeSec}
                      onChange={(event) => {
                        setSettings((current) => ({
                          ...current,
                          answerTimeSec: clampAnswerTime(
                            Number(event.target.value),
                          ),
                        }));
                        setSettingsDirty(true);
                      }}
                    />
                  </label>
                </div>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={settings.allowAiValidation}
                    onChange={(event) => {
                      setSettings((current) => ({
                        ...current,
                        allowAiValidation: event.target.checked,
                      }));
                      setSettingsDirty(true);
                    }}
                  />
                  <span>Sprawdzanie odpowiedzi przez AI</span>
                </label>
                {room && isHost && room.status === "lobby" ? (
                  <button
                    className="secondary-action wide-action"
                    type="button"
                    onClick={() => void saveRoomSettings()}
                  >
                    <Check /> Zapisz ustawienia lobby
                  </button>
                ) : null}
              </section>

              <section className="panel-card">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">Kategorie</p>
                    <h2>Tablica</h2>
                  </div>
                  <Wand2 />
                </div>
                <div className="category-list">
                  {settings.categories.map((category) => (
                    <span className="category-pill" key={category.id}>
                      {category.name}
                      <button
                        type="button"
                        onClick={() => removeCategory(category.id)}
                        disabled={category.locked}
                        title="Usun kategorie"
                      >
                        <X />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="inline-form">
                  <input
                    value={newCategory}
                    onChange={(event) => setNewCategory(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addCategory();
                      }
                    }}
                    placeholder="np. Film, marka, sport"
                  />
                  <button
                    className="icon-button"
                    type="button"
                    onClick={addCategory}
                    aria-label="Dodaj kategorie"
                  >
                    <Plus />
                  </button>
                </div>
              </section>
            </aside>

            <div className="main-stack">
              {!firebaseReady ? (
                <section className="system-alert">
                  <strong>Firebase nie jest podpiety.</strong> Lobby i INTBA ID
                  wymagaja configu Firebase w env.
                </section>
              ) : null}

              {!room ? (
                <section className="lobby-grid">
                  <article className="panel-card action-card">
                    <Users />
                    <h2>Stworz lobby</h2>
                    <p>
                      Kod pokoju, host, limit do 12 osob, kategorie i timer
                      zapisuja sie realtime w Firestore.
                    </p>
                    <button
                      className="primary-action wide-action"
                      type="button"
                      onClick={() => void createLobby()}
                      disabled={isBusy || !firebaseReady}
                    >
                      {isBusy ? <Loader2 className="spin-icon" /> : <Play />}
                      Utworz pokoj
                    </button>
                  </article>

                  <article className="panel-card action-card">
                    <LogIn />
                    <h2>Dolacz</h2>
                    <p>
                      Wpisz kod od hosta. Twoj profil, avatar i staty ida z
                      INTBA ID.
                    </p>
                    <div className="join-row">
                      <input
                        value={joinCode}
                        onChange={(event) =>
                          setJoinCode(event.target.value.toUpperCase())
                        }
                        placeholder="KOD"
                        maxLength={6}
                      />
                      <button
                        className="primary-action"
                        type="button"
                        onClick={() => void joinLobby()}
                        disabled={isBusy || !firebaseReady}
                      >
                        <LogIn /> Wejdz
                      </button>
                    </div>
                  </article>
                </section>
              ) : (
                <section className="room-stack">
                  <div className="room-header panel-card">
                    <div>
                      <div className="room-meta">
                        <span>{statusText(room.status)}</span>
                        <span>{players.length}/{room.maxPlayers} graczy</span>
                        <span>{room.answerTimeSec}s</span>
                      </div>
                      <h2>{room.name}</h2>
                    </div>
                    <div className="room-actions">
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={copyCode}
                      >
                        <Copy /> {room.code}
                      </button>
                      <button
                        className="secondary-action danger-action"
                        type="button"
                        onClick={() => void leaveRoom()}
                      >
                        <Trash2 /> Wyjdz
                      </button>
                      {isHost ? (
                        <button
                          className="primary-action"
                          type="button"
                          onClick={() => void startRound()}
                          disabled={isBusy || players.length === 0}
                        >
                          {room.status === "review" ? <Dice5 /> : <Play />}
                          {room.status === "review" ? "Nastepna" : "Start"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="game-grid">
                    <section className="panel-card game-board">
                      {room.status === "lobby" ? (
                        <div className="empty-state">
                          <Dice5 />
                          <h2>Czekamy na start rundy</h2>
                          <p>
                            Host moze zmienic czas i kategorie. Po starcie
                            losujemy litere i blokujemy ustawienia rundy.
                          </p>
                        </div>
                      ) : null}

                      {room.status === "playing" ? (
                        <div className="answers-panel">
                          <div className="round-head">
                            <div className="round-letter">{room.letter}</div>
                            <div>
                              <p className="eyebrow">Runda {room.currentRound}</p>
                              <h2>Wpisz odpowiedzi</h2>
                            </div>
                            <div className="timer-badge">
                              <Timer /> {formatTime(timeLeft)}
                            </div>
                          </div>
                          <div className="answer-grid">
                            {room.categories.map((category) => (
                              <label key={category.id} className="answer-field">
                                {category.name}
                                <input
                                  value={myAnswers[category.id] || ""}
                                  disabled={isLocked}
                                  onChange={(event) =>
                                    setMyAnswers((current) => ({
                                      ...current,
                                      [category.id]: event.target.value,
                                    }))
                                  }
                                  placeholder={`${category.name} na ${room.letter}`}
                                />
                              </label>
                            ))}
                          </div>
                          <button
                            className="primary-action wide-action"
                            type="button"
                            onClick={() => void lockAnswers()}
                            disabled={isBusy || isLocked}
                          >
                            {isBusy ? (
                              <Loader2 className="spin-icon" />
                            ) : (
                              <Check />
                            )}
                            {isLocked ? "Gotowe wyslane" : "Gotowe"}
                          </button>
                        </div>
                      ) : null}

                      {room.status === "review" ? (
                        <div className="review-panel">
                          <div className="round-head">
                            <div>
                              <p className="eyebrow">Litera {room.letter}</p>
                              <h2><Eye /> Odpowiedzi</h2>
                            </div>
                            <span className="score-chip">
                              {room.scoredRound === room.currentRound
                                ? "Punkty zapisane"
                                : "Do zatwierdzenia w nastepnej rundzie"}
                            </span>
                          </div>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>Gracz</th>
                                  {room.categories.map((category) => (
                                    <th key={category.id}>{category.name}</th>
                                  ))}
                                  <th>Pkt</th>
                                </tr>
                              </thead>
                              <tbody>
                                {players.map((player) => {
                                  const answerDoc = roundAnswers[player.id];
                                  return (
                                    <tr key={player.id}>
                                      <td>
                                        <strong>{player.name}</strong>
                                        <small>{player.intbaId}</small>
                                      </td>
                                      {room.categories.map((category) => {
                                        const answer =
                                          answerDoc?.answers?.[category.id];
                                        return (
                                          <td key={category.id}>
                                            <strong>{answer?.answer || "-"}</strong>
                                            <span
                                              className={
                                                answer?.valid
                                                  ? "valid-chip"
                                                  : "invalid-chip"
                                              }
                                            >
                                              {answer?.valid ? "OK" : "0 pkt"}
                                            </span>
                                            <small>
                                              {answer?.reason ||
                                                "Brak odpowiedzi."}
                                            </small>
                                            {isHost && answerDoc ? (
                                              <div className="mini-actions">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void toggleAnswer(
                                                      answerDoc,
                                                      category.id,
                                                      true,
                                                    )
                                                  }
                                                  title="Uznaj odpowiedz"
                                                >
                                                  <Check />
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void toggleAnswer(
                                                      answerDoc,
                                                      category.id,
                                                      false,
                                                    )
                                                  }
                                                  title="Odrzuc odpowiedz"
                                                >
                                                  <X />
                                                </button>
                                              </div>
                                            ) : null}
                                          </td>
                                        );
                                      })}
                                      <td className="points-cell">
                                        {roundTotals[player.id] || 0}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                    </section>

                    <aside className="panel-card players-panel" id="ranking">
                      <div className="panel-head">
                        <div>
                          <p className="eyebrow">Ranking</p>
                          <h2>Gracze</h2>
                        </div>
                        <ShieldCheck />
                      </div>
                      <div className="players-list">
                        {players.map((player) => (
                          <div className="player-row" key={player.id}>
                            <div className="player-avatar">
                              {player.avatarUrl ? (
                                <img src={player.avatarUrl} alt="" />
                              ) : (
                                getInitials(player.name)
                              )}
                            </div>
                            <div>
                              <strong>
                                {player.name}
                                {player.isHost ? <Crown /> : null}
                              </strong>
                              <span>{player.score || 0} pkt lacznie</span>
                            </div>
                            <em className={player.ready ? "ready" : ""}>
                              {player.ready ? "Gotowy" : "Czeka"}
                            </em>
                          </div>
                        ))}
                      </div>
                    </aside>
                  </div>
                </section>
              )}

              <section className="status-bar">
                <div>
                  <Activity />
                  {status || "Gotowe do gry."}
                </div>
                <div>
                  <ImageIcon />
                  {GAME_COLLECTION}/uzytkownicy/lista/{playerId || "id"}
                </div>
              </section>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
