"use client";

/* eslint-disable @next/next/no-img-element, react-hooks/set-state-in-effect */

import {
  Activity,
  Check,
  Copy,
  Crown,
  Dice5,
  Eye,
  Loader2,
  LogIn,
  Plus,
  Play,
  Settings2,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  Upload,
  User,
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

const PROFILE_STORAGE_KEY = "panstwa-miasta-profile";

const initialSettings: RoomSettings = {
  name: "Wieczor Panstwa Miasta",
  maxPlayers: 8,
  answerTimeSec: 90,
  allowAiValidation: true,
  categories: DEFAULT_CATEGORIES,
};

function userRef(db: Firestore, playerId: string) {
  return doc(db, GAME_COLLECTION, "rejestr", "uzytkownicy", playerId);
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
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
    if (saved) {
      try {
        setProfile(JSON.parse(saved) as PlayerProfile);
      } catch {
        window.localStorage.removeItem(PROFILE_STORAGE_KEY);
      }
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

  async function saveProfile(nextProfile = profile) {
    const trimmedProfile = {
      ...nextProfile,
      intbaId: nextProfile.intbaId.trim(),
      name: nextProfile.name.trim(),
    };

    if (!trimmedProfile.intbaId || !trimmedProfile.name) {
      setStatus("Podaj INTBA ID i nazwe gracza.");
      return false;
    }

    window.localStorage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify(trimmedProfile),
    );
    setProfile(trimmedProfile);

    if (firebaseReady) {
      const { db } = getFirebaseClient();
      await ensureAnonymousUser();
      await setDoc(
        userRef(db, createPlayerId(trimmedProfile.intbaId)),
        {
          ...trimmedProfile,
          id: createPlayerId(trimmedProfile.intbaId),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    setStatus("Profil zapisany.");
    return true;
  }

  async function createLobby() {
    if (!(await saveProfile())) {
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
        hostId: playerId,
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

      await setDoc(playerRef(db, code, playerId), {
        ...profile,
        id: playerId,
        isHost: true,
        ready: false,
        score: 0,
        joinedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      });

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
    if (!(await saveProfile())) {
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
      const snapshot = await getDoc(roomRef(db, code));

      if (!snapshot.exists()) {
        setStatus("Nie znaleziono lobby o takim kodzie.");
        return;
      }

      const targetRoom = snapshot.data() as GameRoom;
      const roomPlayers = await getDocs(playersRef(db, code));
      const alreadyInRoom = roomPlayers.docs.some((docSnap) => docSnap.id === playerId);

      if (!alreadyInRoom && roomPlayers.size >= targetRoom.maxPlayers) {
        setStatus("Lobby jest pelne.");
        return;
      }

      await setDoc(
        playerRef(db, code, playerId),
        {
          ...profile,
          id: playerId,
          isHost: targetRoom.hostId === playerId,
          ready: false,
          score: alreadyInRoom
            ? (roomPlayers.docs
                .find((docSnap) => docSnap.id === playerId)
                ?.data().score as number | undefined) || 0
            : 0,
          joinedAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
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
    const fallback = ruleValidateAnswer(category.name, room?.letter || "", answer);

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

    if (!(await saveProfile())) {
      return;
    }

    setAvatarBusy(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("intbaId", profile.intbaId);
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

      const nextProfile = { ...profile, avatarUrl: payload.url };
      setProfile(nextProfile);
      window.localStorage.setItem(
        PROFILE_STORAGE_KEY,
        JSON.stringify(nextProfile),
      );

      if (firebaseReady) {
        const { db } = getFirebaseClient();
        await setDoc(userRef(db, playerId), nextProfile, { merge: true });
        if (activeCode) {
          await setDoc(playerRef(db, activeCode, playerId), nextProfile, {
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

  return (
    <main className="min-h-screen bg-[#f6f7f1] text-[#19211d]">
      <section className="border-b border-[#d4d8c8] bg-[#fdfdf8]">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-6 md:grid-cols-[1.1fr_0.9fr] md:px-8">
          <div className="flex min-w-0 flex-col justify-center gap-5">
            <div className="flex flex-wrap items-center gap-3 text-sm font-semibold uppercase tracking-[0.16em] text-[#4d6759]">
              <span>INTBA ID</span>
              <span className="h-1.5 w-1.5 rounded-full bg-[#d55138]" />
              <span>Panstwa Miasta online</span>
            </div>
            <div className="flex flex-col gap-3">
              <h1 className="text-4xl font-black leading-tight text-[#17201b] sm:text-5xl">
                Gra jak na kartce, tylko z lobby, timerem i sprawdzaniem AI.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-[#536057]">
                Stworz pokoj do 12 osob, wybierz kategorie, ustaw czas i
                losuj litere. Gracze klikaja gotowe, a po komplecie odpowiedzi
                automatycznie sie odslaniaja.
              </p>
            </div>
          </div>
          <div className="relative min-h-56 overflow-hidden rounded-[8px] border border-[#c9d0bf] bg-[#eaf0df] shadow-sm">
            <img
              src="/paper-cards.svg"
              alt=""
              className="h-full min-h-56 w-full object-cover"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-5 md:grid-cols-[340px_1fr] md:px-8">
        <aside className="flex flex-col gap-5">
          <section className="rounded-[8px] border border-[#d4d8c8] bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <User size={20} /> Profil gracza
              </h2>
              <span className="rounded-full bg-[#e6f0eb] px-3 py-1 text-xs font-bold text-[#2f6249]">
                INTBA
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-[#cfd7c8] bg-[#f1f4ea] text-lg font-black text-[#385845]">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  getInitials(profile.name || "PM")
                )}
              </div>
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[8px] border border-[#bac6b5] px-3 text-sm font-bold hover:bg-[#f6f7f1]">
                {avatarBusy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Avatar
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => uploadAvatar(event.target.files?.[0] || null)}
                />
              </label>
            </div>
            <label className="mt-4 block text-sm font-bold text-[#344138]">
              INTBA ID
              <input
                value={profile.intbaId}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    intbaId: event.target.value,
                  }))
                }
                className="mt-1 h-11 w-full rounded-[8px] border border-[#cbd3c3] px-3 outline-none focus:border-[#2f6249]"
                placeholder="np. intba_123"
              />
            </label>
            <label className="mt-3 block text-sm font-bold text-[#344138]">
              Nazwa w grze
              <input
                value={profile.name}
                onChange={(event) =>
                  setProfile((current) => ({ ...current, name: event.target.value }))
                }
                className="mt-1 h-11 w-full rounded-[8px] border border-[#cbd3c3] px-3 outline-none focus:border-[#2f6249]"
                placeholder="Twoj nick"
              />
            </label>
            <button
              type="button"
              onClick={() => void saveProfile()}
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[8px] bg-[#23352c] px-4 text-sm font-black text-white hover:bg-[#2f4c3d]"
            >
              <Check size={17} /> Zapisz profil
            </button>
          </section>

          <section className="rounded-[8px] border border-[#d4d8c8] bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Settings2 size={20} /> Ustawienia
              </h2>
              <span className="text-xs font-bold text-[#6b756d]">
                max 12 osob
              </span>
            </div>
            <label className="block text-sm font-bold text-[#344138]">
              Nazwa lobby
              <input
                value={settings.name}
                onChange={(event) => {
                  setSettings((current) => ({
                    ...current,
                    name: event.target.value,
                  }));
                  setSettingsDirty(true);
                }}
                className="mt-1 h-11 w-full rounded-[8px] border border-[#cbd3c3] px-3 outline-none focus:border-[#2f6249]"
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-sm font-bold text-[#344138]">
                Gracze
                <input
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
                  className="mt-1 h-11 w-full rounded-[8px] border border-[#cbd3c3] px-3 outline-none focus:border-[#2f6249]"
                />
              </label>
              <label className="block text-sm font-bold text-[#344138]">
                Czas
                <input
                  type="number"
                  min={20}
                  max={300}
                  value={settings.answerTimeSec}
                  onChange={(event) => {
                    setSettings((current) => ({
                      ...current,
                      answerTimeSec: clampAnswerTime(Number(event.target.value)),
                    }));
                    setSettingsDirty(true);
                  }}
                  className="mt-1 h-11 w-full rounded-[8px] border border-[#cbd3c3] px-3 outline-none focus:border-[#2f6249]"
                />
              </label>
            </div>
            <label className="mt-4 flex cursor-pointer items-center justify-between rounded-[8px] border border-[#cbd3c3] p-3 text-sm font-bold">
              <span className="flex items-center gap-2">
                <Sparkles size={17} /> Sprawdzanie AI
              </span>
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
                className="h-5 w-5 accent-[#d55138]"
              />
            </label>
          </section>

          <section className="rounded-[8px] border border-[#d4d8c8] bg-white p-4 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
              <Wand2 size={20} /> Kategorie
            </h2>
            <div className="flex flex-wrap gap-2">
              {settings.categories.map((category) => (
                <span
                  key={category.id}
                  className="inline-flex items-center gap-2 rounded-full border border-[#cbd3c3] bg-[#f8faf4] px-3 py-1 text-sm font-bold"
                >
                  {category.name}
                  <button
                    type="button"
                    onClick={() => removeCategory(category.id)}
                    disabled={category.locked}
                    title={
                      category.locked
                        ? "Tej kategorii nie usuwamy"
                        : "Usun kategorie"
                    }
                    className="grid h-5 w-5 place-items-center rounded-full hover:bg-[#ead4cf] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <input
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCategory();
                  }
                }}
                className="h-11 min-w-0 flex-1 rounded-[8px] border border-[#cbd3c3] px-3 outline-none focus:border-[#2f6249]"
                placeholder="np. Film, marka, sport"
              />
              <button
                type="button"
                onClick={addCategory}
                title="Dodaj kategorie"
                className="grid h-11 w-11 place-items-center rounded-[8px] bg-[#d55138] text-white hover:bg-[#bc422c]"
              >
                <Plus size={20} />
              </button>
            </div>
            {room && isHost && room.status === "lobby" ? (
              <button
                type="button"
                onClick={() => void saveRoomSettings()}
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-[#2f6249] px-4 text-sm font-black text-[#2f6249] hover:bg-[#e8f1ec]"
              >
                <Check size={17} /> Zapisz ustawienia lobby
              </button>
            ) : null}
          </section>
        </aside>

        <div className="flex flex-col gap-5">
          {!firebaseReady ? (
            <section className="rounded-[8px] border border-[#d8b66c] bg-[#fff8e6] p-4 text-sm leading-6 text-[#5b4720]">
              <strong>Firebase jeszcze nie jest podpiety.</strong> Dodaj pozniej
              config w `.env.local`; aplikacja jest gotowa na kolekcje
              `Panstwa Miasta Gra`, rejestr uzytkownikow, lobby, rundy i
              odpowiedzi.
            </section>
          ) : null}

          {!room ? (
            <section className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-[8px] border border-[#d4d8c8] bg-white p-5 shadow-sm">
                <h2 className="mb-2 flex items-center gap-2 text-2xl font-black">
                  <Users size={24} /> Stworz lobby
                </h2>
                <p className="mb-5 text-sm leading-6 text-[#59645d]">
                  Host ustawia limit graczy, czas, kategorie i tryb sprawdzania.
                </p>
                <button
                  type="button"
                  onClick={() => void createLobby()}
                  disabled={isBusy || !firebaseReady}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-[#23352c] px-5 text-sm font-black text-white hover:bg-[#2f4c3d] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isBusy ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
                  Utworz pokoj
                </button>
              </div>

              <div className="rounded-[8px] border border-[#d4d8c8] bg-white p-5 shadow-sm">
                <h2 className="mb-2 flex items-center gap-2 text-2xl font-black">
                  <LogIn size={24} /> Dolacz
                </h2>
                <p className="mb-5 text-sm leading-6 text-[#59645d]">
                  Wpisz kod od hosta i wskakuj do tej samej tablicy odpowiedzi.
                </p>
                <div className="flex gap-2">
                  <input
                    value={joinCode}
                    onChange={(event) =>
                      setJoinCode(event.target.value.toUpperCase())
                    }
                    className="h-12 min-w-0 flex-1 rounded-[8px] border border-[#cbd3c3] px-3 text-lg font-black tracking-[0.14em] outline-none focus:border-[#2f6249]"
                    placeholder="KOD"
                    maxLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => void joinLobby()}
                    disabled={isBusy || !firebaseReady}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-[#d55138] px-5 text-sm font-black text-white hover:bg-[#bc422c] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <LogIn size={18} /> Wejdz
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <section className="flex flex-col gap-5">
              <div className="rounded-[8px] border border-[#d4d8c8] bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-[#617066]">
                      <span className="rounded-full bg-[#eef3e9] px-3 py-1">
                        {statusText(room.status)}
                      </span>
                      <span>{players.length}/{room.maxPlayers} graczy</span>
                      <span>{room.answerTimeSec}s na odpowiedzi</span>
                    </div>
                    <h2 className="mt-2 text-3xl font-black">{room.name}</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={copyCode}
                      className="inline-flex h-11 items-center gap-2 rounded-[8px] border border-[#cbd3c3] px-4 text-sm font-black hover:bg-[#f6f7f1]"
                    >
                      <Copy size={17} /> {room.code}
                    </button>
                    <button
                      type="button"
                      onClick={() => void leaveRoom()}
                      className="inline-flex h-11 items-center gap-2 rounded-[8px] border border-[#dbc6bf] px-4 text-sm font-black text-[#9d3725] hover:bg-[#fff2ef]"
                    >
                      <Trash2 size={17} /> Wyjdz
                    </button>
                    {isHost ? (
                      <button
                        type="button"
                        onClick={() => void startRound()}
                        disabled={isBusy || players.length === 0}
                        className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-[#23352c] px-4 text-sm font-black text-white hover:bg-[#2f4c3d] disabled:opacity-50"
                      >
                        {room.status === "review" ? (
                          <Dice5 size={17} />
                        ) : (
                          <Play size={17} />
                        )}
                        {room.status === "review"
                          ? "Nastepna runda"
                          : "Start"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
                <section className="rounded-[8px] border border-[#d4d8c8] bg-white p-5 shadow-sm">
                  {room.status === "lobby" ? (
                    <div className="flex min-h-80 flex-col items-center justify-center gap-4 text-center">
                      <Dice5 size={54} className="text-[#d55138]" />
                      <div>
                        <h3 className="text-2xl font-black">
                          Czekamy na start rundy
                        </h3>
                        <p className="mt-2 max-w-xl text-sm leading-6 text-[#59645d]">
                          Host moze jeszcze zmienic kategorie i czas. Po
                          starcie zostanie wylosowana litera.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {room.status === "playing" ? (
                    <div className="flex flex-col gap-5">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1e6dc] pb-4">
                        <div className="flex items-center gap-3">
                          <div className="grid h-16 w-16 place-items-center rounded-[8px] bg-[#d55138] text-4xl font-black text-white">
                            {room.letter}
                          </div>
                          <div>
                            <h3 className="text-2xl font-black">
                              Runda {room.currentRound}
                            </h3>
                            <p className="text-sm font-bold text-[#59645d]">
                              Wpisz odpowiedzi i kliknij gotowe.
                            </p>
                          </div>
                        </div>
                        <div className="inline-flex h-12 items-center gap-2 rounded-[8px] border border-[#cbd3c3] px-4 text-xl font-black">
                          <Timer size={20} /> {formatTime(timeLeft)}
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        {room.categories.map((category) => (
                          <label
                            key={category.id}
                            className="block rounded-[8px] border border-[#e1e6dc] bg-[#fbfcf8] p-3"
                          >
                            <span className="text-sm font-black text-[#344138]">
                              {category.name}
                            </span>
                            <input
                              value={myAnswers[category.id] || ""}
                              disabled={isLocked}
                              onChange={(event) =>
                                setMyAnswers((current) => ({
                                  ...current,
                                  [category.id]: event.target.value,
                                }))
                              }
                              className="mt-2 h-11 w-full rounded-[8px] border border-[#cbd3c3] bg-white px-3 outline-none focus:border-[#2f6249] disabled:bg-[#edf0e8]"
                              placeholder={`${category.name} na ${room.letter}`}
                            />
                          </label>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => void lockAnswers()}
                        disabled={isBusy || isLocked}
                        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-[#d55138] px-5 text-sm font-black text-white hover:bg-[#bc422c] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                        {isLocked ? "Gotowe wyslane" : "Gotowe"}
                      </button>
                    </div>
                  ) : null}

                  {room.status === "review" ? (
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1e6dc] pb-4">
                        <div>
                          <h3 className="flex items-center gap-2 text-2xl font-black">
                            <Eye size={24} /> Odpowiedzi
                          </h3>
                          <p className="mt-1 text-sm font-bold text-[#59645d]">
                            Litera rundy: {room.letter}
                          </p>
                        </div>
                        <div className="rounded-[8px] bg-[#eaf3ec] px-4 py-2 text-sm font-black text-[#2f6249]">
                          {room.scoredRound === room.currentRound
                            ? "Punkty zapisane"
                            : "Punkty rundy widoczne ponizej"}
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[720px] border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-[#dfe5da] text-left">
                              <th className="py-3 pr-3 font-black">Gracz</th>
                              {room.categories.map((category) => (
                                <th key={category.id} className="px-3 py-3 font-black">
                                  {category.name}
                                </th>
                              ))}
                              <th className="py-3 pl-3 text-right font-black">
                                Punkty
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {players.map((player) => {
                              const answerDoc = roundAnswers[player.id];
                              return (
                                <tr key={player.id} className="border-b border-[#eef1ea] align-top">
                                  <td className="py-3 pr-3">
                                    <div className="font-black">{player.name}</div>
                                    <div className="text-xs text-[#6b756d]">
                                      {player.intbaId}
                                    </div>
                                  </td>
                                  {room.categories.map((category) => {
                                    const answer = answerDoc?.answers?.[category.id];
                                    return (
                                      <td key={category.id} className="px-3 py-3">
                                        <div className="font-bold">
                                          {answer?.answer || "-"}
                                        </div>
                                        <div
                                          className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-black ${
                                            answer?.valid
                                              ? "bg-[#e7f3e6] text-[#2f6249]"
                                              : "bg-[#ffe8e1] text-[#a33c28]"
                                          }`}
                                        >
                                          {answer?.valid ? "OK" : "0 pkt"}
                                        </div>
                                        <p className="mt-1 max-w-44 text-xs leading-5 text-[#667169]">
                                          {answer?.reason || "Brak odpowiedzi."}
                                        </p>
                                        {isHost && answerDoc ? (
                                          <div className="mt-2 flex gap-1">
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
                                              className="grid h-7 w-7 place-items-center rounded-[6px] border border-[#b7ceb9] text-[#2f6249] hover:bg-[#e7f3e6]"
                                            >
                                              <Check size={14} />
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
                                              className="grid h-7 w-7 place-items-center rounded-[6px] border border-[#e0b6ad] text-[#a33c28] hover:bg-[#ffe8e1]"
                                            >
                                              <X size={14} />
                                            </button>
                                          </div>
                                        ) : null}
                                      </td>
                                    );
                                  })}
                                  <td className="py-3 pl-3 text-right text-lg font-black">
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

                <aside className="rounded-[8px] border border-[#d4d8c8] bg-white p-4 shadow-sm">
                  <h3 className="mb-4 flex items-center gap-2 text-lg font-black">
                    <ShieldCheck size={20} /> Gracze
                  </h3>
                  <div className="flex flex-col gap-3">
                    {players.map((player) => (
                      <div
                        key={player.id}
                        className="flex items-center gap-3 rounded-[8px] border border-[#edf0e8] bg-[#fbfcf8] p-3"
                      >
                        <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#e8efe4] text-sm font-black text-[#385845]">
                          {player.avatarUrl ? (
                            <img
                              src={player.avatarUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            getInitials(player.name)
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1">
                            <span className="truncate font-black">
                              {player.name}
                            </span>
                            {player.isHost ? (
                              <Crown size={15} className="text-[#c89421]" />
                            ) : null}
                          </div>
                          <div className="text-xs text-[#6b756d]">
                            {player.score || 0} pkt lacznie
                          </div>
                        </div>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-black ${
                            player.ready
                              ? "bg-[#e7f3e6] text-[#2f6249]"
                              : "bg-[#eef1ea] text-[#6b756d]"
                          }`}
                        >
                          {player.ready ? "Gotowy" : "Czeka"}
                        </span>
                      </div>
                    ))}
                  </div>
                </aside>
              </div>
            </section>
          )}

          <section className="rounded-[8px] border border-[#d4d8c8] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="font-bold text-[#536057]">
                {status || "Gotowe do gry."}
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-[#6b756d]">
                <Activity size={16} />
                Firestore: {GAME_COLLECTION}
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
