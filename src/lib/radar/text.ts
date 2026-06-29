const MODEL_NAME_PATTERN =
  /\b(?:gpt[-\w.]*|claude[-\w.]*|gemini[-\w.]*|grok[-\w.]*|llama[-\w.]*|mistral[-\w.]*|mixtral[-\w.]*|deepseek[-\w.]*|qwen[\w.-]*|kimi[-\w.]*|moonshot[-\w.]*|command[-\w.]*|jamba[-\w.]*|sonar[-\w.]*|glm[-\w.]*|minimax[-\w.]*|mimo[-\w.]*|nemotron[-\w.]*)\b/gi;

export function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
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
  const matches = value.match(MODEL_NAME_PATTERN) ?? [];
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

export function normalizeModelName(provider: string, name: string): string {
  return `${provider}:${name}`.toLowerCase().replace(/[^a-z0-9:._-]+/g, "-");
}
