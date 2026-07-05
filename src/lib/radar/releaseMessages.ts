import { evaluateArticleGate, type ArticleGateDecision } from "./articleGate";
import { extractModelNames, normalizeWhitespace, stripTags } from "./text";

export type EvidenceLinkKind = "system_card" | "model_card" | "technical_report" | "benchmark" | "docs";

export type EvidenceLink = {
  kind: EvidenceLinkKind;
  label: string;
  url: string;
};

export type ReleaseReplayCase = {
  id: string;
  provider: string;
  title: string;
  url: string;
  releaseDate: string;
  modelNames: string[];
  whereItShines: string[];
  strengths: string[];
  weaknessesUnknowns: string[];
  benchmarkContext: string[];
  safetySystemNotes: string[];
  evidenceLinks?: EvidenceLink[];
};

export type ArticleMetadata = {
  title?: string;
  releaseDate?: string;
  textSample?: string;
  evidenceLinks: EvidenceLink[];
};

export type CostStage = {
  stage: string;
  model: string;
  providerId?: string;
  costUsd: number;
  promptTokens?: number;
  completionTokens?: number;
};

export type CostSummary = {
  mode: "offline" | "live";
  totalCostUsd: number;
  stages: CostStage[];
};

export type VerifiedReleaseNote = {
  caseId: string;
  provider: string;
  title: string;
  sourceUrl: string;
  releaseDate: string;
  modelNames: string[];
  gate: ArticleGateDecision;
  verificationStatus: "verified" | "rejected";
  whereItShines: string[];
  strengths: string[];
  weaknessesUnknowns: string[];
  benchmarkContext: string[];
  safetySystemNotes: string[];
  evidenceLinks: EvidenceLink[];
  costSummary: CostSummary;
};

export const defaultReplayReleaseIds = [
  "anthropic-claude-sonnet-5",
  "mistral-small-4",
  "elevenlabs-eleven-v3-ga",
];

export const releaseReplayCases: ReleaseReplayCase[] = [
  {
    id: "anthropic-claude-sonnet-5",
    provider: "Anthropic",
    title: "Introducing Claude Sonnet 5",
    url: "https://www.anthropic.com/news/claude-sonnet-5",
    releaseDate: "Jun 30, 2026",
    modelNames: ["Claude Sonnet 5", "claude-sonnet-5"],
    whereItShines: [
      "agentic coding, tool use, browser/terminal workflows, and professional knowledge work",
      "cost-sensitive Sonnet-tier deployments that need performance near larger Opus-class models",
    ],
    strengths: [
      "Anthropic positions it as a substantial improvement over Sonnet 4.6 on reasoning, tool use, coding, and knowledge work.",
      "It is available across Claude plans, Claude Code, and the Claude API under the claude-sonnet-5 model name.",
    ],
    weaknessesUnknowns: [
      "This replay does not fetch independent benchmark services, so external benchmark corroboration is marked unknown.",
      "Anthropic reports lower undesirable behavior than Sonnet 4.6, but higher misaligned-behavior rates than Opus 4.8 and Mythos Preview on its automated audit.",
    ],
    benchmarkContext: [
      "The official article compares Sonnet 5 with Sonnet 4.6 and Opus 4.8 on agentic search and OSWorld-Verified cost-performance, with broader evaluations in the linked system card.",
    ],
    safetySystemNotes: [
      "The article links a Claude Sonnet 5 System Card and says cyber safeguards are enabled by default.",
      "Anthropic says Sonnet 5 has much lower dangerous cyber capability than current Opus models.",
    ],
  },
  {
    id: "mistral-small-4",
    provider: "Mistral",
    title: "Introducing Mistral Small 4",
    url: "https://mistral.ai/news/mistral-small-4/",
    releaseDate: "March 16, 2026",
    modelNames: ["Mistral Small 4", "mistral-small-latest"],
    whereItShines: [
      "open multimodal chat, coding, agentic tasks, and configurable reasoning in one smaller model family",
      "self-hosted or enterprise deployments that need Apache 2.0 licensing and lower serving cost",
    ],
    strengths: [
      "Mistral says Small 4 unifies Small, Magistral, Pixtral, and Devstral-style capabilities into one model.",
      "The article lists a 256k context window, native text and image input, and MoE architecture with 119B total parameters.",
    ],
    weaknessesUnknowns: [
      "The replay does not verify Mistral's benchmark claims against an independent benchmark provider.",
      "A dedicated public safety/system card was not found by the static replay metadata.",
    ],
    benchmarkContext: [
      "The official article reports internal performance highlights, including lower completion time and higher throughput versus Mistral Small 3.",
      "Mistral also claims competitive reasoning and coding benchmark results with shorter outputs, but this replay treats those as vendor-provided evidence.",
    ],
    safetySystemNotes: [
      "The article points to technical documentation and governance material, but no dedicated safety card is required for the send decision.",
    ],
  },
  {
    id: "elevenlabs-eleven-v3-ga",
    provider: "ElevenLabs",
    title: "Eleven v3 is Now Generally Available",
    url: "https://elevenlabs.io/blog/eleven-v3-is-now-generally-available",
    releaseDate: "Feb 2, 2026",
    modelNames: ["Eleven v3"],
    whereItShines: [
      "general-availability text-to-speech generation with stronger handling of numbers, symbols, and specialized notation",
      "voice apps that need more stable production behavior than the alpha release",
    ],
    strengths: [
      "ElevenLabs says users preferred the new version 72% of the time over the alpha release in testing.",
      "The article reports a reduction in internal benchmark error rate from 15.3% to 4.9% across 27 categories and 8 languages.",
    ],
    weaknessesUnknowns: [
      "The benchmark evidence in this replay is vendor-provided and not independently rechecked.",
      "The official article does not present a dedicated safety or system card for the release.",
    ],
    benchmarkContext: [
      "ElevenLabs reports category-level internal accuracy improvements for chemical formulas, phone numbers, URLs/emails, ISBNs, license plates, mathematical expressions, and coordinates.",
    ],
    safetySystemNotes: [
      "No linked system card or safety card is required by the article gate; safety evidence is therefore reported as unknown rather than inferred.",
    ],
  },

  // OpenAI
  {
    id: "openai-gpt-4-1",
    provider: "OpenAI",
    title: "Introducing GPT-4.1 in the API",
    url: "https://openai.com/index/gpt-4-1/",
    releaseDate: "Apr 14, 2025",
    modelNames: ["GPT-4.1", "gpt-4.1"],
    whereItShines: [
      "coding tasks, long-context instruction following, and agentic tool use at scale",
    ],
    strengths: [
      "OpenAI reports strong SWE-bench performance and a 1M-token context window for GPT-4.1.",
      "The model is designed for high-volume API workloads with improved instruction-following over GPT-4o.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration is not available in offline replay mode.",
      "No dedicated system card is linked from the official release article.",
    ],
    benchmarkContext: [
      "OpenAI reports internal SWE-bench verified and SimpleQA comparisons versus GPT-4o and GPT-4.5.",
    ],
    safetySystemNotes: [
      "No dedicated system card is linked in the official release article.",
    ],
  },
  {
    id: "openai-o3-o4-mini",
    provider: "OpenAI",
    title: "Introducing o3 and o4-mini",
    url: "https://openai.com/index/openai-o3-o4-mini/",
    releaseDate: "Apr 16, 2025",
    modelNames: ["o3", "o4-mini"],
    whereItShines: [
      "complex multi-step reasoning, science, mathematics, and competitive programming",
    ],
    strengths: [
      "OpenAI positions o3 as the most capable reasoning model in the o-series family.",
      "o4-mini offers a lower-cost reasoning option competitive on math and code benchmarks.",
    ],
    weaknessesUnknowns: [
      "Reasoning trace verbosity and cost-per-task estimates not available in offline replay.",
      "Independent third-party evaluation of declared AIME scores not confirmed here.",
    ],
    benchmarkContext: [
      "OpenAI reports strong AIME 2025, Codeforces, and advanced science benchmark results for o3.",
    ],
    safetySystemNotes: [
      "OpenAI links a system card covering o3 reasoning model safety evaluation.",
    ],
  },

  // Anthropic (second article)
  {
    id: "anthropic-claude-opus-4-8",
    provider: "Anthropic",
    title: "Introducing Claude Opus 4.8",
    url: "https://www.anthropic.com/news/claude-opus-4-8",
    releaseDate: "May 22, 2026",
    modelNames: ["Claude Opus 4.8", "claude-opus-4-8"],
    whereItShines: [
      "the most demanding agentic tasks, complex reasoning, and research-grade coding",
    ],
    strengths: [
      "Anthropic positions Opus 4.8 as their most capable model on hard agentic and reasoning tasks.",
      "The model is available via the API and Claude Pro with the claude-opus-4-8 model identifier.",
    ],
    weaknessesUnknowns: [
      "External benchmark corroboration not fetched in offline replay.",
      "Higher per-token cost compared to Sonnet-tier models.",
    ],
    benchmarkContext: [
      "Anthropic reports internal comparisons on agentic benchmarks versus Opus 4.6 and Sonnet 4.6.",
    ],
    safetySystemNotes: [
      "Anthropic links a Claude Opus 4.8 system card with safety evaluation details.",
    ],
  },

  // Google Gemini
  {
    id: "google-gemini-25-flash",
    provider: "Google Gemini",
    title: "Start building with Gemini 2.5 Flash",
    url: "https://developers.googleblog.com/en/start-building-with-gemini-25-flash/",
    releaseDate: "Mar 25, 2025",
    modelNames: ["Gemini 2.5 Flash", "gemini-2.5-flash"],
    whereItShines: [
      "reasoning tasks, complex code generation, and long-context understanding at low cost",
    ],
    strengths: [
      "Google reports Gemini 2.5 Flash achieves strong reasoning and coding performance competitive with larger models.",
      "The model supports a 1M token context window and is available via Google AI Studio and Gemini API.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Safety evaluation details require reading the linked system card.",
    ],
    benchmarkContext: [
      "Google reports strong MMLU and reasoning benchmark improvements over Gemini 2.0 Flash.",
    ],
    safetySystemNotes: [
      "Google publishes a Gemini 2.5 Flash system card with safety evaluation results.",
    ],
  },
  {
    id: "google-gemini-25-pro",
    provider: "Google Gemini",
    title: "New Gemini 2.5 models available now",
    url: "https://developers.googleblog.com/en/new-gemini-25-models-available-now/",
    releaseDate: "May 6, 2025",
    modelNames: ["Gemini 2.5 Pro", "gemini-2.5-pro"],
    whereItShines: [
      "frontier-tier reasoning, coding, and long-context processing for demanding applications",
    ],
    strengths: [
      "Google positions Gemini 2.5 Pro as their most capable model on the Gemini API.",
      "The model achieved top results on multiple reasoning and coding benchmarks at launch.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Context window pricing tradeoffs at 1M tokens may be significant for some applications.",
    ],
    benchmarkContext: [
      "Google reports leading results on AIME 2025, Codeforces, and GPQA Diamond at launch.",
    ],
    safetySystemNotes: [
      "Google publishes a system card for Gemini 2.5 Pro covering safety evaluations.",
    ],
  },

  // Mistral (second article)
  {
    id: "mistral-pixtral-large",
    provider: "Mistral",
    title: "Pixtral Large: a new frontier-class multimodal model",
    url: "https://mistral.ai/news/pixtral-large-2411/",
    releaseDate: "Nov 18, 2024",
    modelNames: ["Pixtral Large", "pixtral-large-2411"],
    whereItShines: [
      "multimodal reasoning, document understanding, and vision-language tasks at frontier scale",
    ],
    strengths: [
      "Mistral positions Pixtral Large as a frontier-class multimodal model with strong vision and text capabilities.",
      "The model achieves top results on MathVista and DocVQA benchmarks according to the official article.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "A dedicated system card was not found in the static replay metadata.",
    ],
    benchmarkContext: [
      "Mistral reports strong results on MathVista, DocVQA, and MMMU versus competing multimodal models.",
    ],
    safetySystemNotes: [
      "No dedicated safety card is required by the article gate; safety notes are reported as unknown.",
    ],
  },

  // DeepSeek
  {
    id: "deepseek-v4",
    provider: "DeepSeek",
    title: "DeepSeek-V4-Pro and DeepSeek-V4-Flash are now available",
    url: "https://api-docs.deepseek.com/news/news260424",
    releaseDate: "Apr 24, 2026",
    modelNames: ["DeepSeek-V4-Pro", "DeepSeek-V4-Flash"],
    whereItShines: [
      "API-scale language, coding, and reasoning tasks at competitive cost with open weights",
    ],
    strengths: [
      "DeepSeek releases V4-Pro and V4-Flash variants with open weights for the research community.",
      "V4-Pro is positioned as competitive with frontier models on coding and reasoning benchmarks.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark results are not available in offline replay mode.",
      "Safety evaluation details and system card availability are not confirmed here.",
    ],
    benchmarkContext: [
      "DeepSeek reports strong AIME 2024 and LiveCodeBench scores for the V4-Pro variant.",
    ],
    safetySystemNotes: [
      "No dedicated system card was linked in the official news article.",
    ],
    evidenceLinks: [
      {
        kind: "technical_report",
        label: "DeepSeek-V4 Technical Report",
        url: "https://arxiv.org/abs/2505.09966",
      },
      {
        kind: "model_card",
        label: "DeepSeek-V4-Pro on Hugging Face",
        url: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark",
      },
    ],
  },
  {
    id: "deepseek-v3-0324",
    provider: "DeepSeek",
    title: "DeepSeek-V3 updated model release",
    url: "https://api-docs.deepseek.com/news/news250325",
    releaseDate: "Mar 25, 2025",
    modelNames: ["DeepSeek-V3"],
    whereItShines: [
      "coding, reasoning, and API-scale inference at low cost",
    ],
    strengths: [
      "DeepSeek releases an updated V3 checkpoint with improved coding and reasoning performance.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Exact improvements over the original V3 are described in vendor claims only.",
    ],
    benchmarkContext: [
      "DeepSeek reports improved LiveCodeBench and AIME scores versus the original V3 checkpoint.",
    ],
    safetySystemNotes: [
      "No dedicated system card is linked in this news article.",
    ],
  },

  // Meta Llama
  {
    id: "meta-llama-4",
    provider: "Meta Llama",
    title: "Llama 4: our most capable AI model to date",
    url: "https://ai.meta.com/blog/llama-4-multimodal-intelligence/",
    releaseDate: "Apr 5, 2025",
    modelNames: ["Llama 4 Scout", "Llama 4 Maverick"],
    whereItShines: [
      "multimodal reasoning, long-context tasks, and open-weights research applications",
    ],
    strengths: [
      "Meta releases Llama 4 Scout and Maverick with native multimodal capabilities and strong open-weights performance.",
      "Llama 4 Scout supports a 10M token context window, a leading figure at the time of release.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Maverick fine-tuned version performance details require reading the official article.",
    ],
    benchmarkContext: [
      "Meta reports competitive MMLU, reasoning, and vision benchmark results for Llama 4 at launch.",
    ],
    safetySystemNotes: [
      "Meta publishes a Llama 4 system card and responsible use guide with the release.",
    ],
  },
  {
    id: "meta-llama-3-3",
    provider: "Meta Llama",
    title: "Llama 3.3 70B: the most capable dense Llama model",
    url: "https://ai.meta.com/blog/llama-3-3/",
    releaseDate: "Dec 6, 2024",
    modelNames: ["Llama 3.3 70B", "Llama 3.3 70B Instruct"],
    whereItShines: [
      "dense open-weights instruction following and coding at 70B scale",
    ],
    strengths: [
      "Meta says Llama 3.3 70B matches the performance of the 405B Llama 3.1 model on key benchmarks.",
      "The model is available under the Llama 3.3 Community License.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Performance advantages over Llama 3.1 70B require reading the official release.",
    ],
    benchmarkContext: [
      "Meta reports MMLU-Pro and IFEval results showing 70B performance near the earlier 405B model.",
    ],
    safetySystemNotes: [
      "Meta links a Llama 3.3 system card and responsible use guide.",
    ],
  },

  // xAI
  {
    id: "xai-grok-3",
    provider: "xAI",
    title: "Grok 3 Beta: available now",
    url: "https://x.ai/news/grok-3",
    releaseDate: "Feb 17, 2025",
    modelNames: ["Grok 3", "Grok 3 Mini"],
    whereItShines: [
      "advanced reasoning, science, mathematics, and coding with an explicit thinking mode",
    ],
    strengths: [
      "xAI says Grok 3 outperforms GPT-4o, Gemini 1.5 Pro, and Claude 3.5 Sonnet on ThinkBench reasoning.",
      "Grok 3 Mini is a compact reasoning model available with explicit thinking traces.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Safety evaluation details and system card availability are not confirmed here.",
    ],
    benchmarkContext: [
      "xAI reports internal ThinkBench, AIME, and GPQA Diamond results comparing Grok 3 to frontier models.",
    ],
    safetySystemNotes: [
      "xAI does not link a dedicated system card from the official release article.",
    ],
  },
  {
    id: "xai-grok-4",
    provider: "xAI",
    title: "Grok 4: the world's most intelligent AI model",
    url: "https://x.ai/news/grok-4",
    releaseDate: "Jun 25, 2025",
    modelNames: ["Grok 4"],
    whereItShines: [
      "frontier reasoning, scientific research, and expert-level knowledge tasks",
    ],
    strengths: [
      "xAI claims Grok 4 achieves first-place results on Humanity's Last Exam and multiple frontier benchmarks.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Evaluation methodology for HLE results not independently verified.",
    ],
    benchmarkContext: [
      "xAI reports Grok 4 achieving top results on HLE, AIME, and GPQA Diamond at launch.",
    ],
    safetySystemNotes: [
      "No dedicated system card found in the official announcement.",
    ],
  },

  // NVIDIA Nemotron
  {
    id: "nvidia-nemotron-ultra",
    provider: "NVIDIA Nemotron",
    title: "NVIDIA Llama Nemotron Ultra open model delivers groundbreaking reasoning accuracy",
    url: "https://developer.nvidia.com/blog/nvidia-llama-nemotron-ultra-open-model-delivers-groundbreaking-reasoning-accuracy/",
    releaseDate: "Mar 18, 2025",
    modelNames: ["Llama Nemotron Ultra", "Nemotron-Ultra-253B-v1"],
    whereItShines: [
      "open-weights reasoning and research tasks at 253B parameter scale",
    ],
    strengths: [
      "NVIDIA reports Llama Nemotron Ultra achieves leading open-weights results on GPQA Diamond and LiveCodeBench.",
      "The model is available under a permissive license for research and commercial use.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Full safety evaluation details require reading the accompanying model card.",
    ],
    benchmarkContext: [
      "NVIDIA reports strong GPQA Diamond, AIME 2025, and LiveCodeBench results for Nemotron Ultra.",
    ],
    safetySystemNotes: [
      "NVIDIA publishes a model card and responsible use guidance with the release.",
    ],
  },
  {
    id: "nvidia-nemotron-4-340b",
    provider: "NVIDIA Nemotron",
    title: "NVIDIA releases Nemotron-4 340B model family",
    url: "https://research.nvidia.com/labs/nemotron/post/nemotron-4-340b/",
    releaseDate: "Jun 17, 2024",
    modelNames: ["Nemotron-4 340B", "Nemotron-4 340B Instruct"],
    whereItShines: [
      "generating synthetic training data and teacher-student fine-tuning pipelines",
    ],
    strengths: [
      "NVIDIA releases Nemotron-4 340B under a permissive license for use as a teacher model in alignment training.",
      "The model includes Base, Instruct, and Reward variants for the full preference-optimization pipeline.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Use-case suitability as a general-purpose assistant may differ from teacher-model scenarios.",
    ],
    benchmarkContext: [
      "NVIDIA reports competitive MT-Bench and instruction-following scores for the Instruct variant.",
    ],
    safetySystemNotes: [
      "NVIDIA publishes an acceptable use policy and usage guidelines with the release.",
    ],
  },

  // Deepgram
  {
    id: "deepgram-nova-3",
    provider: "Deepgram",
    title: "Introducing Nova-3: Deepgram's most accurate model",
    url: "https://deepgram.com/learn/nova-3-model",
    releaseDate: "Jan 30, 2025",
    modelNames: ["Nova-3"],
    whereItShines: [
      "speech-to-text transcription with industry-leading accuracy and low latency",
    ],
    strengths: [
      "Deepgram reports Nova-3 achieves the lowest word error rate of any model in their lineup.",
      "The model supports real-time transcription with strong multilingual accuracy improvements.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Comparative performance versus non-Deepgram models not independently verified.",
    ],
    benchmarkContext: [
      "Deepgram reports internal word error rate comparisons showing Nova-3 improvements over Nova-2.",
    ],
    safetySystemNotes: [
      "No dedicated safety card is required for speech transcription models; safety notes reported as unknown.",
    ],
  },
  {
    id: "deepgram-aura-2",
    provider: "Deepgram",
    title: "Aura-2: next generation text-to-speech model released",
    url: "https://deepgram.com/learn/aura-2-text-to-speech",
    releaseDate: "May 20, 2025",
    modelNames: ["Aura-2"],
    whereItShines: [
      "real-time text-to-speech generation with expressive voice and low latency",
    ],
    strengths: [
      "Deepgram reports Aura-2 delivers more expressive and natural-sounding speech than Aura.",
      "The model is optimized for real-time API use with competitive latency metrics.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Voice quality comparisons against non-Deepgram TTS providers not independently verified.",
    ],
    benchmarkContext: [
      "Deepgram reports internal mean opinion score improvements over Aura for naturalness and clarity.",
    ],
    safetySystemNotes: [
      "No dedicated safety card is required for text-to-speech models; safety notes reported as unknown.",
    ],
  },

  // ElevenLabs (second article)
  {
    id: "elevenlabs-turbo-v2-5",
    provider: "ElevenLabs",
    title: "Introducing Turbo v2.5: our fastest multilingual model",
    url: "https://elevenlabs.io/blog/turbo-v2-5",
    releaseDate: "May 21, 2024",
    modelNames: ["Turbo v2.5"],
    whereItShines: [
      "low-latency multilingual text-to-speech for real-time voice applications",
    ],
    strengths: [
      "ElevenLabs reports Turbo v2.5 delivers 300ms latency for real-time multilingual speech synthesis.",
      "The model adds native support for 32 languages with improved naturalness over Turbo v2.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Comparative quality against non-ElevenLabs TTS models not independently verified.",
    ],
    benchmarkContext: [
      "ElevenLabs reports internal latency and multilingual MOS comparisons versus Turbo v2.",
    ],
    safetySystemNotes: [
      "No dedicated safety card is linked; safety evidence is reported as unknown.",
    ],
  },

  // AssemblyAI
  {
    id: "assemblyai-universal-2",
    provider: "AssemblyAI",
    title: "Introducing Universal-2: the most accurate speech model ever made",
    url: "https://www.assemblyai.com/blog/universal-2/",
    releaseDate: "Jan 16, 2024",
    modelNames: ["Universal-2"],
    whereItShines: [
      "enterprise speech recognition with industry-leading accuracy across diverse audio",
    ],
    strengths: [
      "AssemblyAI reports Universal-2 achieves lower word error rate than Whisper v3 Large across diverse audio types.",
      "The model supports improved handling of accents, background noise, and technical vocabulary.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Benchmark corpus and audio types used for published WER comparisons not independently reviewed.",
    ],
    benchmarkContext: [
      "AssemblyAI reports internal WER comparisons for Universal-2 versus Whisper v3 Large and Conformer-2.",
    ],
    safetySystemNotes: [
      "No dedicated safety card is required for ASR models; safety notes reported as unknown.",
    ],
  },
  {
    id: "assemblyai-conformer-2",
    provider: "AssemblyAI",
    title: "Conformer-2: next-generation speech model release",
    url: "https://www.assemblyai.com/blog/conformer-2/",
    releaseDate: "Dec 11, 2023",
    modelNames: ["Conformer-2"],
    whereItShines: [
      "high-accuracy speech recognition with strong performance on diverse audio",
    ],
    strengths: [
      "AssemblyAI reports Conformer-2 achieves state-of-the-art WER across multiple benchmark corpora.",
      "The model adds improved accuracy on noisy and heavily accented audio over Conformer-1.",
    ],
    weaknessesUnknowns: [
      "Independent benchmark corroboration not fetched in offline replay.",
      "Benchmark details require reading the full technical writeup.",
    ],
    benchmarkContext: [
      "AssemblyAI reports WER improvements versus Conformer-1 on multiple standard ASR benchmarks.",
    ],
    safetySystemNotes: [
      "No dedicated safety card is required for ASR models; safety notes reported as unknown.",
    ],
  },
];

export function selectReleaseReplayCases(ids: string[] = defaultReplayReleaseIds): ReleaseReplayCase[] {
  const byId = new Map(releaseReplayCases.map((releaseCase) => [releaseCase.id, releaseCase]));
  const selected: ReleaseReplayCase[] = [];

  for (const id of ids) {
    const releaseCase = byId.get(id);
    if (!releaseCase) {
      throw new Error(`Unknown release replay id: ${id}`);
    }
    selected.push(releaseCase);
  }

  return selected;
}

export function buildVerifiedReleaseNote(
  releaseCase: ReleaseReplayCase,
  options: { html?: string; costSummary?: CostSummary } = {},
): VerifiedReleaseNote {
  const metadata = options.html ? extractArticleMetadata(options.html, releaseCase.url) : undefined;
  const metadataTitle = metadata?.title ? normalizeArticleTitle(metadata.title) : undefined;
  const title = metadataTitle && looksLikeReleaseTitle(metadataTitle) ? metadataTitle : releaseCase.title;
  const releaseDate = readableDate(metadata?.releaseDate) ?? releaseCase.releaseDate;
  const gate = evaluateArticleGate({
    provider: releaseCase.provider,
    title,
    url: releaseCase.url,
  });
  const modelNames = compactModelNames([
    ...releaseCase.modelNames,
    ...extractModelNames(title),
  ]);
  const evidenceLinks = mergeEvidenceLinks(releaseCase.evidenceLinks ?? [], metadata?.evidenceLinks ?? []);

  return {
    caseId: releaseCase.id,
    provider: releaseCase.provider,
    title,
    sourceUrl: releaseCase.url,
    releaseDate,
    modelNames,
    gate,
    verificationStatus: gate.shouldSend ? "verified" : "rejected",
    whereItShines: releaseCase.whereItShines,
    strengths: releaseCase.strengths,
    weaknessesUnknowns: releaseCase.weaknessesUnknowns,
    benchmarkContext: releaseCase.benchmarkContext,
    safetySystemNotes: releaseCase.safetySystemNotes,
    evidenceLinks,
    costSummary: options.costSummary ?? { mode: "offline", totalCostUsd: 0, stages: [] },
  };
}

export function formatVerifiedReleaseNote(note: VerifiedReleaseNote): string {
  const sourceLines = [`Official article: ${note.sourceUrl}`];
  for (const link of note.evidenceLinks.slice(0, 4)) {
    sourceLines.push(`${titleCase(link.kind)}: ${link.url}`);
  }

  const costLine =
    note.costSummary.mode === "offline"
      ? "offline ($0.00)"
      : `$${note.costSummary.totalCostUsd.toFixed(4)} across ${note.costSummary.stages.length} stage(s)`;

  return [
    `Verified model release: ${note.title}`,
    `Lab: ${note.provider}`,
    `Models: ${note.modelNames.join(", ")}`,
    `Date: ${note.releaseDate}`,
    `Verification: ${note.verificationStatus} (${note.gate.reason})`,
    `Cost: ${costLine}`,
    "",
    `- Where it shines: ${note.whereItShines.join("; ")}`,
    `- Strengths: ${note.strengths.join(" ")}`,
    `- Weaknesses/unknowns: ${note.weaknessesUnknowns.join(" ")}`,
    `- Benchmark context: ${note.benchmarkContext.join(" ")}`,
    `- Safety/system notes: ${note.safetySystemNotes.join(" ")}`,
    `- Sources: ${sourceLines.join(" | ")}`,
  ].join("\n").slice(0, 4096);
}

export function extractArticleMetadata(html: string, baseUrl: string): ArticleMetadata {
  const textSample = stripTags(html).slice(0, 5000);

  return {
    title: firstMatch(html, [
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]),
    releaseDate: firstMatch(html, [
      /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i,
      /Published\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i,
      /([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/,
      /([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/,
    ]),
    textSample,
    evidenceLinks: extractEvidenceLinks(html, baseUrl),
  };
}

export function extractEvidenceLinks(html: string, baseUrl: string): EvidenceLink[] {
  const links: EvidenceLink[] = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1];
    const label = normalizeWhitespace(stripTags(match[2] ?? ""));
    const searchable = `${label} ${href}`;
    const kind = evidenceKind(searchable);

    if (!kind || !href || href.startsWith("#") || href.startsWith("mailto:")) {
      continue;
    }

    const url = resolveUrl(href, baseUrl);
    if (url) {
      links.push({ kind, label: label || titleCase(kind), url });
    }
  }

  return mergeEvidenceLinks(links);
}

function evidenceKind(value: string): EvidenceLinkKind | null {
  if (/system\s*card|safety\s*card/i.test(value)) {
    return "system_card";
  }
  if (/model\s*card|huggingface\.co/i.test(value)) {
    return "model_card";
  }
  if (/technical\s*report|paper|arxiv|\.pdf/i.test(value)) {
    return "technical_report";
  }
  if (/\b(?:benchmark|evals?|leaderboard|artificialanalysis)\b/i.test(value)) {
    return "benchmark";
  }
  if (/docs|documentation|api|governance/i.test(value)) {
    return "docs";
  }
  return null;
}

function firstMatch(value: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const extracted = match?.[1] ? normalizeWhitespace(stripTags(match[1])) : "";
    if (extracted) {
      return extracted;
    }
  }
  return undefined;
}

function looksLikeReleaseTitle(value: string): boolean {
  return /introduc|launch|release|available|claude|mistral|eleven/i.test(value);
}

function normalizeArticleTitle(value: string): string {
  return normalizeWhitespace(value).replace(/\s+\|\s+(?:Anthropic|Mistral AI|ElevenLabs).*$/i, "");
}

function readableDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
    }
  }

  return value;
}

function mergeEvidenceLinks(...groups: EvidenceLink[][]): EvidenceLink[] {
  const byUrl = new Map<string, EvidenceLink>();

  for (const link of groups.flat()) {
    if (!byUrl.has(link.url)) {
      byUrl.set(link.url, link);
    }
  }

  return [...byUrl.values()]
    .sort((left, right) => evidencePriority(left.kind) - evidencePriority(right.kind))
    .slice(0, 8);
}

function evidencePriority(kind: EvidenceLinkKind): number {
  const priorities: Record<EvidenceLinkKind, number> = {
    system_card: 0,
    model_card: 1,
    technical_report: 2,
    benchmark: 3,
    docs: 4,
  };

  return priorities[kind];
}

function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function compactModelNames(values: string[]): string[] {
  const names = uniqueStrings(values);

  return names.filter((name) => {
    const comparableName = comparableModelName(name);
    if (comparableName.length <= 6) {
      return !names.some((other) => {
        const comparableOther = comparableModelName(other);
        return comparableOther !== comparableName && comparableOther.includes(comparableName);
      });
    }

    return !names.some((other) => {
      const comparableOther = comparableModelName(other);
      return comparableOther !== comparableName && comparableOther.includes(comparableName) && !other.includes("-");
    });
  });
}

function comparableModelName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
