import { describe, expect, it } from "vitest";
import { evaluateArticleGate } from "../src/lib/radar/articleGate";

describe("evaluateArticleGate", () => {
  // --- structured checks shape ---

  it("returns all five structured checks on a passing result", () => {
    const decision = evaluateArticleGate({
      provider: "OpenAI",
      title: "Introducing GPT-5",
      url: "https://openai.com/index/gpt-5/",
    });
    expect(decision.checks).toEqual({
      selected_lab: true,
      official_domain: true,
      dedicated_article: true,
      model_release_language: true,
      lab_specific_constraint: true,
    });
    expect(decision.shouldSend).toBe(true);
  });

  it("returns selected_lab=false and all other checks false for an unselected lab", () => {
    const decision = evaluateArticleGate({
      provider: "Cohere",
      title: "Command R released",
      url: "https://cohere.com/blog/command-r",
    });
    expect(decision.checks).toEqual({
      selected_lab: false,
      official_domain: false,
      dedicated_article: false,
      model_release_language: false,
      lab_specific_constraint: false,
    });
  });

  it("returns official_domain=false when domain is wrong", () => {
    const decision = evaluateArticleGate({
      provider: "DeepSeek",
      title: "DeepSeek-V4-Pro model card",
      url: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark",
    });
    expect(decision.checks.selected_lab).toBe(true);
    expect(decision.checks.official_domain).toBe(false);
  });

  // --- OpenAI (two positive) ---

  it("accepts an official dedicated OpenAI model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "OpenAI",
        title: "Introducing GPT-4.1 in the API",
        url: "https://openai.com/index/gpt-4-1/",
      }),
    ).toMatchObject({
      shouldSend: true,
      reason: "official_dedicated_model_release_article",
      lab: "OpenAI",
    });
  });

  it("accepts a second OpenAI model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "OpenAI",
        title: "Introducing o3 and o4-mini",
        url: "https://openai.com/index/introducing-o3-and-o4-mini/",
      }),
    ).toMatchObject({ shouldSend: true, lab: "OpenAI" });
  });

  // --- Anthropic (two positive) ---

  it("accepts an official Anthropic Claude model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "Anthropic",
        title: "Introducing Claude Opus 4",
        url: "https://www.anthropic.com/news/claude-opus-4",
      }),
    ).toMatchObject({
      shouldSend: true,
      reason: "official_dedicated_model_release_article",
      lab: "Anthropic",
    });
  });

  it("accepts a second Anthropic model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "Anthropic",
        title: "Introducing Claude 3.7 Sonnet",
        url: "https://www.anthropic.com/news/claude-3-7-sonnet",
      }),
    ).toMatchObject({ shouldSend: true, lab: "Anthropic" });
  });

  // --- Google Gemini (two positive, negatives for OpenRouter and AI Studio) ---

  it("accepts official Google Gemini blog articles", () => {
    expect(
      evaluateArticleGate({
        provider: "Google Gemini",
        title: "Start building with Gemini 2.5 Flash",
        url: "https://developers.googleblog.com/en/start-building-with-gemini-25-flash/",
      }),
    ).toMatchObject({
      shouldSend: true,
      lab: "Google Gemini",
    });
  });

  it("accepts a Google DeepMind blog Gemini release article", () => {
    expect(
      evaluateArticleGate({
        provider: "Google Gemini",
        title: "Gemini 2 Ultra model release",
        url: "https://deepmind.google/technologies/gemini/gemini-2-ultra/",
      }),
    ).toMatchObject({ shouldSend: true, lab: "Google Gemini" });
  });

  it("rejects Gemini catalog and docs pages without a dedicated official blog article", () => {
    expect(
      evaluateArticleGate({
        provider: "Google Gemini",
        title: "Gemini 2.5 Pro",
        url: "https://openrouter.ai/google/gemini-2.5-pro",
      }),
    ).toMatchObject({
      shouldSend: false,
      reason: "unsupported_source_host",
    });

    expect(
      evaluateArticleGate({
        provider: "Google Gemini",
        title: "Gemini API models",
        url: "https://ai.google.dev/gemini-api/docs/models",
      }),
    ).toMatchObject({
      shouldSend: false,
      reason: "unsupported_source_host",
    });
  });

  it("rejects AI Studio model pages for Gemini", () => {
    expect(
      evaluateArticleGate({
        provider: "Google Gemini",
        title: "Gemini 2.5 Pro model",
        url: "https://aistudio.google.com/models/gemini-2.5-pro",
      }),
    ).toMatchObject({
      shouldSend: false,
      reason: "unsupported_source_host",
      lab: "Google Gemini",
    });
  });

  // --- Mistral (two positive) ---

  it("accepts an official Mistral model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "Mistral",
        title: "Announcing Mixtral of Experts",
        url: "https://mistral.ai/news/mixtral-of-experts",
      }),
    ).toMatchObject({
      shouldSend: true,
      reason: "official_dedicated_model_release_article",
      lab: "Mistral",
    });
  });

  it("accepts a second Mistral model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "Mistral",
        title: "Mistral Small 3 released",
        url: "https://mistral.ai/news/mistral-small-3",
      }),
    ).toMatchObject({ shouldSend: true, lab: "Mistral" });
  });

  // --- DeepSeek (two positive, negative for HuggingFace model card) ---

  it("accepts the required DeepSeek V4 official news article", () => {
    expect(
      evaluateArticleGate({
        provider: "DeepSeek",
        title: "DeepSeek-V4-Pro and DeepSeek-V4-Flash model release",
        url: "https://api-docs.deepseek.com/news/news260424",
      }),
    ).toMatchObject({
      shouldSend: true,
      reason: "official_dedicated_model_release_article",
      lab: "DeepSeek",
    });
  });

  it("accepts a second DeepSeek official news article", () => {
    expect(
      evaluateArticleGate({
        provider: "DeepSeek",
        title: "Introducing DeepSeek-R1: Incentivizing Reasoning Capability in LLMs",
        url: "https://api-docs.deepseek.com/news/news250120",
      }),
    ).toMatchObject({ shouldSend: true, lab: "DeepSeek" });
  });

  it("rejects DeepSeek Hugging Face model card as not an official sendable source", () => {
    expect(
      evaluateArticleGate({
        provider: "DeepSeek",
        title: "deepseek-ai/DeepSeek-V4-Pro-DSpark updated",
        url: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-DSpark",
      }),
    ).toMatchObject({
      shouldSend: false,
      reason: "not_official_domain",
      lab: "DeepSeek",
    });
  });

  // --- Meta Llama (two positive) ---

  it("accepts an official Meta Llama model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "Meta Llama",
        title: "Introducing Llama 4: multimodal intelligence",
        url: "https://ai.meta.com/blog/llama-4-multimodal-intelligence/",
      }),
    ).toMatchObject({
      shouldSend: true,
      reason: "official_dedicated_model_release_article",
      lab: "Meta Llama",
    });
  });

  it("accepts a second Meta Llama model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "Meta Llama",
        title: "Meta releases Llama 3.1 405B",
        url: "https://ai.meta.com/blog/meta-llama-3-1/",
      }),
    ).toMatchObject({ shouldSend: true, lab: "Meta Llama" });
  });

  it("rejects a Meta AI blog post that does not mention Llama", () => {
    expect(
      evaluateArticleGate({
        provider: "Meta Llama",
        title: "Meta AI updates and product announcements",
        url: "https://ai.meta.com/blog/meta-ai-product-update-2025/",
      }),
    ).toMatchObject({
      shouldSend: false,
      reason: "lab_specific_requirement_failed",
      lab: "Meta Llama",
    });
  });

  // --- xAI (two positive) ---

  it("accepts an official xAI Grok model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "xAI",
        title: "Announcing Grok 4",
        url: "https://x.ai/news/grok-4",
      }),
    ).toMatchObject({
      shouldSend: true,
      reason: "official_dedicated_model_release_article",
      lab: "xAI",
    });
  });

  it("accepts a second xAI model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "xAI",
        title: "Introducing Grok 3 model",
        url: "https://x.ai/news/grok-3",
      }),
    ).toMatchObject({ shouldSend: true, lab: "xAI" });
  });

  // --- NVIDIA Nemotron (two positive, negatives for broad NVIDIA) ---

  it("accepts Nemotron model-release articles", () => {
    expect(
      evaluateArticleGate({
        provider: "NVIDIA Nemotron",
        title: "NVIDIA Llama Nemotron Ultra open model delivers reasoning accuracy",
        url: "https://developer.nvidia.com/blog/nvidia-llama-nemotron-ultra-open-model-delivers-groundbreaking-reasoning-accuracy/",
      }),
    ).toMatchObject({
      shouldSend: true,
      lab: "NVIDIA Nemotron",
    });
  });

  it("accepts a second Nemotron article from the research domain", () => {
    expect(
      evaluateArticleGate({
        provider: "NVIDIA Nemotron",
        title: "Nemotron-4 340B technical report: an open model release",
        url: "https://research.nvidia.com/publication/2024-07_nemotron-4-340b",
      }),
    ).toMatchObject({ shouldSend: true, lab: "NVIDIA Nemotron" });
  });

  it("rejects broad NVIDIA non-Nemotron articles", () => {
    expect(
      evaluateArticleGate({
        provider: "NVIDIA",
        title: "Blackwell AI inference platform update",
        url: "https://blogs.nvidia.com/blog/blackwell-ai-inference/",
      }),
    ).toMatchObject({
      shouldSend: false,
      reason: "not_official_domain",
      lab: "NVIDIA Nemotron",
    });

    expect(
      evaluateArticleGate({
        provider: "NVIDIA",
        title: "NVIDIA Blackwell model deployment",
        url: "https://developer.nvidia.com/blog/blackwell-ai-inference/",
      }),
    ).toMatchObject({
      shouldSend: false,
      reason: "lab_specific_requirement_failed",
      lab: "NVIDIA Nemotron",
    });
  });

  // --- Deepgram (two positive, changelog rejection) ---

  it("accepts an official Deepgram model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "Deepgram",
        title: "Introducing Nova-3: Deepgram's most accurate speech model",
        url: "https://deepgram.com/learn/nova-3-speech-model",
      }),
    ).toMatchObject({
      shouldSend: true,
      reason: "official_dedicated_model_release_article",
      lab: "Deepgram",
    });
  });

  it("accepts a second Deepgram model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "Deepgram",
        title: "Nova-2: a faster and more accurate speech model released",
        url: "https://deepgram.com/learn/nova-2-speech-model",
      }),
    ).toMatchObject({ shouldSend: true, lab: "Deepgram" });
  });

  it("rejects Deepgram changelog page as discovery-only", () => {
    expect(
      evaluateArticleGate({
        provider: "Deepgram",
        title: "Nova model upgrade",
        url: "https://developers.deepgram.com/changelog",
      }),
    ).toMatchObject({
      shouldSend: false,
      reason: "not_dedicated_article",
      lab: "Deepgram",
    });
  });

  // --- ElevenLabs (two positive, changelog rejection) ---

  it("accepts an official ElevenLabs model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "ElevenLabs",
        title: "Introducing Eleven Flash v2.5",
        url: "https://elevenlabs.io/blog/introducing-eleven-flash-v2-5",
      }),
    ).toMatchObject({
      shouldSend: true,
      reason: "official_dedicated_model_release_article",
      lab: "ElevenLabs",
    });
  });

  it("accepts a second ElevenLabs model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "ElevenLabs",
        title: "Eleven Multilingual v2 released",
        url: "https://elevenlabs.io/blog/eleven-multilingual-v2",
      }),
    ).toMatchObject({ shouldSend: true, lab: "ElevenLabs" });
  });

  it("rejects ElevenLabs changelog page as discovery-only", () => {
    expect(
      evaluateArticleGate({
        provider: "ElevenLabs",
        title: "Flash 2.5 released",
        url: "https://elevenlabs.io/docs/changelog",
      }),
    ).toMatchObject({
      shouldSend: false,
      reason: "not_dedicated_article",
      lab: "ElevenLabs",
    });
  });

  // --- AssemblyAI (two positive, collection and changelog rejection) ---

  it("accepts an official AssemblyAI model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "AssemblyAI",
        title: "AssemblyAI unveils Universal-1 speech model",
        url: "https://www.assemblyai.com/blog/announcing-universal-1",
      }),
    ).toMatchObject({
      shouldSend: true,
      reason: "official_dedicated_model_release_article",
      lab: "AssemblyAI",
    });
  });

  it("accepts a second AssemblyAI model release article", () => {
    expect(
      evaluateArticleGate({
        provider: "AssemblyAI",
        title: "AssemblyAI releases Conformer-2",
        url: "https://www.assemblyai.com/blog/conformer-2",
      }),
    ).toMatchObject({ shouldSend: true, lab: "AssemblyAI" });
  });

  it("rejects AssemblyAI release collection page as discovery-only", () => {
    expect(
      evaluateArticleGate({
        provider: "AssemblyAI",
        title: "Releases",
        url: "https://www.assemblyai.com/collection/releases",
      }),
    ).toMatchObject({
      shouldSend: false,
      reason: "not_dedicated_article",
      lab: "AssemblyAI",
    });
  });

  it("rejects AssemblyAI changelog page as discovery-only", () => {
    expect(
      evaluateArticleGate({
        provider: "AssemblyAI",
        title: "Changelog",
        url: "https://www.assemblyai.com/changelog",
      }),
    ).toMatchObject({
      shouldSend: false,
      reason: "not_dedicated_article",
      lab: "AssemblyAI",
    });
  });

  // --- Added official labs (positive, no Hugging Face) ---

  it("rejects Cohere while it is not a selected lab", () => {
    expect(
      evaluateArticleGate({
        provider: "Cohere",
        title: "Introducing Command A",
        url: "https://cohere.com/blog/command-a",
      }),
    ).toMatchObject({
      shouldSend: false,
      reason: "unselected_lab",
    });
  });

  it("accepts official Qwen blog model releases", () => {
    expect(
      evaluateArticleGate({
        provider: "Qwen",
        title: "Qwen3.6-Plus: Towards Real World Agents",
        url: "https://qwenlm.github.io/blog/qwen3/",
      }),
    ).toMatchObject({ shouldSend: true, lab: "Qwen" });
  });

  it("accepts official Kimi model pages and blog posts", () => {
    expect(
      evaluateArticleGate({
        provider: "Kimi",
        title: "Kimi K2.7 Code",
        url: "https://www.kimi.com/resources/kimi-k2-7-code",
      }),
    ).toMatchObject({ shouldSend: true, lab: "Kimi" });
  });

  it("accepts official Z.ai GLM release posts", () => {
    expect(
      evaluateArticleGate({
        provider: "Z.ai",
        title: "GLM-5.2: Built for Long-Horizon Tasks",
        url: "https://z.ai/blog/glm-5.2",
      }),
    ).toMatchObject({ shouldSend: true, lab: "Z.ai" });
  });

  it("accepts official MiniMax model release posts", () => {
    expect(
      evaluateArticleGate({
        provider: "MiniMax",
        title: "MiniMax M3: Frontier Coding, 1M Context, Native Multimodality",
        url: "https://www.minimax.io/blog/minimax-m3",
      }),
    ).toMatchObject({ shouldSend: true, lab: "MiniMax" });
  });

  it("accepts official Xiaomi MiMo model release logs", () => {
    expect(
      evaluateArticleGate({
        provider: "Xiaomi MiMo",
        title: "2026-04-23 mimo-v2.5-pro Released",
        url: "https://mimo.mi.com/docs/en-US/updates/model",
      }),
    ).toMatchObject({ shouldSend: true, lab: "Xiaomi MiMo" });
  });

  it("rejects Hugging Face updates for selected labs as non-official send sources", () => {
    expect(
      evaluateArticleGate({
        provider: "Xiaomi MiMo",
        title: "XiaomiMiMo/MiMo-7B-RL updated",
        url: "https://huggingface.co/XiaomiMiMo/MiMo-7B-RL",
      }),
    ).toMatchObject({ shouldSend: false, reason: "not_official_domain", lab: "Xiaomi MiMo" });
  });

  it("accepts official major model incident postmortems", () => {
    expect(
      evaluateArticleGate({
        provider: "Anthropic",
        title: "An update on recent Claude Code quality reports",
        url: "https://www.anthropic.com/engineering/april-23-postmortem",
      }),
    ).toMatchObject({
      shouldSend: true,
      reason: "official_dedicated_major_incident_article",
      lab: "Anthropic",
      alertKind: "major_incident",
    });
  });

  it("rejects product and marketing pages seen in production notification noise", () => {
    expect(
      evaluateArticleGate({
        provider: "Deepgram",
        title: "Article · AI Engineering & Research Enterprise restaurant brands deserve frontier voice AI models",
        url: "https://deepgram.com/learn/enterprise-restaurant-brands-deserve-frontier-voice-ai-models",
      }),
    ).toMatchObject({ shouldSend: false, reason: "not_model_release" });

    expect(
      evaluateArticleGate({
        provider: "xAI",
        title: "Grok for PowerPoint",
        url: "https://x.ai/news/introducing-powerpoint-addin",
      }),
    ).toMatchObject({ shouldSend: false, reason: "lab_specific_requirement_failed" });

    expect(
      evaluateArticleGate({
        provider: "xAI",
        title: "Grok on Amazon Bedrock",
        url: "https://x.ai/news/grok-amazon-bedrock",
        summary: "Grok models are now available via Amazon Bedrock.",
      }),
    ).toMatchObject({ shouldSend: false, reason: "lab_specific_requirement_failed" });

    expect(
      evaluateArticleGate({
        provider: "NVIDIA Nemotron",
        title: "Creating the NVIDIA Nemotron 3 Ultra NVFP4 Checkpoint with NVIDIA Model Optimizer",
        url: "https://developer.nvidia.com/blog/creating-the-nvidia-nemotron-3-ultra-nvfp4-checkpoint-with-nvidia-model-optimizer/",
      }),
    ).toMatchObject({ shouldSend: false, reason: "lab_specific_requirement_failed" });

    expect(
      evaluateArticleGate({
        provider: "Kimi",
        title: "Kimi Open Platform: New Feature Release Log",
        url: "https://platform.kimi.ai/blog/posts/changelog",
      }),
    ).toMatchObject({ shouldSend: false, reason: "lab_specific_requirement_failed" });

    expect(
      evaluateArticleGate({
        provider: "Anthropic",
        title: "Claude Corps",
        url: "https://www.anthropic.com/claude-corps",
      }),
    ).toMatchObject({ shouldSend: false, reason: "not_model_release" });
  });

  // --- Generic index / root path rejections ---

  it("rejects a blog root index URL as not a dedicated article", () => {
    expect(
      evaluateArticleGate({
        provider: "OpenAI",
        title: "OpenAI news",
        url: "https://openai.com/news",
      }),
    ).toMatchObject({ shouldSend: false, reason: "not_dedicated_article" });
  });

  it("rejects a docs root URL as not a dedicated article", () => {
    expect(
      evaluateArticleGate({
        provider: "Mistral",
        title: "Mistral docs",
        url: "https://mistral.ai/docs",
      }),
    ).toMatchObject({ shouldSend: false, reason: "not_dedicated_article" });
  });

  it("rejects a changelog root URL as not a dedicated article", () => {
    expect(
      evaluateArticleGate({
        provider: "Mistral",
        title: "Mistral changelog",
        url: "https://mistral.ai/changelog",
      }),
    ).toMatchObject({ shouldSend: false, reason: "not_dedicated_article" });
  });
});
