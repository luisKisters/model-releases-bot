import type { SourceConfig } from "./types";

export const sourceRegistry: SourceConfig[] = [
  official("openai-news-rss", "OpenAI", "OpenAI news RSS", "https://openai.com/news/rss.xml", "rssAtom"),

  official("anthropic-news", "Anthropic", "Anthropic news", "https://www.anthropic.com/news", "html", false),

  official("deepmind-rss", "Google Gemini", "Google DeepMind blog RSS", "https://deepmind.google/blog/rss.xml", "rssAtom"),
  official(
    "google-gemini-blog-rss",
    "Google Gemini",
    "Google Gemini product blog RSS",
    "https://blog.google/products-and-platforms/products/gemini/rss/",
    "rssAtom",
  ),
  official(
    "google-developers-gemini-feed",
    "Google Gemini",
    "Google Developers Gemini feed",
    "https://developers.googleblog.com/feeds/posts/default/-/Gemini/",
    "rssAtom",
  ),

  official("mistral-rss", "Mistral", "Mistral RSS", "https://mistral.ai/rss.xml", "rssAtom"),

  official("deepseek-news", "DeepSeek", "DeepSeek official news", "https://api-docs.deepseek.com/news/", "html", false),

  official("meta-ai-blog", "Meta Llama", "AI at Meta blog", "https://ai.meta.com/blog/", "html", false),

  official("xai-news", "xAI", "xAI news", "https://x.ai/news", "html", false),

  official(
    "nvidia-nemotron-feed",
    "NVIDIA Nemotron",
    "NVIDIA Nemotron research feed",
    "https://research.nvidia.com/labs/nemotron/feed.xml",
    "rssAtom",
  ),
  official(
    "nvidia-nemotron-developer-blog",
    "NVIDIA Nemotron",
    "NVIDIA Nemotron developer blog tag",
    "https://developer.nvidia.com/blog/tag/nemotron/",
    "html",
    false,
  ),

  official(
    "deepgram-changelog-rss",
    "Deepgram",
    "Deepgram changelog RSS",
    "https://developers.deepgram.com/changelog.rss",
    "rssAtom",
    false,
  ),
  official("deepgram-blog", "Deepgram", "Deepgram blog", "https://deepgram.com/learn", "html", false),

  official(
    "elevenlabs-changelog-rss",
    "ElevenLabs",
    "ElevenLabs changelog RSS",
    "https://elevenlabs.io/docs/changelog.rss",
    "rssAtom",
    false,
  ),
  official("elevenlabs-blog", "ElevenLabs", "ElevenLabs blog", "https://elevenlabs.io/blog", "html", false),

  official(
    "assemblyai-releases",
    "AssemblyAI",
    "AssemblyAI release collection",
    "https://www.assemblyai.com/collection/releases",
    "html",
    false,
  ),
  official("assemblyai-blog", "AssemblyAI", "AssemblyAI blog", "https://www.assemblyai.com/blog", "html", false),
];

function official(
  sourceId: string,
  provider: string,
  label: string,
  url: string,
  parser: SourceConfig["parser"],
  notify = true,
): SourceConfig {
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
  };
}
