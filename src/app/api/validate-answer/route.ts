import { NextResponse } from "next/server";
import { ruleValidateAnswer } from "@/lib/validation";

export const runtime = "nodejs";

type ValidationRequest = {
  category?: string;
  letter?: string;
  answer?: string;
};

function extractOutputText(payload: unknown) {
  const data = payload as {
    output_text?: string;
    output?: Array<{
      content?: Array<{ text?: string; type?: string }>;
    }>;
  };

  if (data.output_text) {
    return data.output_text;
  }

  return (
    data.output
      ?.flatMap((item) => item.content || [])
      .map((content) => content.text)
      .find(Boolean) || ""
  );
}

function validationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      valid: { type: "boolean" },
      points: { type: "integer", minimum: 0, maximum: 10 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
      source: { type: "string", enum: ["ai"] },
    },
    required: ["answer", "valid", "points", "confidence", "reason", "source"],
  };
}

function parseAiResult(answer: string, outputText: string) {
  const parsed = JSON.parse(outputText);

  return {
    answer,
    valid: Boolean(parsed.valid),
    points: parsed.valid ? Number(parsed.points || 10) : 0,
    confidence: Number(parsed.confidence || 0.75),
    reason: String(parsed.reason || "Sprawdzone przez AI."),
    source: "ai",
  };
}

async function validateWithGroq(
  token: string,
  category: string,
  letter: string,
  answer: string,
) {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "openai/gpt-oss-20b",
        messages: [
          {
            role: "system",
            content:
              "Jestes sedzia w polskiej grze Panstwa Miasta. Odpowiadasz tylko poprawnym JSON zgodnym ze schematem.",
          },
          {
            role: "user",
            content: [
              `Kategoria: ${category}`,
              `Wylosowana litera: ${letter}`,
              `Odpowiedz gracza: ${answer}`,
              "Zasady: odpowiedz ma byc prawdziwa, pasowac do kategorii i zaczynac sie od litery. Polskie znaki traktuj normalnie, np. Lodz pasuje do L.",
            ].join("\n"),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "answer_validation",
            strict: true,
            schema: validationSchema(),
          },
        },
        max_completion_tokens: 220,
      }),
    },
  );

  if (!response.ok) {
    throw new Error("Groq validation failed.");
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const outputText = payload.choices?.[0]?.message?.content || "";
  return parseAiResult(answer, outputText);
}

async function validateWithOpenAi(
  token: string,
  category: string,
  letter: string,
  answer: string,
) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "gpt-5-mini",
      instructions:
        "Jestes sedzia w polskiej grze Panstwa Miasta. Oceniaj krotko i bez dodatkowego tekstu poza struktura JSON.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Kategoria: ${category}`,
                `Wylosowana litera: ${letter}`,
                `Odpowiedz gracza: ${answer}`,
                "Zasady: odpowiedz ma byc prawdziwa, pasowac do kategorii i zaczynac sie od litery. Polskie znaki traktuj normalnie, np. Lodz pasuje do L.",
              ].join("\n"),
            },
          ],
        },
      ],
      max_output_tokens: 220,
      text: {
        format: {
          type: "json_schema",
          name: "answer_validation",
          strict: true,
          schema: validationSchema(),
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error("OpenAI validation failed.");
  }

  const payload = await response.json();
  return parseAiResult(answer, extractOutputText(payload));
}

export async function POST(request: Request) {
  const body = (await request.json()) as ValidationRequest;
  const category = body.category?.trim() || "Nieznana kategoria";
  const letter = body.letter?.trim() || "";
  const answer = body.answer?.trim() || "";
  const fallback = ruleValidateAnswer(category, letter, answer);
  const token = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;

  if (!token || !answer || !fallback.valid) {
    return NextResponse.json(fallback);
  }

  try {
    const provider =
      process.env.AI_PROVIDER || (token.startsWith("gsk_") ? "groq" : "openai");
    const result =
      provider === "groq"
        ? await validateWithGroq(token, category, letter, answer)
        : await validateWithOpenAi(token, category, letter, answer);

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(fallback);
  }
}
