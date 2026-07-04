import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  detectEvidenceLinks,
  fetchEvidenceDocument,
  extractSystemCards,
  chunkDocument,
  classifyTopic,
} from "../src/lib/radar/systemCards";

function fixtureHtml(name: string): string {
  return readFileSync(resolve(__dirname, "fixtures/snapshots", name), "utf8");
}

function makeFetch(
  body: string,
  {
    status = 200,
    contentType = "text/html; charset=utf-8",
    url,
  }: { status?: number; contentType?: string; url?: string } = {},
) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    url: url ?? "https://example.com/page",
    redirected: false,
    headers: {
      get: (header: string) => {
        if (header === "content-type") return contentType;
        return null;
      },
    },
    text: () => Promise.resolve(body),
  } as unknown as Response);
}

// --- detectEvidenceLinks ---

describe("detectEvidenceLinks – DeepSeek V4 fixture", () => {
  const html = fixtureHtml("deepseek-v4.html");
  const links = detectEvidenceLinks(html, "https://api-docs.deepseek.com/news/news260424");

  it("detects arxiv technical report link", () => {
    const techReport = links.find((l) => l.url.includes("arxiv.org"));
    expect(techReport).toBeDefined();
    expect(techReport?.kind).toBe("technical_report");
    expect(techReport?.confidence).toBe("high");
  });

  it("detects HuggingFace model repo link with weights anchor", () => {
    const modelRepo = links.find((l) => l.url.includes("huggingface.co"));
    expect(modelRepo).toBeDefined();
    expect(modelRepo?.kind).toBe("model_repo");
    expect(modelRepo?.confidence).toBe("high");
  });

  it("does not detect navigation or internal links as evidence", () => {
    const navLinks = links.filter(
      (l) =>
        l.url === "https://api-docs.deepseek.com/" ||
        l.url === "https://api-docs.deepseek.com/news/",
    );
    expect(navLinks).toHaveLength(0);
  });

  it("returns only classified evidence links", () => {
    for (const link of links) {
      expect(link.kind).toBeDefined();
      expect(["system_card", "model_card", "safety_card", "technical_report", "pdf", "model_repo", "model_docs"]).toContain(link.kind);
    }
  });
});

describe("detectEvidenceLinks – Anthropic Claude fixture", () => {
  const html = fixtureHtml("anthropic-claude.html");
  const links = detectEvidenceLinks(html, "https://www.anthropic.com/news/claude-opus-4");

  it("detects system card link", () => {
    const systemCard = links.find((l) => l.kind === "system_card");
    expect(systemCard).toBeDefined();
    expect(systemCard?.confidence).toBe("high");
    expect(systemCard?.url).toContain("system-card");
  });

  it("anchor text is preserved for system card link", () => {
    const systemCard = links.find((l) => l.kind === "system_card");
    expect(systemCard?.anchorText).toBeTruthy();
  });
});

describe("detectEvidenceLinks – Mistral fixture", () => {
  const html = fixtureHtml("mistral-release.html");
  const links = detectEvidenceLinks(html, "https://mistral.ai/news/mistral-small-3");

  it("detects HuggingFace model card link", () => {
    const modelCard = links.find((l) => l.url.includes("huggingface.co"));
    expect(modelCard).toBeDefined();
    expect(modelCard?.kind).toBe("model_card");
  });

  it("does not classify unrelated links as evidence", () => {
    const navOrSocialLinks = links.filter(
      (l) => l.url.includes("twitter.com") || l.url.includes("linkedin.com"),
    );
    expect(navOrSocialLinks).toHaveLength(0);
  });
});

describe("detectEvidenceLinks – article with no evidence links", () => {
  it("returns empty array when no evidence links present", () => {
    const html = `<html><body><article>
      <p>A release announcement with no system card or technical report.</p>
      <a href="/about">About</a>
      <a href="https://twitter.com/example">Twitter</a>
    </article></body></html>`;
    const links = detectEvidenceLinks(html, "https://example.com/release");
    expect(links).toHaveLength(0);
  });

  it("detects PDF links by extension", () => {
    const html = `<html><body><article>
      <a href="/paper/technical-report.pdf">Technical Report PDF</a>
    </article></body></html>`;
    const links = detectEvidenceLinks(html, "https://example.com/release");
    expect(links).toHaveLength(1);
    expect(links[0]?.kind).toBe("pdf");
    expect(links[0]?.confidence).toBe("high");
  });

  it("detects system-card URL pattern", () => {
    const html = `<html><body><article>
      <a href="https://example.com/model-system-card">System Card</a>
    </article></body></html>`;
    const links = detectEvidenceLinks(html, "https://example.com/release");
    const sc = links.find((l) => l.kind === "system_card");
    expect(sc).toBeDefined();
    expect(sc?.confidence).toBe("high");
  });
});

// --- classifyTopic ---

describe("classifyTopic", () => {
  it("classifies safety headings", () => {
    expect(classifyTopic("Safety Evaluations")).toBe("safety");
    expect(classifyTopic("Red Team Results")).toBe("safety");
    expect(classifyTopic("Dangerous Capability Evaluation")).toBe("safety");
    expect(classifyTopic("Alignment and Guardrails")).toBe("safety");
    expect(classifyTopic("Harmful Content Analysis")).toBe("safety");
  });

  it("safety takes priority over eval in compound headings", () => {
    expect(classifyTopic("Safety Evaluation Results")).toBe("safety");
    expect(classifyTopic("Red Team Benchmark Score")).toBe("safety");
  });

  it("classifies benchmark headings", () => {
    expect(classifyTopic("Benchmark Results")).toBe("benchmarks_evals");
    expect(classifyTopic("Benchmarks and Evaluations")).toBe("benchmarks_evals");
    expect(classifyTopic("MMLU Performance")).toBe("benchmarks_evals");
    expect(classifyTopic("HumanEval Score")).toBe("benchmarks_evals");
    expect(classifyTopic("Evaluation on GPQA")).toBe("benchmarks_evals");
    expect(classifyTopic("Model Zoo Benchmarks")).toBe("benchmarks_evals");
  });

  it("classifies limitation headings", () => {
    expect(classifyTopic("Known Limitations")).toBe("misuse_limitations");
    expect(classifyTopic("Constraints and Caveats")).toBe("misuse_limitations");
    expect(classifyTopic("Failure Modes")).toBe("misuse_limitations");
    expect(classifyTopic("Model Weaknesses")).toBe("misuse_limitations");
  });

  it("classifies deployment headings", () => {
    expect(classifyTopic("API Availability")).toBe("deployment");
    expect(classifyTopic("Deployment Notes")).toBe("deployment");
    expect(classifyTopic("Context Window and Rate Limits")).toBe("deployment");
    expect(classifyTopic("Model Release and Access")).toBe("deployment");
  });

  it("classifies training/data headings", () => {
    expect(classifyTopic("Training Data")).toBe("data_training");
    expect(classifyTopic("Pre-Training Corpus")).toBe("data_training");
    expect(classifyTopic("Fine-Tuning Details")).toBe("data_training");
    expect(classifyTopic("Dataset Composition")).toBe("data_training");
  });

  it("classifies pricing headings", () => {
    expect(classifyTopic("Pricing")).toBe("pricing_api");
    expect(classifyTopic("Cost per Token")).toBe("pricing_api");
    expect(classifyTopic("Billing and Tier Details")).toBe("pricing_api");
  });

  it("classifies overview headings", () => {
    expect(classifyTopic("Overview")).toBe("overview");
    expect(classifyTopic("Introduction")).toBe("overview");
    expect(classifyTopic("Summary")).toBe("overview");
    expect(classifyTopic("Background and Context")).toBe("overview");
  });

  it("classifies capabilities headings", () => {
    expect(classifyTopic("Model Capabilities")).toBe("capabilities");
    expect(classifyTopic("Key Features")).toBe("capabilities");
    expect(classifyTopic("Use Cases")).toBe("capabilities");
  });

  it("falls back to unknown_other for unrecognized headings", () => {
    expect(classifyTopic("Acknowledgements")).toBe("unknown_other");
    expect(classifyTopic("Authors")).toBe("unknown_other");
    expect(classifyTopic("Table of Contents")).toBe("unknown_other");
  });
});

// --- chunkDocument ---

describe("chunkDocument – system card fixture", () => {
  const html = fixtureHtml("anthropic-system-card.html");
  const chunks = chunkDocument(html, "https://www.anthropic.com/claude-opus-4-system-card");

  it("produces multiple chunks from headed sections", () => {
    expect(chunks.length).toBeGreaterThan(2);
  });

  it("assigns safety topic to safety section", () => {
    const safetyChunk = chunks.find((c) => c.topic === "safety");
    expect(safetyChunk).toBeDefined();
    expect(safetyChunk?.text).toContain("red-teaming");
  });

  it("assigns benchmarks_evals topic to benchmark section", () => {
    const benchChunk = chunks.find((c) => c.topic === "benchmarks_evals");
    expect(benchChunk).toBeDefined();
    expect(benchChunk?.text).toContain("GPQA");
  });

  it("assigns misuse_limitations topic to limitations section", () => {
    const limitChunk = chunks.find((c) => c.topic === "misuse_limitations");
    expect(limitChunk).toBeDefined();
  });

  it("chunk IDs are deterministic and unique", () => {
    const ids = chunks.map((c) => c.chunkId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("chunk IDs are stable (same input → same output)", () => {
    const chunks2 = chunkDocument(html, "https://www.anthropic.com/claude-opus-4-system-card");
    expect(chunks.map((c) => c.chunkId)).toEqual(chunks2.map((c) => c.chunkId));
  });

  it("all chunks reference the source URL", () => {
    for (const chunk of chunks) {
      expect(chunk.sourceUrl).toBe("https://www.anthropic.com/claude-opus-4-system-card");
    }
  });

  it("all chunks have non-empty text", () => {
    for (const chunk of chunks) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("pageNumber is null for HTML documents", () => {
    for (const chunk of chunks) {
      expect(chunk.pageNumber).toBeNull();
    }
  });
});

describe("chunkDocument – no headings fallback", () => {
  it("returns single overview chunk when no headings present", () => {
    const html = `<html><body><article><p>Some text about the model without any section headings.</p></article></body></html>`;
    const chunks = chunkDocument(html, "https://example.com/doc");
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.topic).toBe("overview");
    expect(chunks[0]?.text).toContain("Some text about the model");
  });

  it("returns empty array for empty document", () => {
    const chunks = chunkDocument("", "https://example.com/doc");
    expect(chunks).toHaveLength(0);
  });
});

describe("chunkDocument – long document chunking", () => {
  const longText = "x".repeat(5000);
  const html = `<html><body><article><h2>Safety Evaluations</h2><p>${longText}</p></article></body></html>`;
  const chunks = chunkDocument(html, "https://example.com/long-doc", 1000);

  it("splits long section into multiple chunks", () => {
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("all long-section chunks share the same safety topic", () => {
    const topics = chunks.map((c) => c.topic);
    expect(topics.every((t) => t === "safety")).toBe(true);
  });

  it("no individual chunk exceeds maxChunkLength by more than heading prefix", () => {
    for (const chunk of chunks) {
      // Allow some slack for heading prefix (headings up to ~100 chars)
      expect(chunk.text.length).toBeLessThanOrEqual(1200);
    }
  });

  it("combined text covers the full section content", () => {
    const combined = chunks.map((c) => c.text).join("");
    expect(combined.includes("x".repeat(100))).toBe(true);
  });
});

// --- fetchEvidenceDocument ---

describe("fetchEvidenceDocument – HTML system card", () => {
  it("fetches and chunks a system card HTML page", async () => {
    const html = fixtureHtml("anthropic-system-card.html");
    const fetch = makeFetch(html, {
      url: "https://www.anthropic.com/claude-opus-4-system-card",
    });

    const doc = await fetchEvidenceDocument(
      {
        url: "https://www.anthropic.com/claude-opus-4-system-card",
        anchorText: "Claude Opus 4 System Card",
        kind: "system_card",
        confidence: "high",
      },
      { fetchImpl: fetch },
    );

    expect(doc.fetchStatus).toBe("ok");
    expect(doc.kind).toBe("system_card");
    expect(doc.title).toContain("System Card");
    expect(doc.chunks.length).toBeGreaterThan(0);
    expect(doc.canonicalUrl).toContain("system-card");
  });

  it("chunks from fetched system card contain safety evidence", async () => {
    const html = fixtureHtml("anthropic-system-card.html");
    const fetch = makeFetch(html);
    const doc = await fetchEvidenceDocument(
      { url: "https://www.anthropic.com/claude-opus-4-system-card", anchorText: null, kind: "system_card", confidence: "high" },
      { fetchImpl: fetch },
    );
    const safetyChunk = doc.chunks.find((c) => c.topic === "safety");
    expect(safetyChunk).toBeDefined();
    expect(safetyChunk?.chunkId).toBeTruthy();
    expect(safetyChunk?.sourceUrl).toBe("https://www.anthropic.com/claude-opus-4-system-card");
  });
});

describe("fetchEvidenceDocument – technical report (DeepSeek V4 arxiv)", () => {
  it("fetches and classifies technical report HTML", async () => {
    const html = `<html><head><title>DeepSeek-V4 Technical Report</title></head>
    <body><main><h2>Overview</h2><p>DeepSeek-V4 is a mixture-of-experts model.</p>
    <h2>Benchmarks and Evaluations</h2><p>MMLU: 92.1%, HumanEval: 95.3%</p>
    <h2>Safety</h2><p>We performed red-team evaluation and alignment auditing.</p></main></body></html>`;
    const fetch = makeFetch(html, { url: "https://arxiv.org/abs/2604.xxxxx" });

    const doc = await fetchEvidenceDocument(
      { url: "https://arxiv.org/abs/2604.xxxxx", anchorText: "Technical Report", kind: "technical_report", confidence: "high" },
      { fetchImpl: fetch },
    );

    expect(doc.fetchStatus).toBe("ok");
    expect(doc.kind).toBe("technical_report");
    expect(doc.chunks.some((c) => c.topic === "benchmarks_evals")).toBe(true);
    expect(doc.chunks.some((c) => c.topic === "safety")).toBe(true);
  });
});

describe("fetchEvidenceDocument – broken PDF link (404)", () => {
  it("returns fetchStatus: failed on 404 response", async () => {
    const fetch = makeFetch("", { status: 404 });

    const doc = await fetchEvidenceDocument(
      {
        url: "https://example.com/missing-safety-report.pdf",
        anchorText: "Safety Report",
        kind: "pdf",
        confidence: "high",
      },
      { fetchImpl: fetch },
    );

    expect(doc.fetchStatus).toBe("failed");
    expect(doc.chunks).toHaveLength(0);
    expect(doc.fetchError).toContain("404");
  });
});

describe("fetchEvidenceDocument – irrelevant PDF link", () => {
  it("returns kind=pdf and ok status for non-AI PDF content", async () => {
    const fetch = makeFetch("%PDF-1.4 1 0 obj << /Type /Catalog >> endobj marketing content", {
      contentType: "application/pdf",
      url: "https://example.com/marketing-brochure.pdf",
    });

    const doc = await fetchEvidenceDocument(
      {
        url: "https://example.com/marketing-brochure.pdf",
        anchorText: "Download Brochure",
        kind: "pdf",
        confidence: "high",
      },
      { fetchImpl: fetch },
    );

    expect(doc.fetchStatus).toBe("ok");
    expect(doc.kind).toBe("pdf");
    expect(doc.chunks.length).toBeGreaterThanOrEqual(1);
    expect(doc.chunks[0]?.topic).toBe("unknown_other");
  });

  it("handles PDF with binary-only content gracefully", async () => {
    const fetch = makeFetch("\x00\x01\x02binary\x00\x03\x04", {
      contentType: "application/pdf",
      url: "https://example.com/binary.pdf",
    });

    const doc = await fetchEvidenceDocument(
      { url: "https://example.com/binary.pdf", anchorText: null, kind: "pdf", confidence: "high" },
      { fetchImpl: fetch },
    );

    expect(doc.fetchStatus).toBe("ok");
    expect(doc.chunks[0]?.text).toContain("PDF binary content");
  });
});

describe("fetchEvidenceDocument – network failure", () => {
  it("returns fetchStatus: failed on network error", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network failure: ECONNREFUSED"));

    const doc = await fetchEvidenceDocument(
      { url: "https://example.com/system-card", anchorText: null, kind: "system_card", confidence: "high" },
      { fetchImpl: fetch },
    );

    expect(doc.fetchStatus).toBe("failed");
    expect(doc.fetchError).toContain("network failure");
  });
});

// --- extractSystemCards ---

describe("extractSystemCards – no evidence links", () => {
  it("returns system_card_status: not_found when no evidence links present", async () => {
    const html = `<html><body><article>
      <p>A model release announcement with no system card, technical report, or model card links.</p>
      <a href="/about">About</a>
      <a href="https://twitter.com/example">Twitter</a>
    </article></body></html>`;

    const result = await extractSystemCards(html, "https://example.com/release");

    expect(result.system_card_status).toBe("not_found");
    expect(result.detected).toHaveLength(0);
    expect(result.documents).toHaveLength(0);
  });
});

describe("extractSystemCards – Anthropic Claude fixture", () => {
  it("finds system_card_status: found when system card link is present and fetchable", async () => {
    const articleHtml = fixtureHtml("anthropic-claude.html");
    const systemCardHtml = fixtureHtml("anthropic-system-card.html");
    const fetch = makeFetch(systemCardHtml, {
      url: "https://www.anthropic.com/claude-opus-4-system-card",
    });

    const result = await extractSystemCards(
      articleHtml,
      "https://www.anthropic.com/news/claude-opus-4",
      { fetchImpl: fetch },
    );

    expect(result.system_card_status).toBe("found");
    expect(result.detected.some((d) => d.kind === "system_card")).toBe(true);
    expect(result.documents.some((d) => d.kind === "system_card" && d.fetchStatus === "ok")).toBe(true);
  });
});

describe("extractSystemCards – DeepSeek V4 fixture", () => {
  it("detects technical report and model repo from article links", async () => {
    const articleHtml = fixtureHtml("deepseek-v4.html");
    const techReportHtml = `<html><head><title>DeepSeek-V4 Tech Report</title></head>
    <body><main><h2>Overview</h2><p>DeepSeek-V4 technical details.</p>
    <h2>Benchmarks and Evaluations</h2><p>Results on coding, math, and reasoning tasks.</p></main></body></html>`;
    const fetch = makeFetch(techReportHtml, { url: "https://arxiv.org/abs/2604.xxxxx" });

    const result = await extractSystemCards(
      articleHtml,
      "https://api-docs.deepseek.com/news/news260424",
      { fetchImpl: fetch },
    );

    // Technical report should be found
    expect(result.detected.some((d) => d.kind === "technical_report")).toBe(true);
    // Model repo (HF weights) should also be detected
    expect(result.detected.some((d) => d.kind === "model_repo")).toBe(true);
  });
});

describe("extractSystemCards – failed fetch still reports detected links", () => {
  it("includes detected links even when all fetches fail", async () => {
    const html = `<html><body><article>
      <a href="https://example.com/system-card">System Card</a>
    </article></body></html>`;
    const fetch = vi.fn().mockRejectedValue(new Error("network failure"));

    const result = await extractSystemCards(html, "https://example.com/release", {
      fetchImpl: fetch,
    });

    expect(result.detected).toHaveLength(1);
    expect(result.detected[0]?.kind).toBe("system_card");
    expect(result.documents[0]?.fetchStatus).toBe("failed");
    // not_found because no successful fetch of system card/safety card/tech report
    expect(result.system_card_status).toBe("not_found");
  });
});

describe("extractSystemCards – system_card_status: not_found for model_repo only", () => {
  it("model_repo alone does not set system_card_status: found", async () => {
    const html = `<html><body><article>
      <a href="https://huggingface.co/example/model-weights">Download model weights</a>
    </article></body></html>`;
    const fetch = makeFetch(`<html><body><p>Model weights page</p></body></html>`);

    const result = await extractSystemCards(html, "https://example.com/release", {
      fetchImpl: fetch,
    });

    // model_repo alone is not sufficient for system_card_status: found
    expect(result.system_card_status).toBe("not_found");
    expect(result.detected.some((d) => d.kind === "model_repo")).toBe(true);
  });
});
