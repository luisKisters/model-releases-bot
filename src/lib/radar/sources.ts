import type { SourceConfig } from "./types";

export const sourceRegistry: SourceConfig[] = [
  official("openai-api-changelog", "OpenAI", "OpenAI API changelog", "https://developers.openai.com/api/docs/changelog", "html"),
  official("openai-news-rss", "OpenAI", "OpenAI news RSS", "https://openai.com/news/rss.xml", "rssAtom"),
  official("anthropic-api-release-notes", "Anthropic", "Anthropic API release notes", "https://docs.anthropic.com/en/release-notes/api", "html"),
  official("anthropic-models", "Anthropic", "Claude model docs", "https://docs.anthropic.com/en/docs/about-claude/models/all-models", "html"),
  official("gemini-api-changelog", "Google Gemini", "Gemini API changelog", "https://ai.google.dev/gemini-api/docs/changelog.md.txt", "markdown"),
  official("deepmind-rss", "Google Gemini", "Google DeepMind blog", "https://deepmind.google/blog/", "html", "weak_page_change"),
  official("xai-release-notes", "xAI", "xAI developer release notes", "https://docs.x.ai/developers/release-notes", "html"),
  official("xai-models", "xAI", "xAI model docs", "https://docs.x.ai/developers/models", "html"),
  hf("meta-llama-hf", "Meta Llama", "meta-llama"),
  repo("meta-llama-repo", "Meta Llama", "Meta llama-models commits", "https://github.com/meta-llama/llama-models/commits/main.atom"),
  official("meta-ai-blog", "Meta Llama", "AI at Meta blog", "https://ai.meta.com/blog/", "html", "weak_page_change"),
  official("mistral-changelog", "Mistral", "Mistral changelog", "https://docs.mistral.ai/resources/changelogs/", "html"),
  official("mistral-rss", "Mistral", "Mistral RSS", "https://mistral.ai/rss.xml", "rssAtom"),
  hf("mistral-hf", "Mistral", "mistralai"),
  official("deepseek-updates", "DeepSeek", "DeepSeek API updates", "https://api-docs.deepseek.com/updates", "html"),
  hf("deepseek-hf", "DeepSeek", "deepseek-ai"),
  official("qwen-release-notes", "Qwen", "Alibaba Model Studio release notes", "https://www.alibabacloud.com/help/en/model-studio/model-release-notes", "html"),
  official("qwen-rss", "Qwen", "Qwen blog RSS", "https://qwenlm.github.io/blog/index.xml", "rssAtom"),
  hf("qwen-hf", "Qwen", "Qwen"),
  repo("qwen-github", "Qwen", "QwenLM GitHub activity", "https://github.com/QwenLM.atom"),
  official("kimi-changelog", "Kimi", "Kimi changelog", "https://platform.kimi.ai/blog/posts/changelog", "html"),
  hf("kimi-hf", "Kimi", "moonshotai"),
  official("cohere-changelog", "Cohere", "Cohere changelog Atom", "https://docs.cohere.com/changelog.atom", "rssAtom"),
  official("cohere-models", "Cohere", "Cohere model docs", "https://docs.cohere.com/docs/models", "html"),
  official("zai-release-notes", "Z.ai", "Z.ai release notes", "https://docs.z.ai/release-notes/new-released.md", "markdown"),
  official("zai-pricing", "Z.ai", "Z.ai pricing model matrix", "https://docs.z.ai/guides/overview/pricing.md", "markdown"),
  hf("zai-hf", "Z.ai", "zai-org"),
  repo("zai-github", "Z.ai", "Z.ai GitHub activity", "https://github.com/zai-org.atom"),
  official("minimax-release-notes", "MiniMax", "MiniMax model release notes", "https://platform.minimax.io/docs/release-notes/models.md", "markdown"),
  official("minimax-news", "MiniMax", "MiniMax news", "https://www.minimax.io/news", "html", "weak_page_change"),
  hf("minimax-hf", "MiniMax", "MiniMaxAI"),
  repo("minimax-github", "MiniMax", "MiniMax GitHub activity", "https://github.com/MiniMax-AI.atom"),
  official("mimo-model-release", "Xiaomi MiMo", "MiMo model release log", "https://mimo.mi.com/docs/en-US/updates/model", "html"),
  sitemap("mimo-sitemap", "Xiaomi MiMo", "MiMo sitemap", "https://mimo.mi.com/sitemap.xml", ["updates", "news", "price", "quick-start", "api"]),
  hf("mimo-hf", "Xiaomi MiMo", "XiaomiMiMo"),
  repo("mimo-github", "Xiaomi MiMo", "XiaomiMiMo GitHub activity", "https://github.com/XiaomiMiMo.atom"),
  catalog("nvidia-build", "NVIDIA", "NVIDIA build catalog", "https://build.nvidia.com/nvidia"),
  official("nvidia-nim-release-notes", "NVIDIA", "NVIDIA NIM LLM release notes", "https://docs.nvidia.com/nim/large-language-models/latest/release-notes.html", "html"),
  official("nvidia-nim-support", "NVIDIA", "NVIDIA NIM support matrix", "https://docs.nvidia.com/nim/large-language-models/latest/support-matrix.html", "html"),
  hf("nvidia-hf", "NVIDIA", "nvidia"),
  repo("nvidia-nemotron-github", "NVIDIA", "Nemotron GitHub commits", "https://github.com/NVIDIA-NeMo/Nemotron/commits/main.atom"),
  catalog("artificial-analysis-models", "Artificial Analysis", "Artificial Analysis models", "https://artificialanalysis.ai/models", "weak_page_change"),
  catalog("artificial-analysis-leaderboard", "Artificial Analysis", "Artificial Analysis leaderboard", "https://artificialanalysis.ai/leaderboards/models", "weak_page_change"),
  jsonCatalog("openrouter-models", "OpenRouter", "OpenRouter public models", "https://openrouter.ai/api/v1/models"),
  {
    sourceId: "huggingface-global-new",
    provider: "Hugging Face",
    label: "Hugging Face newest models",
    url: "https://huggingface.co/api/models?sort=createdAt&direction=-1&limit=25",
    parser: "huggingfaceOrg",
    confidence: "catalog_confirmation",
    signalType: "catalog",
    pollEveryMinutes: 15,
    enabled: true,
    notify: false,
  },
];

function official(
  sourceId: string,
  provider: string,
  label: string,
  url: string,
  parser: SourceConfig["parser"],
  confidence: SourceConfig["confidence"] = "official",
): SourceConfig {
  return {
    sourceId,
    provider,
    label,
    url,
    parser,
    confidence,
    signalType: "release_note",
    pollEveryMinutes: parser === "rssAtom" ? 5 : 10,
    enabled: true,
    notify: confidence !== "weak_page_change",
  };
}

function hf(sourceId: string, provider: string, org: string): SourceConfig {
  return {
    sourceId,
    provider,
    label: `${org} Hugging Face org`,
    url: `https://huggingface.co/api/models?author=${encodeURIComponent(org)}&sort=lastModified&direction=-1&limit=20`,
    parser: "huggingfaceOrg",
    confidence: "official_open_weights",
    signalType: "open_weights",
    pollEveryMinutes: 15,
    enabled: true,
    notify: true,
  };
}

function repo(sourceId: string, provider: string, label: string, url: string): SourceConfig {
  return {
    sourceId,
    provider,
    label,
    url,
    parser: "rssAtom",
    confidence: "weak_page_change",
    signalType: "repo_activity",
    pollEveryMinutes: 15,
    enabled: true,
    notify: false,
  };
}

function sitemap(sourceId: string, provider: string, label: string, url: string, urlIncludes: string[]): SourceConfig {
  return {
    sourceId,
    provider,
    label,
    url,
    parser: "sitemap",
    confidence: "weak_page_change",
    signalType: "page_change",
    pollEveryMinutes: 15,
    enabled: true,
    notify: false,
    urlIncludes,
  };
}

function catalog(
  sourceId: string,
  provider: string,
  label: string,
  url: string,
  confidence: SourceConfig["confidence"] = "catalog_confirmation",
): SourceConfig {
  return {
    sourceId,
    provider,
    label,
    url,
    parser: "html",
    confidence,
    signalType: "catalog",
    pollEveryMinutes: 15,
    enabled: true,
    notify: confidence !== "weak_page_change",
  };
}

function jsonCatalog(sourceId: string, provider: string, label: string, url: string): SourceConfig {
  return {
    sourceId,
    provider,
    label,
    url,
    parser: "jsonCatalog",
    confidence: "catalog_confirmation",
    signalType: "catalog",
    pollEveryMinutes: 15,
    enabled: true,
    notify: true,
  };
}
