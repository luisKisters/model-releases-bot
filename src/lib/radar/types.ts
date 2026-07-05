export type SourceParser =
  | "rssAtom"
  | "markdown"
  | "html"
  | "sitemap"
  | "huggingfaceOrg"
  | "jsonCatalog";

export type SignalConfidence =
  | "official"
  | "official_open_weights"
  | "catalog_confirmation"
  | "weak_page_change";

export type SignalType =
  | "release_note"
  | "open_weights"
  | "catalog"
  | "benchmark"
  | "repo_activity"
  | "page_change"
  | "source_failure";

/**
 * "sendable": items from this source can, after passing the article gate,
 *   trigger a Telegram release notification.
 * "discovery": items from this source are candidates for further investigation
 *   only — changelogs, index pages, release collections, model-card feeds,
 *   docs catalogs, and benchmark pages are all discovery-only.
 */
export type SourceRole = "sendable" | "discovery";

export type SourceConfig = {
  sourceId: string;
  provider: string;
  label: string;
  url: string;
  parser: SourceParser;
  confidence: SignalConfidence;
  signalType: SignalType;
  pollEveryMinutes: number;
  enabled: boolean;
  notify: boolean;
  sourceRole: SourceRole;
  urlIncludes?: string[];
};

export type DiscoveryCandidate = {
  lab: string;
  provider: string;
  sourceId: string;
  sourceType: SourceRole;
  sourceUrl: string;
  candidateUrl: string | null;
  canonicalUrl: string | null;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  confidence: SignalConfidence;
  rawMetadata: Record<string, unknown>;
  discoveredVia: SourceParser;
};

export type ParsedSignal = {
  title: string;
  url?: string;
  summary?: string;
  modelNames: string[];
  fingerprint: string;
  confidence: SignalConfidence;
  signalType: SignalType;
  shouldNotify: boolean;
};

export type PollHeaders = {
  etag?: string;
  lastModified?: string;
};

export type PollSourceInput = SourceConfig & PollHeaders & {
  lastContentHash?: string;
};

export type PollSuccess = {
  ok: true;
  sourceId: string;
  changed: boolean;
  statusCode: number;
  contentHash?: string;
  etag?: string;
  lastModified?: string;
  parsedSignals: ParsedSignal[];
  itemCount: number;
};

export type PollFailure = {
  ok: false;
  sourceId: string;
  statusCode?: number;
  error: string;
};

export type PollResult = PollSuccess | PollFailure;

export type FetchOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  userAgent?: string;
};

export type FetchedContent = {
  url: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  isRedirected: boolean;
  body: string;
  etag?: string;
  lastModified?: string;
};

export type ImageAsset = {
  src: string;
  altText: string | null;
  contentType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  resolves: boolean;
};

export type DownloadableAsset = {
  url: string;
  contentType: string | null;
  byteSize: number | null;
  filename: string | null;
};

export type ExtractedArticle = {
  url: string;
  canonicalUrl: string | null;
  finalUrl: string;
  title: string | null;
  author: string | null;
  publisher: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  body: string | null;
  headings: string[];
  outboundLinks: string[];
  images: ImageAsset[];
  downloadableAssets: DownloadableAsset[];
  reducedConfidence: boolean;
  missingBrowserReason?: string;
};
