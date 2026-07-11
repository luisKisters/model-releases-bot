import type { SourceConfig } from "./types";

export type ArticleGateChecks = {
  selected_lab: boolean;
  official_domain: boolean;
  dedicated_article: boolean;
  model_release_language: boolean;
  lab_specific_constraint: boolean;
};

export type ArticleGateCandidate = {
  provider: string;
  title: string;
  url?: string;
  summary?: string;
  source?: SourceConfig;
};

export type ArticleGateDecision = {
  shouldSend: boolean;
  checks: ArticleGateChecks;
  lab?: string;
  reason: string;
  alertKind?: "model_release" | "major_incident";
};

type LabRule = {
  lab: string;
  providers: string[];
  hosts: string[];
  requiredText?: RegExp;
  rejectedText?: RegExp;
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
    rejectedHosts: [
      "ai.google.dev",
      "aistudio.google.com",
      "gemini.google.com",
      "openrouter.ai",
    ],
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
    rejectedText: /\b(powerpoint|word|plugin marketplace|agent dashboard|interactive brokers|databricks|warp|bedrock|voices|add-?in)\b/i,
  },
  {
    lab: "Qwen",
    providers: ["Qwen"],
    hosts: ["qwen.ai", "qwenlm.github.io", "www.alibabacloud.com"],
    requiredText: /qwen/i,
  },
  {
    lab: "Kimi",
    providers: ["Kimi", "Moonshot AI", "Moonshot"],
    hosts: ["kimi.com", "www.kimi.com", "platform.kimi.ai", "moonshot.ai", "www.moonshot.ai"],
    requiredText: /kimi|moonshot/i,
    rejectedText: /\b(feature release log|setup guides?|coding with|vendor[-\s]?verifier|playground|ama recap|code cli|cheat sheet|how to install|how to use)\b/i,
  },
  {
    lab: "Z.ai",
    providers: ["Z.ai", "ZAI"],
    hosts: ["z.ai", "www.z.ai", "docs.z.ai"],
    requiredText: /glm|z\.?ai/i,
  },
  {
    lab: "MiniMax",
    providers: ["MiniMax"],
    hosts: ["minimax.io", "www.minimax.io", "platform.minimax.io"],
    requiredText: /minimax|hailuo|abab/i,
  },
  {
    lab: "Xiaomi MiMo",
    providers: ["Xiaomi MiMo", "XiaomiMiMo", "MiMo"],
    hosts: ["mimo.mi.com", "mimo.xiaomi.com", "platform.xiaomimimo.com"],
    requiredText: /mimo|xiaomi/i,
  },
  {
    lab: "NVIDIA Nemotron",
    providers: ["NVIDIA Nemotron", "NVIDIA"],
    hosts: ["research.nvidia.com", "developer.nvidia.com"],
    requiredText: /nemotron/i,
    rejectedText: /\b(how to|automate|creating|building|evaluate|harness profile|langchain|documentation|alarm management)\b/i,
  },
  {
    lab: "Deepgram",
    providers: ["Deepgram"],
    hosts: ["deepgram.com", "www.deepgram.com", "developers.deepgram.com"],
    rejectedPath: /^\/changelog(?:\/|$)/i,
  },
  {
    lab: "ElevenLabs",
    providers: ["ElevenLabs"],
    hosts: ["elevenlabs.io", "www.elevenlabs.io"],
    rejectedPath: /^\/docs\/changelog(?:\/|$)/i,
  },
  {
    lab: "AssemblyAI",
    providers: ["AssemblyAI"],
    hosts: ["assemblyai.com", "www.assemblyai.com"],
    rejectedPath: /^\/changelog(?:\/|$)|^\/collection\/releases(?:\/|$)/i,
  },
];

const RELEASE_ACTION_TEXT =
  /\b(announc(?:e|ed|ing|es)|introduc(?:e|ed|ing|es)|launch(?:ed|ing|es)?|release(?:d|s| notes?)?|ship(?:ped|s|ping)?|unveil(?:ed|s|ing)?|open[-\s]?sourc(?:e|ed|ing)|now available|generally available|new)\b/i;

const MODEL_SUBJECT_TEXT =
  /\b(model|models|llm|large language model|foundation model|reasoning model|coding model|multimodal model|language model|vision model|speech model|audio model|image model|video model|open[-\s]?weight|open[-\s]?source|inference model)\b|gpt[-\s]?\d|o\d|claude|gemini|llama|mistral|mixtral|deepseek|grok|qwen|kimi|moonshot|glm|z\.?ai|minimax|mimo|nemotron|nova|aura|scribe|universal|conformer|eleven\s*v/i;

const VERSIONED_MODEL_TEXT =
  /\b(?:gpt|claude|gemini|llama|mistral|mixtral|deepseek|grok|qwen|kimi|k2|glm|minimax|mimo|nemotron|nova|aura|scribe|universal|conformer|eleven)\s*[-_ ]?\s*(?:[a-z]+[-_ ]?)?v?\d+(?:\.\d+)*(?:[-_ ][a-z0-9]+)?\b/i;

const OPEN_MODEL_ANNOUNCEMENT_TEXT =
  /\b(open[-\s]?model|flagship model|latest model|latest .* model|frontier model|foundation model)\b/i;

const OFFICIAL_MODEL_NEWS_PATH =
  /api-docs\.deepseek\.com\/news\/news\d+/i;

const MAJOR_INCIDENT_TEXT =
  /\b(post[-\s]?mortem|incident report|root cause|outage|degradation|quality reports?|latency regression|availability incident|service disruption|inference incident|model issue|model issues|elevated errors|resolved as of|what happened|what we fixed)\b/i;

const INCIDENT_SUBJECT_TEXT =
  /\b(model|models|api|inference|serving|latency|quality|reasoning|coding|responses?|claude|gpt|gemini|grok|qwen|kimi|glm|minimax|mimo|nemotron|deepseek|mistral|llama)\b/i;

// Reject root indexes, feed URLs, model catalogs, changelogs, docs roots, and
// release-notes pages that are never dedicated release articles.
const GENERIC_SOURCE_PATH =
  /^\/?$|^\/news\/?$|^\/blog\/?$|\/rss\.xml$|\/index\.xml$|\/feed(?:\/|\.xml)?$|^\/models\/?$|^\/docs\/models\/?$|^\/changelog\/?$|^\/release-notes\/?$|^\/docs\/?$|^\/collection\/?$/i;

const FALSE_CHECKS: ArticleGateChecks = {
  selected_lab: false,
  official_domain: false,
  dedicated_article: false,
  model_release_language: false,
  lab_specific_constraint: false,
};

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
    return { shouldSend: false, reason: "unselected_lab", checks: { ...FALSE_CHECKS } };
  }

  const checks: ArticleGateChecks = {
    selected_lab: true,
    official_domain: false,
    dedicated_article: false,
    model_release_language: false,
    lab_specific_constraint: false,
  };

  const url = candidate.url ?? candidate.source?.url;
  if (!url) {
    return { shouldSend: false, reason: "missing_article_url", lab: rule.lab, checks };
  }

  const parsedUrl = parseUrl(url);
  if (!parsedUrl) {
    return { shouldSend: false, reason: "invalid_article_url", lab: rule.lab, checks };
  }

  if (rule.rejectedHosts?.some((host) => hostMatches(parsedUrl.hostname, host))) {
    return { shouldSend: false, reason: "unsupported_source_host", lab: rule.lab, checks };
  }

  if (!rule.hosts.some((host) => hostMatches(parsedUrl.hostname, host))) {
    return { shouldSend: false, reason: "not_official_domain", lab: rule.lab, checks };
  }

  checks.official_domain = true;

  if (GENERIC_SOURCE_PATH.test(parsedUrl.pathname) || rule.rejectedPath?.test(parsedUrl.pathname)) {
    return { shouldSend: false, reason: "not_dedicated_article", lab: rule.lab, checks };
  }

  checks.dedicated_article = true;

  const searchable = `${candidate.title} ${candidate.summary ?? ""} ${parsedUrl.href}`;

  if (rule.requiredText && !rule.requiredText.test(searchable)) {
    return { shouldSend: false, reason: "lab_specific_requirement_failed", lab: rule.lab, checks };
  }

  if (rule.rejectedText?.test(searchable)) {
    return { shouldSend: false, reason: "lab_specific_requirement_failed", lab: rule.lab, checks };
  }

  checks.lab_specific_constraint = true;

  const isModelRelease = hasModelReleaseLanguage(searchable);
  const isMajorIncident = hasMajorIncidentLanguage(searchable);

  if (!isModelRelease && !isMajorIncident) {
    return { shouldSend: false, reason: "not_model_release", lab: rule.lab, checks };
  }

  checks.model_release_language = true;

  if (isMajorIncident && !isModelRelease) {
    return {
      shouldSend: true,
      reason: "official_dedicated_major_incident_article",
      lab: rule.lab,
      checks,
      alertKind: "major_incident",
    };
  }

  return {
    shouldSend: true,
    reason: "official_dedicated_model_release_article",
    lab: rule.lab,
    checks,
    alertKind: "model_release",
  };
}

function hasModelReleaseLanguage(searchable: string): boolean {
  const hasModelSubject = MODEL_SUBJECT_TEXT.test(searchable) || VERSIONED_MODEL_TEXT.test(searchable);
  if (!hasModelSubject) {
    return false;
  }

  return (
    RELEASE_ACTION_TEXT.test(searchable) ||
    VERSIONED_MODEL_TEXT.test(searchable) ||
    OPEN_MODEL_ANNOUNCEMENT_TEXT.test(searchable) ||
    OFFICIAL_MODEL_NEWS_PATH.test(searchable)
  );
}

function hasMajorIncidentLanguage(searchable: string): boolean {
  return MAJOR_INCIDENT_TEXT.test(searchable) && INCIDENT_SUBJECT_TEXT.test(searchable);
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
