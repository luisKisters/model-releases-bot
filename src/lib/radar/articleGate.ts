import type { SourceConfig } from "./types";

export type ArticleGateCandidate = {
  provider: string;
  title: string;
  url?: string;
  source?: SourceConfig;
};

export type ArticleGateDecision = {
  shouldSend: boolean;
  reason: string;
  lab?: string;
};

type LabRule = {
  lab: string;
  providers: string[];
  hosts: string[];
  requiredText?: RegExp;
  rejectedHosts?: string[];
  rejectedPath?: RegExp;
};

const LAB_RULES: LabRule[] = [
  {
    lab: "OpenAI",
    providers: ["OpenAI"],
    hosts: ["openai.com"],
  },
  {
    lab: "Anthropic",
    providers: ["Anthropic"],
    hosts: ["anthropic.com", "www.anthropic.com"],
  },
  {
    lab: "Google Gemini",
    providers: ["Google Gemini"],
    hosts: ["blog.google", "deepmind.google", "developers.googleblog.com"],
    rejectedHosts: ["ai.google.dev", "openrouter.ai"],
  },
  {
    lab: "Mistral",
    providers: ["Mistral"],
    hosts: ["mistral.ai"],
  },
  {
    lab: "DeepSeek",
    providers: ["DeepSeek"],
    hosts: ["api-docs.deepseek.com", "deepseek.com"],
  },
  {
    lab: "Meta Llama",
    providers: ["Meta Llama"],
    hosts: ["ai.meta.com"],
    requiredText: /llama/i,
  },
  {
    lab: "xAI",
    providers: ["xAI"],
    hosts: ["x.ai"],
  },
  {
    lab: "NVIDIA Nemotron",
    providers: ["NVIDIA Nemotron", "NVIDIA"],
    hosts: ["research.nvidia.com", "developer.nvidia.com"],
    requiredText: /nemotron/i,
  },
  {
    lab: "Deepgram",
    providers: ["Deepgram"],
    hosts: ["deepgram.com", "www.deepgram.com", "developers.deepgram.com"],
    rejectedPath: /^\/changelog\/?$/i,
  },
  {
    lab: "ElevenLabs",
    providers: ["ElevenLabs"],
    hosts: ["elevenlabs.io", "www.elevenlabs.io"],
    rejectedPath: /^\/docs\/changelog\/?$/i,
  },
  {
    lab: "AssemblyAI",
    providers: ["AssemblyAI"],
    hosts: ["assemblyai.com", "www.assemblyai.com"],
    rejectedPath: /^\/changelog\/?$/i,
  },
];

const MODEL_RELEASE_TEXT =
  /model|release|released|launch|launched|introducing|introduce|announc|available|gpt|claude|gemini|llama|mistral|deepseek|grok|nemotron|nova|aura|scribe|universal|conformer|eleven\s*v/i;

const GENERIC_SOURCE_PATH =
  /^\/?$|^\/news\/?$|^\/blog\/?$|\/rss\.xml$|\/index\.xml$|\/feed(?:\/|\.xml)?$|\/models\/?$|\/docs\/models\/?$/i;

export function identifyProviderForUrl(url: string): string | null {
  const parsedUrl = parseUrl(url);
  if (!parsedUrl) {
    return null;
  }

  const rule = LAB_RULES.find((entry) =>
    entry.hosts.some((host) => hostMatches(parsedUrl.hostname, host)),
  );

  return rule?.providers[0] ?? null;
}

export function evaluateArticleGate(candidate: ArticleGateCandidate): ArticleGateDecision {
  const provider = candidate.source?.provider ?? candidate.provider;
  const rule = LAB_RULES.find((entry) => entry.providers.includes(provider));

  if (!rule) {
    return { shouldSend: false, reason: "unselected_lab" };
  }

  const url = candidate.url ?? candidate.source?.url;
  if (!url) {
    return { shouldSend: false, reason: "missing_article_url", lab: rule.lab };
  }

  const parsedUrl = parseUrl(url);
  if (!parsedUrl) {
    return { shouldSend: false, reason: "invalid_article_url", lab: rule.lab };
  }

  if (rule.rejectedHosts?.some((host) => hostMatches(parsedUrl.hostname, host))) {
    return { shouldSend: false, reason: "unsupported_source_host", lab: rule.lab };
  }

  if (!rule.hosts.some((host) => hostMatches(parsedUrl.hostname, host))) {
    return { shouldSend: false, reason: "not_official_domain", lab: rule.lab };
  }

  if (GENERIC_SOURCE_PATH.test(parsedUrl.pathname) || rule.rejectedPath?.test(parsedUrl.pathname)) {
    return { shouldSend: false, reason: "not_dedicated_article", lab: rule.lab };
  }

  const searchable = `${candidate.title} ${parsedUrl.href}`;
  if (rule.requiredText && !rule.requiredText.test(searchable)) {
    return { shouldSend: false, reason: "lab_specific_requirement_failed", lab: rule.lab };
  }

  if (!MODEL_RELEASE_TEXT.test(searchable)) {
    return { shouldSend: false, reason: "not_model_release", lab: rule.lab };
  }

  return { shouldSend: true, reason: "official_dedicated_model_release_article", lab: rule.lab };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hostMatches(actualHost: string, expectedHost: string): boolean {
  return actualHost === expectedHost || actualHost.endsWith(`.${expectedHost}`);
}
