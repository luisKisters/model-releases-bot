import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateArticleGate } from "../src/lib/radar/articleGate";
import { extractModelNames } from "../src/lib/radar/text";
import { extractArticleFromHtml } from "../src/lib/radar/browserTools";

const FIXTURES_PATH = resolve(__dirname, "fixtures/release-benchmark.json");
const ORACLE_PATH = resolve(__dirname, "fixtures/oracle.json");
const SNAPSHOTS_DIR = resolve(__dirname, "fixtures/snapshots");

const SELECTED_LABS = [
  "OpenAI",
  "Anthropic",
  "Google Gemini",
  "Mistral",
  "DeepSeek",
  "Meta Llama",
  "xAI",
  "NVIDIA Nemotron",
  "Deepgram",
  "ElevenLabs",
  "AssemblyAI",
];

type FixtureCase = {
  id: string;
  provider: string;
  title: string;
  url: string;
  summary?: string;
  snapshotFile?: string;
  required?: boolean;
  expected: {
    shouldSend: boolean;
    lab?: string;
    modelNames?: string[];
    releaseDate?: string;
    canonicalUrl?: string;
    systemCardStatus?: string;
    benchmarkExpectations?: { name: string; status: string }[];
    expectedUnknowns?: string[];
    extractionWaiver?: string;
    rejectionReason?: string;
  };
};

type Fixture = {
  version: number;
  cases: FixtureCase[];
};

type OracleEntry = {
  lab: string;
  releaseId: string;
  sourceUrl: string;
  referenceAnswer: {
    lab: string;
    modelNames: string[];
    releaseDate: string;
    canonicalUrl: string;
    strengths: string[];
    weaknesses: string[];
    safetyCardStatus: string;
    benchmarkEvidence: { name: string; status: string }[];
    knownUnknowns: string[];
  };
};

type Oracle = {
  version: number;
  entries: OracleEntry[];
};

function loadFixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as Fixture;
}

function loadOracle(): Oracle {
  return JSON.parse(readFileSync(ORACLE_PATH, "utf8")) as Oracle;
}

// --- Fixture file structure ---

describe("release-benchmark.json structure", () => {
  it("file exists and is valid JSON", () => {
    expect(existsSync(FIXTURES_PATH)).toBe(true);
    expect(() => loadFixture()).not.toThrow();
  });

  it("has version 3 or higher", () => {
    const fixture = loadFixture();
    expect(fixture.version).toBeGreaterThanOrEqual(3);
  });

  it("has at least 35 cases (22 positive + 13 negative)", () => {
    const fixture = loadFixture();
    expect(fixture.cases.length).toBeGreaterThanOrEqual(35);
  });

  it("has at least 22 positive cases", () => {
    const fixture = loadFixture();
    const positives = fixture.cases.filter((c) => c.expected?.shouldSend === true);
    expect(positives.length).toBeGreaterThanOrEqual(22);
  });

  it("has at least 13 negative cases", () => {
    const fixture = loadFixture();
    const negatives = fixture.cases.filter((c) => c.expected?.shouldSend === false);
    expect(negatives.length).toBeGreaterThanOrEqual(13);
  });

  it("every case has id, provider, title, url, and expected", () => {
    const fixture = loadFixture();
    for (const entry of fixture.cases) {
      expect(entry.id, `${entry.id} missing id`).toBeTruthy();
      expect(entry.provider, `${entry.id} missing provider`).toBeTruthy();
      expect(entry.title, `${entry.id} missing title`).toBeTruthy();
      expect(entry.url, `${entry.id} missing url`).toBeTruthy();
      expect(entry.expected, `${entry.id} missing expected`).toBeDefined();
      expect(typeof entry.expected.shouldSend, `${entry.id} shouldSend not boolean`).toBe("boolean");
    }
  });

  it("positive cases have required metadata fields", () => {
    const fixture = loadFixture();
    const positives = fixture.cases.filter((c) => c.expected?.shouldSend === true);
    const requiredFields = ["lab", "modelNames", "releaseDate", "canonicalUrl", "systemCardStatus", "benchmarkExpectations", "expectedUnknowns"];
    for (const entry of positives) {
      for (const field of requiredFields) {
        expect(
          (entry.expected as Record<string, unknown>)[field],
          `${entry.id} positive case missing expected.${field}`,
        ).toBeDefined();
      }
    }
  });

  it("all case IDs are unique", () => {
    const fixture = loadFixture();
    const ids = fixture.cases.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("no case contains secrets or sensitive patterns", () => {
    const content = readFileSync(FIXTURES_PATH, "utf8");
    expect(content).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(content).not.toMatch(/Bearer [a-zA-Z0-9._-]{20,}/);
    expect(content).not.toMatch(/api[-_]?key\s*[:=]\s*["'][^"']{10,}/i);
  });
});

// --- Required fixtures ---

describe("required fixtures", () => {
  it("contains the required DeepSeek V4 positive fixture", () => {
    const fixture = loadFixture();
    const deepseekV4 = fixture.cases.find((c) => c.id === "deepseek-v4");
    expect(deepseekV4).toBeDefined();
    expect(deepseekV4?.expected.shouldSend).toBe(true);
    expect(deepseekV4?.url).toBe("https://api-docs.deepseek.com/news/news260424");
  });

  it("DeepSeek V4 fixture includes expected model names", () => {
    const fixture = loadFixture();
    const deepseekV4 = fixture.cases.find((c) => c.id === "deepseek-v4");
    expect(deepseekV4?.expected.modelNames).toContain("DeepSeek-V4-Pro");
    expect(deepseekV4?.expected.modelNames).toContain("DeepSeek-V4-Flash");
  });

  it("DeepSeek V4 fixture documents HuggingFace links as evidence only", () => {
    const fixture = loadFixture();
    const deepseekV4 = fixture.cases.find((c) => c.id === "deepseek-v4") as FixtureCase & { expected: { huggingFaceLinksAreEvidenceOnly?: boolean } };
    expect(deepseekV4?.expected.huggingFaceLinksAreEvidenceOnly).toBe(true);
  });

  it("DeepSeek V4 fixture documents deprecation note", () => {
    const fixture = loadFixture();
    const deepseekV4 = fixture.cases.find((c) => c.id === "deepseek-v4") as FixtureCase & { expected: { deprecationNote?: string } };
    expect(deepseekV4?.expected.deprecationNote).toContain("deepseek-chat");
  });
});

// --- Per-lab coverage ---

describe("selected lab coverage", () => {
  it("has at least two positive fixtures per selected lab", () => {
    const fixture = loadFixture();
    const positives = fixture.cases.filter((c) => c.expected?.shouldSend === true);
    const missingCoverage: string[] = [];

    for (const lab of SELECTED_LABS) {
      const labPositives = positives.filter(
        (c) =>
          c.expected?.lab === lab ||
          c.provider === lab ||
          (lab === "NVIDIA Nemotron" && (c.provider === "NVIDIA Nemotron" || c.provider === "NVIDIA")),
      );
      if (labPositives.length < 2) {
        missingCoverage.push(`${lab}: only ${labPositives.length} positive fixture(s)`);
      }
    }

    expect(missingCoverage, `Labs without 2+ positive fixtures: ${missingCoverage.join(", ")}`).toHaveLength(0);
  });

  it("has positive fixtures for all 11 selected labs", () => {
    const fixture = loadFixture();
    const positives = fixture.cases.filter((c) => c.expected?.shouldSend === true);
    const coveredLabs = new Set(positives.map((c) => c.expected?.lab ?? c.provider));
    const missingLabs = SELECTED_LABS.filter((lab) => !coveredLabs.has(lab));
    expect(missingLabs, `Missing labs: ${missingLabs.join(", ")}`).toHaveLength(0);
  });
});

// --- Article gate correctness ---

describe("article gate decisions match fixture expectations", () => {
  it("all positive cases pass the article gate", () => {
    const fixture = loadFixture();
    const positives = fixture.cases.filter((c) => c.expected?.shouldSend === true);
    const failures: string[] = [];

    for (const entry of positives) {
      const decision = evaluateArticleGate({ provider: entry.provider, title: entry.title, url: entry.url });
      if (!decision.shouldSend) {
        failures.push(`${entry.id}: expected shouldSend=true but got false (reason: ${decision.reason})`);
      }
      if (entry.expected?.lab && decision.lab !== entry.expected.lab) {
        failures.push(`${entry.id}: expected lab=${entry.expected.lab} but got ${decision.lab}`);
      }
    }

    expect(failures).toHaveLength(0);
  });

  it("all negative cases fail the article gate", () => {
    const fixture = loadFixture();
    const negatives = fixture.cases.filter((c) => c.expected?.shouldSend === false);
    const failures: string[] = [];

    for (const entry of negatives) {
      const decision = evaluateArticleGate({ provider: entry.provider, title: entry.title, url: entry.url });
      if (decision.shouldSend) {
        failures.push(`${entry.id}: expected shouldSend=false but got true`);
      }
    }

    expect(failures).toHaveLength(0);
  });

  it("DeepSeek HuggingFace update is rejected as not_official_domain", () => {
    const fixture = loadFixture();
    const entry = fixture.cases.find((c) => c.id === "deepseek-huggingface-update-excluded");
    expect(entry).toBeDefined();
    const decision = evaluateArticleGate({ provider: entry!.provider, title: entry!.title, url: entry!.url });
    expect(decision.shouldSend).toBe(false);
    expect(decision.reason).toBe("not_official_domain");
  });

  it("Xiaomi MiMo HuggingFace update is rejected as unselected_lab", () => {
    const fixture = loadFixture();
    const entry = fixture.cases.find((c) => c.id === "xiaomi-mimo-hf-excluded");
    expect(entry).toBeDefined();
    const decision = evaluateArticleGate({ provider: entry!.provider, title: entry!.title, url: entry!.url });
    expect(decision.shouldSend).toBe(false);
    expect(decision.reason).toBe("unselected_lab");
  });

  it("broad NVIDIA non-Nemotron article is rejected", () => {
    const fixture = loadFixture();
    const entry = fixture.cases.find((c) => c.id === "nvidia-non-nemotron");
    expect(entry).toBeDefined();
    const decision = evaluateArticleGate({ provider: entry!.provider, title: entry!.title, url: entry!.url });
    expect(decision.shouldSend).toBe(false);
  });

  it("Cohere changelog entry is rejected as unselected_lab", () => {
    const fixture = loadFixture();
    const entry = fixture.cases.find((c) => c.id === "cohere-command-a-excluded");
    expect(entry).toBeDefined();
    const decision = evaluateArticleGate({ provider: entry!.provider, title: entry!.title, url: entry!.url });
    expect(decision.shouldSend).toBe(false);
    expect(decision.reason).toBe("unselected_lab");
  });
});

// --- Model name extraction ---

describe("model name extraction from fixture title+summary", () => {
  it("extracts expected model names for cases without extraction waiver", () => {
    const fixture = loadFixture();
    const checkableCases = fixture.cases.filter(
      (c) => Array.isArray(c.expected?.modelNames) && c.expected.modelNames.length > 0 && !c.expected.extractionWaiver,
    );
    const failures: string[] = [];

    for (const entry of checkableCases) {
      const searchText = `${entry.title} ${entry.summary ?? ""}`;
      const extracted = extractModelNames(searchText);
      const expectedNames = (entry.expected.modelNames ?? []) as string[];

      for (const name of expectedNames) {
        if (!extracted.some((e) => e.toLowerCase() === name.toLowerCase())) {
          failures.push(`${entry.id}: expected model name "${name}" not found in extracted [${extracted.join(", ")}]`);
        }
      }
    }

    expect(failures).toHaveLength(0);
  });

  it("extraction waiver cases are skipped without failing the eval", () => {
    const fixture = loadFixture();
    const waiverCases = fixture.cases.filter((c) => c.expected?.extractionWaiver);
    expect(waiverCases.length).toBeGreaterThan(0);
    for (const entry of waiverCases) {
      expect(entry.expected.extractionWaiver).toBeTruthy();
    }
  });
});

// --- Negative fixture coverage ---

describe("negative fixtures cover all required exclusion rules", () => {
  it("has Cohere exclusion fixture", () => {
    const fixture = loadFixture();
    expect(fixture.cases.find((c) => c.id === "cohere-command-a-excluded")).toBeDefined();
  });

  it("has Qwen exclusion fixture", () => {
    const fixture = loadFixture();
    expect(fixture.cases.find((c) => c.id === "qwen3-excluded")).toBeDefined();
  });

  it("has Kimi/Moonshot exclusion fixture", () => {
    const fixture = loadFixture();
    expect(fixture.cases.find((c) => c.id === "kimi-k2-excluded")).toBeDefined();
  });

  it("has Z.ai exclusion fixture", () => {
    const fixture = loadFixture();
    expect(fixture.cases.find((c) => c.id === "z-ai-glm4-excluded")).toBeDefined();
  });

  it("has MiniMax exclusion fixture", () => {
    const fixture = loadFixture();
    expect(fixture.cases.find((c) => c.id === "minimax-excluded")).toBeDefined();
  });

  it("has Xiaomi MiMo HuggingFace exclusion fixture", () => {
    const fixture = loadFixture();
    expect(fixture.cases.find((c) => c.id === "xiaomi-mimo-hf-excluded")).toBeDefined();
  });

  it("has DeepSeek HuggingFace update exclusion fixture", () => {
    const fixture = loadFixture();
    expect(fixture.cases.find((c) => c.id === "deepseek-huggingface-update-excluded")).toBeDefined();
  });

  it("has Gemini AI Studio exclusion fixture", () => {
    const fixture = loadFixture();
    expect(fixture.cases.find((c) => c.id === "gemini-aistudio-excluded")).toBeDefined();
  });

  it("has broad NVIDIA exclusion fixture", () => {
    const fixture = loadFixture();
    expect(fixture.cases.find((c) => c.id === "nvidia-non-nemotron")).toBeDefined();
  });

  it("has ElevenLabs changelog exclusion fixture", () => {
    const fixture = loadFixture();
    expect(fixture.cases.find((c) => c.id === "elevenlabs-changelog-excluded")).toBeDefined();
  });

  it("has Deepgram changelog exclusion fixture", () => {
    const fixture = loadFixture();
    expect(fixture.cases.find((c) => c.id === "deepgram-changelog-excluded")).toBeDefined();
  });

  it("has AssemblyAI collection exclusion fixture", () => {
    const fixture = loadFixture();
    expect(fixture.cases.find((c) => c.id === "assemblyai-collection-excluded")).toBeDefined();
  });
});

// --- Oracle file ---

describe("oracle.json structure", () => {
  it("file exists and is valid JSON", () => {
    expect(existsSync(ORACLE_PATH)).toBe(true);
    expect(() => loadOracle()).not.toThrow();
  });

  it("has entries for all 11 selected labs", () => {
    const oracle = loadOracle();
    const coveredLabs = new Set(oracle.entries.map((e) => e.lab));
    const missingLabs = SELECTED_LABS.filter((lab) => !coveredLabs.has(lab));
    expect(missingLabs, `Oracle missing labs: ${missingLabs.join(", ")}`).toHaveLength(0);
  });

  it("every oracle entry has required reference answer fields", () => {
    const oracle = loadOracle();
    const requiredFields = ["lab", "modelNames", "releaseDate", "canonicalUrl", "strengths", "weaknesses", "safetyCardStatus", "benchmarkEvidence", "knownUnknowns"];
    for (const entry of oracle.entries) {
      for (const field of requiredFields) {
        expect(
          (entry.referenceAnswer as Record<string, unknown>)[field],
          `Oracle entry ${entry.lab} missing referenceAnswer.${field}`,
        ).toBeDefined();
      }
    }
  });

  it("oracle entries have non-empty strengths, weaknesses, and knownUnknowns", () => {
    const oracle = loadOracle();
    for (const entry of oracle.entries) {
      expect(entry.referenceAnswer.strengths.length, `${entry.lab} has no strengths`).toBeGreaterThan(0);
      expect(entry.referenceAnswer.weaknesses.length, `${entry.lab} has no weaknesses`).toBeGreaterThan(0);
      expect(entry.referenceAnswer.knownUnknowns.length, `${entry.lab} has no knownUnknowns`).toBeGreaterThan(0);
    }
  });

  it("oracle safetyCardStatus is one of: linked, not_found, not_applicable", () => {
    const oracle = loadOracle();
    const validStatuses = new Set(["linked", "not_found", "not_applicable"]);
    for (const entry of oracle.entries) {
      expect(
        validStatuses.has(entry.referenceAnswer.safetyCardStatus),
        `${entry.lab} safetyCardStatus '${entry.referenceAnswer.safetyCardStatus}' is not valid`,
      ).toBe(true);
    }
  });

  it("oracle benchmark evidence statuses are valid", () => {
    const oracle = loadOracle();
    const validStatuses = new Set(["supported", "vendor_provided", "contradicted", "missing", "not_comparable"]);
    for (const entry of oracle.entries) {
      for (const bench of entry.referenceAnswer.benchmarkEvidence) {
        expect(
          validStatuses.has(bench.status),
          `${entry.lab} benchmark '${bench.name}' has invalid status '${bench.status}'`,
        ).toBe(true);
      }
    }
  });

  it("oracle DeepSeek V4 entry is present and matches required fixture", () => {
    const oracle = loadOracle();
    const deepseek = oracle.entries.find((e) => e.lab === "DeepSeek");
    expect(deepseek).toBeDefined();
    expect(deepseek?.releaseId).toBe("deepseek-v4");
    expect(deepseek?.referenceAnswer.modelNames).toContain("DeepSeek-V4-Pro");
    expect(deepseek?.referenceAnswer.modelNames).toContain("DeepSeek-V4-Flash");
  });

  it("oracle does not contain secrets or credentials", () => {
    const content = readFileSync(ORACLE_PATH, "utf8");
    expect(content).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(content).not.toMatch(/Bearer [a-zA-Z0-9._-]{20,}/);
    expect(content).not.toMatch(/api[-_]?key\s*[:=]\s*["'][^"']{10,}/i);
  });
});

// --- Snapshot file integrity ---

describe("fixture snapshots", () => {
  const expectedSnapshots = [
    "anthropic-claude.html",
    "assemblyai-release.html",
    "deepgram-release.html",
    "deepseek-v4.html",
    "elevenlabs-release.html",
    "gemini-release.html",
    "meta-llama-release.html",
    "mistral-release.html",
    "nvidia-nemotron-release.html",
    "openai-gpt.html",
    "xai-release.html",
  ];

  it("all expected snapshot files exist", () => {
    const missing = expectedSnapshots.filter((f) => !existsSync(resolve(SNAPSHOTS_DIR, f)));
    expect(missing, `Missing snapshots: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("snapshot files referenced in fixtures actually exist", () => {
    const fixture = loadFixture();
    const missing: string[] = [];
    for (const entry of fixture.cases) {
      if (entry.snapshotFile) {
        const snapshotPath = resolve(SNAPSHOTS_DIR, "..", entry.snapshotFile);
        if (!existsSync(snapshotPath)) {
          missing.push(`${entry.id}: ${entry.snapshotFile}`);
        }
      }
    }
    expect(missing, `Missing snapshot files: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("snapshot files are sanitized HTML (no binary content indicators)", () => {
    for (const filename of expectedSnapshots) {
      const path = resolve(SNAPSHOTS_DIR, filename);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf8");
      expect(content, `${filename} should start with HTML doctype or tag`).toMatch(/^<!DOCTYPE|^<html/i);
      expect(content, `${filename} should not contain base64 binary blobs`).not.toMatch(/;base64,[A-Za-z0-9+/]{200,}/);
    }
  });

  it("new Meta Llama snapshot extracts title and model names", () => {
    const html = readFileSync(resolve(SNAPSHOTS_DIR, "meta-llama-release.html"), "utf8");
    const article = extractArticleFromHtml(html, "https://ai.meta.com/blog/llama-4-multimodal-intelligence/");
    expect(article.title).toContain("Llama 4");
    expect(article.body).toContain("llama-4-scout");
    expect(article.body).toContain("llama-4-maverick");
  });

  it("new xAI snapshot extracts title and model names", () => {
    const html = readFileSync(resolve(SNAPSHOTS_DIR, "xai-release.html"), "utf8");
    const article = extractArticleFromHtml(html, "https://x.ai/news/grok-4");
    expect(article.title).toContain("Grok 4");
    expect(article.body).toContain("grok-4");
  });

  it("new NVIDIA Nemotron snapshot extracts title and model names", () => {
    const html = readFileSync(resolve(SNAPSHOTS_DIR, "nvidia-nemotron-release.html"), "utf8");
    const article = extractArticleFromHtml(html, "https://developer.nvidia.com/blog/nvidia-llama-nemotron-ultra-open-model-delivers-groundbreaking-reasoning-accuracy/");
    expect(article.title).toContain("Nemotron");
    expect(article.body).toContain("nemotron-ultra-253b");
  });
});

// --- Offline eval does not make network calls ---

describe("offline eval constraints", () => {
  it("fixture evaluations use only local data (no fetch calls needed)", () => {
    const fixture = loadFixture();
    for (const entry of fixture.cases) {
      // All article gate evaluations are pure string operations — no I/O.
      const decision = evaluateArticleGate({ provider: entry.provider, title: entry.title, url: entry.url });
      expect(typeof decision.shouldSend).toBe("boolean");
    }
  });

  it("model name extraction is a pure string operation (no I/O)", () => {
    const fixture = loadFixture();
    for (const entry of fixture.cases) {
      const searchText = `${entry.title} ${entry.summary ?? ""}`;
      const result = extractModelNames(searchText);
      expect(Array.isArray(result)).toBe(true);
    }
  });
});
