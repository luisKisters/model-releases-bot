import type { SourceConfig, SourceRole } from "./types";

export const sourceRegistry: SourceConfig[] = [
  source("openai-news-rss", "OpenAI", "OpenAI news RSS", "https://openai.com/news/rss.xml", "rssAtom", "sendable"),

  source("anthropic-news", "Anthropic", "Anthropic news", "https://www.anthropic.com/news", "html", "discovery"),

  source("deepmind-rss", "Google Gemini", "Google DeepMind blog RSS", "https://deepmind.google/blog/rss.xml", "rssAtom", "sendable"),
  source(
    "google-gemini-blog-rss",
    "Google Gemini",
    "Google Gemini product blog RSS",
    "https://blog.google/products-and-platforms/products/gemini/rss/",
    "rssAtom",
    "sendable",
  ),
  source(
    "google-developers-gemini-feed",
    "Google Gemini",
    "Google Developers Gemini feed",
    "https://developers.googleblog.com/feeds/posts/default/-/Gemini/",
    "rssAtom",
    "sendable",
  ),

  source("mistral-rss", "Mistral", "Mistral RSS", "https://mistral.ai/rss.xml", "rssAtom", "sendable"),

  source("deepseek-news", "DeepSeek", "DeepSeek official news", "https://api-docs.deepseek.com/news/", "html", "discovery"),

  source("meta-ai-blog", "Meta Llama", "AI at Meta blog", "https://ai.meta.com/blog/", "html", "discovery"),

  source("xai-news", "xAI", "xAI news", "https://x.ai/news", "html", "discovery"),

  source(
    "nvidia-nemotron-feed",
    "NVIDIA Nemotron",
    "NVIDIA Nemotron research feed",
    "https://research.nvidia.com/labs/nemotron/feed.xml",
    "rssAtom",
    "sendable",
  ),
  source(
    "nvidia-nemotron-developer-blog",
    "NVIDIA Nemotron",
    "NVIDIA Nemotron developer blog tag",
    "https://developer.nvidia.com/blog/tag/nemotron/",
    "html",
    "discovery",
  ),

  source(
    "deepgram-changelog-rss",
    "Deepgram",
    "Deepgram changelog RSS",
    "https://developers.deepgram.com/changelog.rss",
    "rssAtom",
    "discovery",
  ),
  source("deepgram-blog", "Deepgram", "Deepgram blog", "https://deepgram.com/learn", "html", "discovery"),

  source(
    "elevenlabs-changelog-rss",
    "ElevenLabs",
    "ElevenLabs changelog RSS",
    "https://elevenlabs.io/docs/changelog.rss",
    "rssAtom",
    "discovery",
  ),
  source("elevenlabs-blog", "ElevenLabs", "ElevenLabs blog", "https://elevenlabs.io/blog", "html", "discovery"),

  source(
    "assemblyai-releases",
    "AssemblyAI",
    "AssemblyAI release collection",
    "https://www.assemblyai.com/collection/releases",
    "html",
    "discovery",
  ),
  source("assemblyai-blog", "AssemblyAI", "AssemblyAI blog", "https://www.assemblyai.com/blog", "html", "discovery"),
];

function source(
  sourceId: string,
  provider: string,
  label: string,
  url: string,
  parser: SourceConfig["parser"],
  sourceRole: SourceRole,
): SourceConfig {
  const notify = sourceRole === "sendable";
  return {
    sourceId,
    provider,
    label,
    url,
    parser,
    confidence: "official",
    signalType: "release_note",
    pollEveryMinutes: parser === "rssAtom" ? 5 : 15,
    enabled: true,
    notify,
    sourceRole,
  };
}
