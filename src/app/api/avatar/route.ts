import { NextResponse } from "next/server";
import { createPlayerId } from "@/lib/game";

export const runtime = "nodejs";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export async function POST(request: Request) {
  const formData = await request.formData();
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
      { error: "Maksymalny rozmiar avatara to 2 MB." },
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
  const safeId = createPlayerId(intbaId);
  const path = `public/avatars/${safeId}-${Date.now()}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const upload = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        message: `Add avatar for ${safeId}`,
        branch,
        content: bytes.toString("base64"),
      }),
    },
  );

  if (!upload.ok) {
    return NextResponse.json(
      { error: "GitHub odrzucil upload avatara." },
      { status: 502 },
    );
  }

  const url =
    process.env.NEXT_PUBLIC_GITHUB_AVATAR_BASE_URL ||
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;

  return NextResponse.json({ path, url });
}
