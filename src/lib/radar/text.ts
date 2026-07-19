const MODEL_NAME_PATTERNS = [
  /\bClaude\s+(?:(?:Sonnet|Opus|Haiku|Fable|Mythos)\s+\d+(?:\.\d+)?|(?:\d+(?:\.\d+)?\s+)?(?:Sonnet|Opus|Haiku))\b/gi,
  /\b(?:Sonnet|Opus|Haiku|Fable|Mythos)\s+\d+(?:\.\d+)?\b/gi,
  /\bMistral\s+(?:Small|Medium|Large|OCR|Embed|Saba|Nemo|Codestral|Voxtral)\s+\d+(?:\.\d+)?\b/gi,
  /\bKimi\s+K\d+(?:\.\d+)*(?:\s+(?:Code|Thinking|Instruct|Dev|Researcher|Audio|VL))?\b/gi,
  /\bMiniMax\s+M\d+(?:\.\d+)?\b/gi,
  /\bEleven\s+(?:(?:Flash|Multilingual|Turbo)\s+)?v?\d+(?:\.\d+)?\b/gi,
  /\b(?:Scribe|Nova|Aura|Universal|Conformer)\s*[- ]?\d+(?:\.\d+)?\b/gi,
  /\bCommand\s+[A-Z][A-Z0-9.+-]*\b/g,
  /\b(?:gpt[-\w.]*|claude[-\w.]*|gemini[-\w.]*|grok[-\w.]*|llama[-\w.]*|mistral[-\w.]*|mixtral[-\w.]*|deepseek[-\w.]*|qwen[\w.-]*|kimi[-\w.]*|moonshot[-\w.]*|command[-\w.]*|jamba[-\w.]*|sonar[-\w.]*|glm[-\w.]*|minimax[-\w.]*|mimo[-\w.]*|nemotron[-\w.]*)\b/gi,
];

export function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&rsquo;", "'")
    .replaceAll("&lsquo;", "'")
    .replaceAll("&apos;", "'");
}

export function stripTags(value: string): string {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function normalizeWhitespace(value: string): string {
  return decodeEntities(value.replace(/\s+/g, " ").trim());
}

export function extractModelNames(value: string): string[] {
  const matches = MODEL_NAME_PATTERNS.flatMap((pattern) => value.match(pattern) ?? []);
  const seen = new Set<string>();

  return matches
    .map((match) => match.replace(/[),.;:]+$/g, ""))
    .filter((match) => {
      const key = match.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

const LAB_MODEL_FILTERS: Record<string, RegExp> = {
  Anthropic: /\b(?:claude|sonnet|opus|haiku)\b/i,
  OpenAI: /\b(?:gpt|o\d|o\d-mini)\b/i,
  "Google Gemini": /\bgemini\b/i,
  Mistral: /\b(?:mistral|mixtral|codestral|voxtral|pixtral)\b/i,
  DeepSeek: /\bdeepseek\b/i,
  "Meta Llama": /\bllama\b/i,
  xAI: /\bgrok\b/i,
  Qwen: /\bqwen\b/i,
  Kimi: /\bkimi\b/i,
  "Z.ai": /\b(?:glm|z\.?ai)\b/i,
  MiniMax: /\b(?:minimax|hailuo|abab)\b/i,
  "Xiaomi MiMo": /\bmimo\b/i,
  "NVIDIA Nemotron": /\bnemotron\b/i,
  Deepgram: /\b(?:nova|aura|scribe)\b/i,
  ElevenLabs: /\b(?:eleven|turbo)\b/i,
  AssemblyAI: /\b(?:universal|conformer)\b/i,
  Cohere: /\bcommand\b/i,
};

function isLikelyModelArtifact(name: string): boolean {
  return (
    /\b(?:https?|www)\b/i.test(name) ||
    /\.(?:com|org|net|ai|pdf|html?)\b/i.test(name) ||
    /^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(name) ||
    /(?:^|[-_.])(?:ai|api|docs?|blog|github|huggingface)$/i.test(name)
  );
}

function removeGenericProviderNames(lab: string, names: string[]): string[] {
  const providerWords = lab
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1);

  if (names.length <= 1 || providerWords.length === 0) return names;

  return names.filter((name) => {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return !providerWords.includes(normalized);
  });
}

function removeParentModelNames(names: string[]): string[] {
  return names.filter((name) => {
    const normalized = name.toLowerCase().replace(/\s+/g, "-");
    return !names.some((other) => {
      const otherNormalized = other.toLowerCase().replace(/\s+/g, "-");
      return (
        otherNormalized !== normalized &&
        (otherNormalized.startsWith(`${normalized}-`) || otherNormalized.startsWith(`${normalized}_`)) &&
        otherNormalized.length > normalized.length + 1
      );
    });
  });
}

function removeKnownNonReleaseAliases(lab: string, names: string[]): string[] {
  if (
    lab === "DeepSeek" &&
    names.some((name) => /^deepseek[-_]?v\d/i.test(name))
  ) {
    return names.filter((name) => !/^deepseek-(?:chat|reasoner)$/i.test(name));
  }

  return names;
}

export function filterModelNamesForLab(lab: string, names: string[]): string[] {
  const labFilter = LAB_MODEL_FILTERS[lab];
  const seen = new Set<string>();

  const nonArtifacts = names
    .map((name) => name.replace(/[),.;:]+$/g, "").trim())
    .filter((name) => name.length > 0)
    .filter((name) => !isLikelyModelArtifact(name));

  const labScoped = labFilter
    ? nonArtifacts.filter((name) => labFilter.test(name))
    : nonArtifacts;

  const scoped = (labFilter && labScoped.length > 0 ? labScoped : nonArtifacts)
    .filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return removeKnownNonReleaseAliases(
    lab,
    removeParentModelNames(removeGenericProviderNames(lab, scoped)),
  ).slice(0, 8);
}

export function normalizeModelName(provider: string, name: string): string {
  return `${provider}:${name}`.toLowerCase().replace(/[^a-z0-9:._-]+/g, "-");
}
