"use client";

/* eslint-disable @next/next/no-img-element, react-hooks/set-state-in-effect */

import {
  Activity,
  BadgeCheck,
  Bot,
  BrainCircuit,
  Camera,
  Check,
  Copy,
  Crown,
  Dice5,
  Eye,
  FileImage,
  IdCard,
  Image as ImageIcon,
  Loader2,
  LogIn,
  LogOut,
  Mail,
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
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
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
  getFirebaseClient,
  isFirebaseConfigured,
} from "@/lib/firebase";
import { ruleValidateAnswer } from "@/lib/validation";

const PROFILE_STORAGE_KEY = "panstwa-miasta-intba-session";
const GAME_DOC_ID = "panstwa-miasta";
const MAX_AVATAR_SOURCE_BYTES = 8 * 1024 * 1024;
const AVATAR_CANVAS_SIZE = 512;

const initialSettings: RoomSettings = {
  name: "INTBA Panstwa Miasta",
  maxPlayers: 8,
  answerTimeSec: 90,
  allowAiValidation: true,
  categories: DEFAULT_CATEGORIES,
};

function userRef(db: Firestore, accountId: string) {
  return doc(db, GAME_COLLECTION, "uzytkownicy", "lista", accountId);
}

function userGameRef(db: Firestore, accountId: string) {
  return doc(userRef(db, accountId), "gra", GAME_DOC_ID);
}

function intbaProfileRef(db: Firestore, intbaId: string) {
  return doc(
    db,
    GAME_COLLECTION,
    "intbaIds",
    "mapa",
    createPlayerId(intbaId),
  );
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

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Nie udalo sie odczytac obrazu."));
    };
    image.src = url;
  });
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function prepareAvatarFile(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Avatar musi byc plikiem JPG, PNG albo WEBP.");
  }

  if (file.size > MAX_AVATAR_SOURCE_BYTES) {
    throw new Error("Wybierz obraz do 8 MB. Duze zdjecia spowalniaja gre.");
  }

  const image = await readImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_CANVAS_SIZE;
  canvas.height = AVATAR_CANVAS_SIZE;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Przegladarka nie pozwolila przygotowac avatara.");
  }

  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_CANVAS_SIZE,
    AVATAR_CANVAS_SIZE,
  );

  const webpBlob = await canvasToBlob(canvas, "image/webp", 0.86);
  const blob = webpBlob || (await canvasToBlob(canvas, "image/jpeg", 0.88));

  if (!blob) {
    throw new Error("Nie udalo sie skompresowac avatara.");
  }

  const extension = blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], `avatar.${extension}`, {
    type: blob.type || "image/jpeg",
  });
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

function authMessage(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code)
      : "";

  if (code.includes("auth/email-already-in-use")) {
    return "Ten email jest juz zarejestrowany.";
  }
  if (code.includes("auth/invalid-credential")) {
    return "Niepoprawny email albo haslo.";
  }
  if (code.includes("auth/weak-password")) {
    return "Haslo musi miec minimum 6 znakow.";
  }
  if (code.includes("auth/invalid-email")) {
    return "Podaj poprawny adres email.";
  }
  if (code.includes("auth/operation-not-allowed")) {
    return "Wlacz Email/Password w Firebase Authentication.";
  }
  if (code.includes("permission-denied")) {
    return "Brak dostepu do Firestore. Sprawdz reguly Firebase i zaloguj sie ponownie.";
  }

  return error instanceof Error ? error.message : "Nie udalo sie zalogowac.";
}

export function GameShell() {
  const firebaseReady = isFirebaseConfigured();
  const [profile, setProfile] = useState<PlayerProfile>({
    intbaId: "",
    name: "",
  });
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
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
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [avatarHint, setAvatarHint] = useState(
    "JPG, PNG albo WEBP. Przycinamy do kwadratu 512 px.",
  );
  const [settingsDirty, setSettingsDirty] = useState(false);
  const revealRequestedRef = useRef(false);
  const profileRef = useRef(profile);

  const accountId = profile.uid || "";
  const playerId = useMemo(
    () => createPlayerId(profile.intbaId || profile.uid || profile.email || ""),
    [profile.email, profile.intbaId, profile.uid],
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
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  useEffect(() => {
    const saved = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!saved) {
      return;
    }

    try {
      const savedProfile = JSON.parse(saved) as PlayerProfile;
      if (savedProfile.email) {
        setAuthEmail(savedProfile.email);
      }
      if (savedProfile.intbaId || savedProfile.name) {
        setProfile(savedProfile);
        setStatus("Dane profilu INTBA wczytane.");
      }
    } catch {
      window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!firebaseReady) {
      return;
    }

    const { auth, db } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setIsAuthenticated(false);
        return;
      }

      const snapshot = await getDoc(userRef(db, user.uid));
      const savedUser = snapshot.exists()
        ? (snapshot.data() as PlayerProfile)
        : null;
      const currentProfile = profileRef.current;
      const nextProfile: PlayerProfile = {
        uid: user.uid,
        email: user.email,
        intbaId: savedUser?.intbaId || currentProfile.intbaId,
        name: savedUser?.name || user.displayName || currentProfile.name,
        avatarUrl: savedUser?.avatarUrl || currentProfile.avatarUrl || "",
      };

      window.localStorage.setItem(
        PROFILE_STORAGE_KEY,
        JSON.stringify(nextProfile),
      );
      setProfile(nextProfile);
      setAuthEmail(user.email || "");
      setIsAuthenticated(Boolean(nextProfile.intbaId && nextProfile.name));
      setStatus(
        nextProfile.intbaId && nextProfile.name
          ? "Zalogowano przez email i haslo."
          : "Konto Firebase zalogowane. Uzupelnij INTBA ID.",
      );
    });
  }, [firebaseReady]);

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
    setAuthEmail(nextProfile.email || "");
    setIsAuthenticated(Boolean(nextProfile.uid && nextProfile.intbaId));
  }

  async function registerAccount() {
    const trimmedProfile = {
      ...profile,
      intbaId: profile.intbaId.trim(),
      name: profile.name.trim(),
      email: authEmail.trim().toLowerCase(),
    };
    const password = authPassword.trim();

    if (!trimmedProfile.email || !password) {
      setStatus("Do rejestracji podaj email i haslo.");
      return;
    }

    if (!trimmedProfile.intbaId || !trimmedProfile.name) {
      setStatus("Do rejestracji podaj tez INTBA ID i nick.");
      return;
    }

    if (!firebaseReady) {
      setStatus("Firebase musi byc podpiety, zeby rejestrowac konto.");
      return;
    }

    setAuthBusy(true);
    try {
      const { auth, db } = getFirebaseClient();
      const intbaId = createPlayerId(trimmedProfile.intbaId);
      const currentUser = auth.currentUser;
      const reuseSignedInUser =
        currentUser?.email?.toLowerCase() === trimmedProfile.email;
      const accountUser = reuseSignedInUser
        ? currentUser
        : (
            await createUserWithEmailAndPassword(
              auth,
              trimmedProfile.email,
              password,
            )
          ).user;

      const existing = await getDoc(intbaProfileRef(db, trimmedProfile.intbaId));
      if (existing.exists() && existing.data().uid !== accountUser.uid) {
        if (!reuseSignedInUser) {
          await deleteUser(accountUser).catch(() => undefined);
        }
        setStatus("Ten INTBA ID juz istnieje. Uzyj logowania.");
        setAuthMode("login");
        return;
      }

      await updateProfile(accountUser, { displayName: trimmedProfile.name });
      const accountProfile: PlayerProfile = {
        ...trimmedProfile,
        uid: accountUser.uid,
        email: accountUser.email || trimmedProfile.email,
      };

      await setDoc(userRef(db, accountUser.uid), {
        ...accountProfile,
        id: accountUser.uid,
        playerId: intbaId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(intbaProfileRef(db, trimmedProfile.intbaId), {
        uid: accountUser.uid,
        intbaId: trimmedProfile.intbaId,
        email: trimmedProfile.email,
        createdAt: serverTimestamp(),
      });
      await setDoc(
        userGameRef(db, accountUser.uid),
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

      persistProfile(accountProfile);
      setStatus("Konto email + haslo gotowe. Mozesz grac.");
    } catch (error) {
      setStatus(authMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function loginAccount() {
    const email = authEmail.trim().toLowerCase();
    const password = authPassword.trim();

    if (!email || !password) {
      setStatus("Podaj email i haslo, zeby sie zalogowac.");
      return;
    }

    if (!firebaseReady) {
      setStatus("Firebase musi byc podpiety, zeby logowac konto.");
      return;
    }

    setAuthBusy(true);
    try {
      const { auth, db } = getFirebaseClient();
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const snapshot = await getDoc(userRef(db, credential.user.uid));

      if (!snapshot.exists()) {
        setStatus("Konto istnieje w Auth, ale nie ma profilu gry. Zarejestruj profil.");
        setAuthMode("register");
        return;
      }

      const savedUser = snapshot.data() as PlayerProfile;
      const nextProfile = {
        uid: credential.user.uid,
        email: credential.user.email,
        intbaId: savedUser.intbaId || "",
        name: savedUser.name || credential.user.displayName || email,
        avatarUrl: savedUser.avatarUrl || "",
      };

      await setDoc(
        userGameRef(db, credential.user.uid),
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
      setStatus("Zalogowano przez email i haslo.");
    } catch (error) {
      setStatus(authMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function saveProfile(
    nextProfile = profile,
    options: { silent?: boolean } = {},
  ) {
    const trimmedProfile = {
      ...nextProfile,
      intbaId: nextProfile.intbaId.trim(),
      name: nextProfile.name.trim(),
      email: nextProfile.email || authEmail.trim().toLowerCase(),
    };

    if (!trimmedProfile.uid) {
      setStatus("Najpierw zaloguj sie email + haslo.");
      return null;
    }

    if (!trimmedProfile.intbaId || !trimmedProfile.name) {
      setStatus("Podaj INTBA ID i nazwe gracza.");
      return null;
    }

    if (firebaseReady) {
      const { db } = getFirebaseClient();
      const playerSlug = createPlayerId(trimmedProfile.intbaId);
      const existing = await getDoc(intbaProfileRef(db, trimmedProfile.intbaId));

      if (existing.exists() && existing.data().uid !== trimmedProfile.uid) {
        setStatus("Ten INTBA ID jest juz zajety przez inne konto.");
        return null;
      }

      await setDoc(
        userRef(db, trimmedProfile.uid),
        {
          ...trimmedProfile,
          id: trimmedProfile.uid,
          playerId: playerSlug,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await setDoc(
        intbaProfileRef(db, trimmedProfile.intbaId),
        {
          uid: trimmedProfile.uid,
          intbaId: trimmedProfile.intbaId,
          email: trimmedProfile.email || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await setDoc(
        userGameRef(db, trimmedProfile.uid),
        {
          gameId: GAME_DOC_ID,
          lastProfileUpdateAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    persistProfile(trimmedProfile);
    if (!options.silent) {
      setStatus("Profil INTBA zapisany.");
    }
    return trimmedProfile;
  }

  async function logoutAccount() {
    if (firebaseReady) {
      const { auth } = getFirebaseClient();
      await signOut(auth);
    }
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    setIsAuthenticated(false);
    setActiveCode("");
    setRoom(null);
    setPlayers([]);
    setRoundAnswers({});
    setProfile({ intbaId: "", name: "" });
    setAuthPassword("");
    setStatus("Wylogowano z konta.");
  }

  async function createLobby() {
    if (!isAuthenticated) {
      setStatus("Najpierw zaloguj sie emailem i haslem.");
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
        userGameRef(db, savedProfile.uid || accountId),
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
      setStatus("Najpierw zaloguj sie emailem i haslem.");
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
        userGameRef(db, savedProfile.uid || accountId),
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
        userGameRef(db, answerDoc.accountId || answerDoc.playerId),
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
          accountId,
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
        userGameRef(db, accountId),
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
      userGameRef(db, accountId),
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

    setAvatarBusy(true);
    setAvatarHint("Przygotowuje obraz i przycinam go do kwadratu...");
    setStatus("Przygotowuje avatar do wyslania.");

    let preparedFile: File;
    let previewUrl = "";

    try {
      preparedFile = await prepareAvatarFile(file);
      previewUrl = URL.createObjectURL(preparedFile);
      setAvatarPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return previewUrl;
      });
      setAvatarHint(
        `Gotowy plik: ${formatFileSize(preparedFile.size)}. Wysylam do repo GitHub...`,
      );
    } catch (error) {
      setAvatarBusy(false);
      const message =
        error instanceof Error
          ? error.message
          : "Nie udalo sie przygotowac avatara.";
      setAvatarHint(message);
      setStatus(message);
      return;
    }

    const savedProfile = await saveProfile(profile, { silent: true });
    if (!savedProfile) {
      setAvatarHint("Najpierw uzupelnij i zapisz profil INTBA.");
      setAvatarBusy(false);
      return;
    }

    try {
      const { auth } = getFirebaseClient();
      const token = await auth.currentUser?.getIdToken();

      if (!token) {
        setAvatarHint("Sesja wygasla. Zaloguj sie ponownie.");
        setStatus("Sesja wygasla. Zaloguj sie ponownie.");
        return;
      }

      const formData = new FormData();
      formData.set("file", preparedFile);
      formData.set("intbaId", savedProfile.intbaId);
      const response = await fetch("/api/avatar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      const payload = (await response.json()) as {
        url?: string;
        error?: string;
        size?: number;
      };

      if (!response.ok || !payload.url) {
        const message = payload.error || "Nie udalo sie wyslac avatara.";
        setAvatarHint(message);
        setStatus(message);
        return;
      }

      const nextProfile = { ...savedProfile, avatarUrl: payload.url };
      persistProfile(nextProfile);

      if (firebaseReady) {
        const { db } = getFirebaseClient();
        const activePlayerId = createPlayerId(nextProfile.intbaId);
        await setDoc(userRef(db, nextProfile.uid || accountId), nextProfile, {
          merge: true,
        });
        await setDoc(
          userGameRef(db, nextProfile.uid || accountId),
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

      setAvatarHint(
        `Avatar zapisany. Rozmiar po kompresji: ${formatFileSize(
          payload.size || preparedFile.size,
        )}.`,
      );
      setStatus("Avatar zapisany w repo GitHub i ustawiony w profilu.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Nie udalo sie wyslac avatara.";
      setAvatarHint(message);
      setStatus(message);
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

  const avatarDisplayUrl = avatarPreviewUrl || profile.avatarUrl;
  const authCopy =
    authMode === "login"
      ? "Zaloguj sie emailem i haslem. INTBA ID zostaje profilem gracza i trzyma staty gry."
      : "Utworz konto email + haslo i przypisz do niego swoje INTBA ID.";

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
                onClick={() => void logoutAccount()}
                title="Wyloguj"
                aria-label="Wyloguj"
              >
                <LogOut />
              </button>
            </>
          ) : (
            <span>Email + haslo</span>
          )}
        </div>
      </header>

      {!isAuthenticated ? (
        <section className="auth-hero" id="login">
          <div className="signal-canvas" aria-hidden="true" />
          <div className="hero-content">
            <p className="eyebrow">Panstwa Miasta / Email + haslo</p>
            <h1>Najpierw konto, potem lobby i szybka runda.</h1>
            <p className="hero-copy">
              Logowanie dziala przez Firebase Email/Password. INTBA ID zostaje
              Twoim profilem w grze, a Firebase trzyma uzytkownika, staty,
              avatar i ostatnie lobby pod jednym UID.
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
                <strong>UID</strong>
                <span>profil i statystyki</span>
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

            <label htmlFor="authEmail">Email</label>
            <input
              id="authEmail"
              type="email"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              placeholder="kontakt@intba.dev"
              autoComplete="email"
            />

            <label htmlFor="authPassword">Haslo</label>
            <input
              id="authPassword"
              type="password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              placeholder="Minimum 6 znakow"
              autoComplete={
                authMode === "login" ? "current-password" : "new-password"
              }
            />

            {authMode === "register" ? (
              <>
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

                <label htmlFor="authNick">Nick w grze</label>
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
              </>
            ) : null}

            {authMode === "login" ? (
              <p className="status-message">
                Nie pamietasz INTBA ID? Wystarczy email i haslo, profil wczyta
                sie z Firebase.
              </p>
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
              {authMode === "login" ? "Zaloguj email + haslo" : "Utworz konto"}
            </button>

            <pre className="json-hint">{`${GAME_COLLECTION}/uzytkownicy/lista/{UID}
  intbaId
  gra/${GAME_DOC_ID}
  stats.totalScore
  stats.roundsPlayed`}</pre>
            <p className="status-message">{status || "Czekam na email i haslo."}</p>
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
                <div className="profile-hero">
                  <div className="avatar-preview">
                    {avatarDisplayUrl ? (
                      <img src={avatarDisplayUrl} alt="" />
                    ) : (
                      getInitials(profile.name || "INTBA")
                    )}
                    <span className="avatar-ring" aria-hidden="true" />
                  </div>
                  <div className="profile-identity">
                    <strong>{profile.name || "Gracz INTBA"}</strong>
                    <span>{profile.intbaId || "INTBA ID nieustawione"}</span>
                    <label
                      className={`secondary-action avatar-upload ${
                        avatarBusy ? "is-busy" : ""
                      }`}
                    >
                      {avatarBusy ? (
                        <Loader2 className="spin-icon" />
                      ) : (
                        <Camera />
                      )}
                      {avatarBusy ? "Wysylam..." : "Zmien avatar"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={avatarBusy}
                        onChange={(event) => {
                          const selectedFile = event.target.files?.[0] || null;
                          void uploadAvatar(selectedFile);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
                <p className="avatar-hint">
                  <FileImage /> {avatarHint}
                </p>
                <div className="profile-meta-grid" aria-label="Dane konta">
                  <div>
                    <Mail />
                    <span>Email</span>
                    <strong>{profile.email || authEmail || "Brak"}</strong>
                  </div>
                  <div>
                    <IdCard />
                    <span>INTBA ID</span>
                    <strong>{profile.intbaId || "Brak"}</strong>
                  </div>
                </div>
                <label htmlFor="profileNick">Nick w grze</label>
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
                <div className="control-row profile-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => void saveProfile()}
                    disabled={avatarBusy}
                  >
                    <Check /> Zapisz profil
                  </button>
                  <label className="secondary-action avatar-upload compact-upload">
                    {avatarBusy ? <Loader2 className="spin-icon" /> : <Upload />}
                    Upload
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={avatarBusy}
                      onChange={(event) => {
                        const selectedFile = event.target.files?.[0] || null;
                        void uploadAvatar(selectedFile);
                        event.target.value = "";
                      }}
                    />
                  </label>
                </div>
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
