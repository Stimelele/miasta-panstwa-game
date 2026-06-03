import { NextResponse } from "next/server";
import { createPlayerId } from "@/lib/game";

export const runtime = "nodejs";

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

type GitHubContentResponse = {
  sha?: string;
  message?: string;
  documentation_url?: string;
};

type FirebaseLookupResponse = {
  users?: Array<{
    localId: string;
    email?: string;
  }>;
  error?: {
    message?: string;
  };
};

async function verifyFirebaseToken(request: Request) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!apiKey || !token) {
    return null;
  }

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      },
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as FirebaseLookupResponse;
    return payload.users?.[0] || null;
  } catch {
    return null;
  }
}

async function githubRequest(
  url: string,
  token: string,
  init: RequestInit = {},
) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
}

async function readGitHubJson(response: Response) {
  try {
    return (await response.json()) as GitHubContentResponse;
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const firebaseUser = await verifyFirebaseToken(request);

  if (!firebaseUser?.localId) {
    return NextResponse.json(
      { error: "Sesja wygasla. Zaloguj sie ponownie i wyslij avatar." },
      { status: 401 },
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Nie udalo sie odczytac pliku z formularza." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  const intbaId = String(formData.get("intbaId") || "player");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Brak pliku profilowego." },
      { status: 400 },
    );
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Dozwolone sa tylko pliki JPG, PNG albo WEBP." },
      { status: 400 },
    );
  }

  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      { error: "Maksymalny rozmiar avatara po kompresji to 4 MB." },
      { status: 400 },
    );
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !owner || !repo) {
    return NextResponse.json(
      {
        error:
          "Upload do GitHuba wymaga env: GITHUB_TOKEN, GITHUB_OWNER i GITHUB_REPO.",
      },
      { status: 503 },
    );
  }

  const extension = ALLOWED_TYPES.get(file.type) || "png";
  const safeId = createPlayerId(firebaseUser.localId);
  const safeDisplayId = createPlayerId(intbaId);
  const path = `public/avatars/${safeId}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const existing = await githubRequest(
    `${baseUrl}?ref=${encodeURIComponent(branch)}`,
    token,
  );
  const existingPayload =
    existing.ok ? await readGitHubJson(existing) : null;
  const existingSha = existingPayload?.sha;

  if (!existing.ok && existing.status !== 404) {
    const errorPayload = await readGitHubJson(existing);
    return NextResponse.json(
      {
        error:
          errorPayload.message ||
          "Nie udalo sie sprawdzic poprzedniego avatara w GitHub.",
      },
      { status: 502 },
    );
  }

  const uploadedAt = Date.now();
  const upload = await githubRequest(baseUrl, token, {
    method: "PUT",
    body: JSON.stringify({
      message: existingSha
        ? `Update avatar for ${safeDisplayId}`
        : `Add avatar for ${safeDisplayId}`,
      branch,
      content: bytes.toString("base64"),
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });

  if (!upload.ok) {
    const errorPayload = await readGitHubJson(upload);
    return NextResponse.json(
      {
        error:
          errorPayload.message ||
          "GitHub odrzucil upload avatara. Sprawdz token i uprawnienia repo.",
      },
      { status: 502 },
    );
  }

  const baseAvatarUrl =
    process.env.NEXT_PUBLIC_GITHUB_AVATAR_BASE_URL ||
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const separator = baseAvatarUrl.includes("?") ? "&" : "?";
  const url = `${baseAvatarUrl}${separator}v=${uploadedAt}`;

  return NextResponse.json({
    path,
    url,
    size: file.size,
    updated: Boolean(existingSha),
  });
}
