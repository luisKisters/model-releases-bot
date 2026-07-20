import { describe, expect, it } from "vitest";
import { buildReleaseClassifierEvidence, runReleaseClassifier } from "../src/lib/radar/classifier";
import { CostTracker, makeFakeLlmCompletion, type LlmMessage, type LlmRole, type LlmRouter } from "../src/lib/radar/llm";

function makeRouter(responses: string[]): { router: LlmRouter; calls: { role: LlmRole; messages: LlmMessage[] }[] } {
  const calls: { role: LlmRole; messages: LlmMessage[] }[] = [];
  let i = 0;
  const router: LlmRouter = {
    isOffline: false,
    async complete(role, messages) {
      calls.push({ role, messages });
      const text = responses[Math.min(i, responses.length - 1)]!;
      i += 1;
      return makeFakeLlmCompletion(role, { text });
    },
  };
  return { router, calls };
}

describe("runReleaseClassifier", () => {
  it("uses the official listing title when a client-rendered article has no extractable body", () => {
    expect(
      buildReleaseClassifierEvidence({
        title: "Price cuts for select global models and Qwen 3.5 launch",
        articleBody: null,
      }),
    ).toBe("Price cuts for select global models and Qwen 3.5 launch");

    expect(
      buildReleaseClassifierEvidence({
        title: "Qwen 3.5 series model launch",
        articleBody: "Qwen 3.5 is now available.",
      }),
    ).toBe("Qwen 3.5 is now available.");
  });
  it("accepts a genuine new model release", async () => {
    const { router } = makeRouter([
      JSON.stringify({
        is_new_model_release: true,
        model_names: ["DeepSeek-V4-Pro"],
        reason: "Announces a new model becoming available via API.",
      }),
    ]);
    const output = await runReleaseClassifier(
      { title: "DeepSeek-V4-Pro Release", articleText: "We are releasing DeepSeek-V4-Pro today." },
      router,
      new CostTracker(10),
    );
    expect(output.is_new_model_release).toBe(true);
    expect(output.model_names).toEqual(["DeepSeek-V4-Pro"]);
  });

  it("rejects a non-release article (feature launch / pricing change)", async () => {
    const { router } = makeRouter([
      JSON.stringify({
        is_new_model_release: false,
        model_names: [],
        reason: "This announces a pricing change, not a new model.",
      }),
    ]);
    const output = await runReleaseClassifier(
      { title: "New pricing tiers announced", articleText: "We are updating our pricing plans." },
      router,
      new CostTracker(10),
    );
    expect(output.is_new_model_release).toBe(false);
    expect(output.reason).toContain("pricing");
  });

  it("retries once on malformed output, then treats as not-a-release if still unparseable", async () => {
    const { router, calls } = makeRouter(["not json at all", "still not json"]);
    const output = await runReleaseClassifier(
      { title: "Ambiguous article", articleText: "Some text." },
      router,
      new CostTracker(10),
    );
    expect(calls.filter((c) => c.role === "release_classifier")).toHaveLength(2);
    expect(output.is_new_model_release).toBe(false);
    expect(output.reason).toMatch(/could not be parsed/i);
  });

  it("recovers on retry when the first response is malformed but the second is valid JSON", async () => {
    const { router, calls } = makeRouter([
      "not json",
      JSON.stringify({
        is_new_model_release: true,
        model_names: ["Model X"],
        reason: "Valid on retry.",
      }),
    ]);
    const output = await runReleaseClassifier(
      { title: "Model X launch", articleText: "Model X is now available." },
      router,
      new CostTracker(10),
    );
    expect(calls).toHaveLength(2);
    expect(output.is_new_model_release).toBe(true);
    expect(output.model_names).toEqual(["Model X"]);
  });

  it("records cost tracker usage under the release_classifier stage", async () => {
    const { router } = makeRouter([
      JSON.stringify({ is_new_model_release: true, model_names: [], reason: "ok" }),
    ]);
    const tracker = new CostTracker(10);
    await runReleaseClassifier({ title: "t", articleText: "a" }, router, tracker);
    expect(tracker.stages.some((s) => s.stage === "release_classifier")).toBe(true);
  });

  it("fails closed when the model says release but names no specific model", async () => {
    const { router } = makeRouter([
      JSON.stringify({
        is_new_model_release: true,
        model_names: [],
        reason: "The article appears to announce something.",
      }),
    ]);

    const output = await runReleaseClassifier(
      {
        title: "5 ways to build a side hustle with Gemini",
        articleText: "Tips for using Gemini to start and grow a small business.",
      },
      router,
      new CostTracker(10),
    );

    expect(output.is_new_model_release).toBe(false);
    expect(output.reason).toMatch(/specific newly released model/i);
  });
});
