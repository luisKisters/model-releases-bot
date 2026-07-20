import type { LlmRouter, CostTracker } from "./llm";
import { completeWithBudget } from "./llm";

// ─── Release classifier ─────────────────────────────────────────────────────
// AI gate that decides whether an article describes a genuinely new model (or
// model version) becoming available, as opposed to a feature launch,
// partnership, pricing change, research post, or availability/region
// announcement. Runs after article fetch, before any evidence-gathering LLM
// calls, so non-releases never reach the summarizers or the writer.

export type ReleaseClassifierInput = {
  title: string | null;
  articleText: string;
};

export type ReleaseClassifierOutput = {
  is_new_model_release: boolean;
  model_names: string[];
  reason: string;
};

export function buildReleaseClassifierEvidence(input: {
  title: string;
  articleBody?: string | null;
  summary?: string;
}): string {
  const extractedEvidence = [input.articleBody, input.summary]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n\n");

  // Some official announcement pages render their body only in the browser.
  // Their human-visible listing title is still valid evidence and should be
  // classified instead of presenting the model with an empty article.
  return extractedEvidence || input.title;
}

const ARTICLE_TEXT_CHAR_LIMIT = 2000;

const SYSTEM_PROMPT = `You are a conservative AI release classifier. Decide whether an article announces a NEW model or a new model VERSION becoming available.

"New model release" means: a new model or a new version of a model is being made available (e.g. launched, released, opened for API/product access).

NOT a release: feature launches, product integrations, partnerships, pricing changes, research papers/blog posts without a new model, region/availability expansion of an already-released model, deprecations, or minor product updates.

The article must name the specific new model or model version and explicitly say that model is newly launched, released, or becoming available. A generic family name such as "Gemini", "Claude", or "GPT" is not enough. Articles about ways to use an existing model, apps powered by a model, tutorials, product features, monthly roundups, and business/customer stories are NOT model releases. Mentions in a URL, navigation, comparison, or related-article list are not release evidence. If the evidence is missing or ambiguous, classify it as false.

Respond with STRICT JSON only, no prose, no markdown fences, matching exactly this shape:
{"is_new_model_release": boolean, "model_names": string[], "reason": string}

"model_names" lists the specific model name(s) mentioned, if any. "reason" is a one-sentence explanation of the decision.`;

function buildUserPrompt(input: ReleaseClassifierInput): string {
  const title = input.title ?? "Unknown";
  const text = input.articleText.slice(0, ARTICLE_TEXT_CHAR_LIMIT);
  return `Title: ${title}\n\nArticle text:\n${text}`;
}

function parseClassifierOutput(text: string): ReleaseClassifierOutput | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;

  if (typeof candidate.is_new_model_release !== "boolean") return null;
  if (!Array.isArray(candidate.model_names)) return null;
  if (typeof candidate.reason !== "string") return null;

  const modelNames = candidate.model_names
    .filter((n): n is string => typeof n === "string")
    .map((name) => name.trim())
    .filter(Boolean);

  if (candidate.is_new_model_release && modelNames.length === 0) {
    return {
      is_new_model_release: false,
      model_names: [],
      reason: "Classifier did not identify a specific newly released model; treated as not a release.",
    };
  }

  return {
    is_new_model_release: candidate.is_new_model_release,
    model_names: modelNames,
    reason: candidate.reason,
  };
}

export async function runReleaseClassifier(
  input: ReleaseClassifierInput,
  router: LlmRouter,
  tracker: CostTracker,
): Promise<ReleaseClassifierOutput> {
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: buildUserPrompt(input) },
  ];

  const firstAttempt = await completeWithBudget(router, tracker, "release_classifier", messages);
  const parsed = parseClassifierOutput(firstAttempt.text);
  if (parsed) return parsed;

  const retry = await completeWithBudget(router, tracker, "release_classifier", [
    ...messages,
    { role: "assistant" as const, content: firstAttempt.text },
    {
      role: "user" as const,
      content: "Your previous response was not valid JSON matching the required shape. Reply with ONLY the JSON object, no other text.",
    },
  ]);
  const retryParsed = parseClassifierOutput(retry.text);
  if (retryParsed) return retryParsed;

  return {
    is_new_model_release: false,
    model_names: [],
    reason: "Classifier output could not be parsed after retry; treated as not a release.",
  };
}
