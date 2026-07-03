import { describe, expect, it } from "vitest";
import { evaluateArticleGate } from "../src/lib/radar/articleGate";

describe("evaluateArticleGate", () => {
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
});
