import type { SourceConfig, SourceRole } from "./types";

export const sourceRegistry: SourceConfig[] = [
  source("openai-news-rss", "OpenAI", "OpenAI news RSS", "https://openai.com/news/rss.xml", "rssAtom", "sendable"),

  source("anthropic-news", "Anthropic", "Anthropic news", "https://www.anthropic.com/news", "html", "discovery"),
  source(
    "anthropic-engineering",
    "Anthropic",
    "Anthropic engineering blog",
    "https://www.anthropic.com/engineering",
    "html",
    "discovery",
  ),

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
    "google-developers-gemini-search",
    "Google Gemini",
    "Google Developers Gemini search",
    "https://developers.googleblog.com/en/search/?product_categories=Gemini",
    "html",
    "discovery",
  ),

  source("mistral-rss", "Mistral", "Mistral RSS", "https://mistral.ai/rss.xml", "rssAtom", "sendable"),

  source("deepseek-news", "DeepSeek", "DeepSeek official news", "https://api-docs.deepseek.com/news/", "html", "discovery"),

  source("meta-ai-blog", "Meta Llama", "AI at Meta blog", "https://ai.meta.com/blog/", "html", "discovery"),

  source("xai-news", "xAI", "xAI news", "https://x.ai/news", "html", "discovery"),

  source("qwen-rss", "Qwen", "Qwen blog RSS", "https://qwenlm.github.io/blog/index.xml", "rssAtom", "sendable"),
  source("qwen-blog", "Qwen", "Qwen blog", "https://qwen.ai/blog", "html", "discovery"),
  source(
    "qwen-model-studio-release-notes",
    "Qwen",
    "Alibaba Model Studio release notes",
    "https://www.alibabacloud.com/help/en/model-studio/model-release-notes",
    "html",
    "discovery",
  ),

  source("kimi-blog", "Kimi", "Kimi research blog", "https://www.kimi.com/blog/", "html", "discovery"),
  source("kimi-resources", "Kimi", "Kimi resources", "https://www.kimi.com/resources", "html", "discovery"),
  source("kimi-platform-blog", "Kimi", "Kimi platform blog", "https://platform.kimi.ai/blog", "html", "discovery"),

  source(
    "zai-docs-sitemap",
    "Z.ai",
    "Z.ai docs sitemap",
    "https://docs.z.ai/sitemap.xml",
    "sitemap",
    "discovery",
    ["/release-notes/", "/guides/llm/glm", "/guides/vlm/glm", "/guides/audio/glm", "/guides/image/glm"],
  ),
  source(
    "zai-release-notes",
    "Z.ai",
    "Z.ai release notes",
    "https://docs.z.ai/release-notes/new-released",
    "html",
    "discovery",
  ),

  source("minimax-news", "MiniMax", "MiniMax news", "https://www.minimax.io/news", "html", "discovery"),
  source("minimax-blog", "MiniMax", "MiniMax blog", "https://www.minimax.io/blog", "html", "discovery"),
  source(
    "minimax-model-release-notes",
    "MiniMax",
    "MiniMax model release notes",
    "https://platform.minimax.io/docs/release-notes/models",
    "html",
    "discovery",
  ),

  source("mimo-research-blog", "Xiaomi MiMo", "Xiaomi MiMo research blog", "https://mimo.xiaomi.com/", "html", "discovery"),
  source(
    "mimo-model-release",
    "Xiaomi MiMo",
    "Xiaomi MiMo model release log",
    "https://mimo.mi.com/docs/en-US/updates/model",
    "html",
    "discovery",
  ),

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
  urlIncludes?: string[],
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
    urlIncludes,
  };
}
