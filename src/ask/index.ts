import fs from "node:fs";
import path from "node:path";
import { error, info, setCmd, verbose } from "../core/emit.js";
import { emitGuide } from "../core/guide.js";
import { parseFrontmatter } from "../core/frontmatter.js";
import { OUTPUT_DIR_NAMES, resolveReadableDocsRoot } from "../core/paths.js";

export interface AskOpts {
  dst?: string;
  limit?: number | string;
  body?: boolean;
  format?: string;
}

type AskFormat = "default" | "compact";

interface SearchDoc {
  filePath: string;
  relFile: string;
  docId: string;
  title: string;
  description: string;
  type: string;
  method: string;
  apiPath: string;
  category: string;
  tags: string[];
  keywords: string[];
  links: string[];
  source: string;
  body: string;
  normalized: {
    file: string;
    title: string;
    description: string;
    category: string;
    tags: string;
    keywords: string;
    apiPath: string;
    body: string;
  };
}

interface QueryPlan {
  question: string;
  normalized: string;
  tokens: string[];
  expandedTokens: string[];
  structureIntent: boolean;
  guideIntent: boolean;
  apiIntent: boolean;
  authIntent: boolean;
  productIntent: boolean;
  createIntent: boolean;
}

interface SearchMatch {
  doc: SearchDoc;
  score: number;
  matchedTerms: string[];
  excerpt: string;
}

interface WorkingMatch {
  doc: SearchDoc;
  score: number;
  matchedTerms: Set<string>;
}

const STOPWORDS = new Set([
  "가",
  "것",
  "궁금",
  "관련",
  "되나",
  "되나요",
  "되는",
  "되는지",
  "되죠",
  "되나",
  "무엇",
  "뭐",
  "뭐야",
  "뭔가요",
  "방법",
  "설명",
  "싶어",
  "알고",
  "알려",
  "알려줘",
  "알려주세요",
  "어떻게",
  "어디",
  "언제",
  "왜",
  "위해",
  "인가",
  "인가요",
  "인해",
  "있나",
  "있나요",
  "있어",
  "있어요",
  "자세히",
  "질문",
  "찾아줘",
  "추천",
  "하려고",
  "하려면",
  "하려면요",
  "하는",
  "하는법",
  "하는지",
  "해",
  "해야",
  "해야해",
  "해야하나",
  "해야하나요",
  "해줘",
  "해주세요",
  "help",
  "how",
  "what",
  "when",
  "where",
  "why",
]);

export function run(questionInput: string | string[], opts: AskOpts): number {
  setCmd("ask");

  const question = normalizeQuestionInput(questionInput);
  if (!question) {
    error("usage", { msg: "질문 문장을 입력해야 합니다.", ok: false });
    return 1;
  }

  const docsRoot = resolveReadableDocsRoot(opts.dst);
  if (!fs.existsSync(docsRoot)) {
    error("start", { msg: `docs 디렉터리가 없음: ${docsRoot}`, ok: false });
    return 1;
  }

  const limit = parseLimit(opts.limit, 3);
  const includeBody = opts.body ?? false;
  const format = parseFormat(opts.format);
  if (!format) {
    error("usage", {
      msg: "--format 은 default 또는 compact 여야 합니다.",
      ok: false,
    });
    return 1;
  }
  const plan = buildQueryPlan(question);
  verbose("start", {
    dst: docsRoot,
    question,
    tokens: plan.tokens,
    expanded_tokens: plan.expandedTokens,
    limit,
    format,
  });

  const docs = loadDocs(docsRoot);
  const allMatches = searchDocs(docs, plan);

  if (allMatches.length === 0) {
    error("not_found", {
      question,
      tokens: plan.tokens,
      expanded_tokens: plan.expandedTokens,
      ok: false,
    });
    return 1;
  }

  const matches = allMatches.slice(0, limit);
  for (const [index, match] of matches.entries()) {
    info("match", buildMatchEvent(match, index + 1, includeBody, format));
  }

  info("done", {
    question,
    matched: allMatches.length,
    returned: matches.length,
    truncated: allMatches.length > matches.length,
    include_body: includeBody,
    format,
    ok: true,
  });
  emitGuide({
    use_for: "Use ranked match events as retrieval evidence and let the calling agent synthesize the final answer.",
    next_steps: buildAskNextSteps(matches, plan, includeBody, format),
    caution: "ask is heuristic retrieval. If the ranking looks weak, fall back to exact api selectors or inspect more match bodies.",
    artifacts: matches.map((match) => match.doc.relFile),
  });
  return 0;
}

function normalizeQuestionInput(input: string | string[]): string {
  if (Array.isArray(input)) return input.join(" ").trim();
  return input.trim();
}

function parseLimit(limit: number | string | undefined, fallback: number): number {
  if (typeof limit === "number" && Number.isInteger(limit) && limit > 0) return limit;
  if (typeof limit === "string") {
    const parsed = Number.parseInt(limit, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function parseFormat(format: string | undefined): AskFormat | null {
  if (!format) return "default";
  return format === "default" || format === "compact" ? format : null;
}

function buildMatchEvent(
  match: SearchMatch,
  rank: number,
  includeBody: boolean,
  format: AskFormat,
): Record<string, unknown> {
  const base = {
    rank,
    file: match.doc.relFile,
    doc_id: match.doc.docId,
    title: match.doc.title,
    type: match.doc.type,
    method: match.doc.method || undefined,
    path: match.doc.apiPath || undefined,
    category: match.doc.category || undefined,
    excerpt: match.excerpt || undefined,
    body: includeBody ? match.doc.body : undefined,
  };

  if (format === "compact") return base;

  return {
    ...base,
    tags: match.doc.tags,
    keywords: match.doc.keywords,
    description: match.doc.description || undefined,
    score: match.score,
    matched_terms: match.matchedTerms,
    source: match.doc.source || undefined,
  };
}

function buildAskNextSteps(
  matches: SearchMatch[],
  plan: QueryPlan,
  includeBody: boolean,
  format: AskFormat,
): string[] {
  const steps: string[] = [];
  const exactLookups = selectFollowupApiMatches(matches, plan);
  for (const match of exactLookups) {
    if (!match.doc.method || !match.doc.apiPath) continue;
    steps.push(`Run \`api --path ${match.doc.apiPath} --method ${match.doc.method} --body\` for exact endpoint grounding.`);
  }
  if (!includeBody) {
    steps.push("Rerun `ask --body` if the agent needs full markdown instead of excerpts.");
  }
  if (format !== "compact") {
    steps.push("Rerun `ask --format compact` when the agent needs a shorter evidence payload.");
  }
  steps.push("Request `sync` only if the upstream developer docs changed and the bundled package docs are no longer sufficient.");
  if (steps.length === 0) {
    steps.push("Use the returned `file` and `doc_id` fields as stable evidence references in the final answer.");
  }
  return steps;
}

function selectFollowupApiMatches(matches: SearchMatch[], plan: QueryPlan): SearchMatch[] {
  const apiMatches = matches.filter((match) => match.doc.method && match.doc.apiPath);
  if (apiMatches.length === 0) return [];

  const selected: SearchMatch[] = [];
  const seen = new Set<string>();
  const add = (match: SearchMatch | undefined) => {
    if (!match) return;
    const key = `${match.doc.method}:${match.doc.apiPath}`;
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(match);
  };

  if (plan.productIntent && plan.createIntent) {
    add(apiMatches.find((match) =>
      match.doc.method === "POST" && /^\/v\d+\/products(?:\/|$)/.test(match.doc.apiPath),
    ));
  }

  if (plan.authIntent) {
    add(apiMatches.find((match) =>
      match.doc.method === "POST" && match.doc.apiPath === "/v1/oauth2/token",
    ));
  }

  add(apiMatches[0]);
  return selected;
}

function buildQueryPlan(question: string): QueryPlan {
  const normalized = normalizeSearchText(question);
  const tokens = dedupeTokens(tokenize(question).filter((token) => !STOPWORDS.has(token)));
  const expanded = new Set(tokens);
  const productIntent = /(상품|product|products)/u.test(normalized);
  const createIntent = /(등록|생성|create|creation|신규|new)/u.test(normalized);

  if (/(smart\s*store|smartstore|스마트\s*스토어|스마트스토어)/u.test(normalized)) {
    expanded.add("스마트스토어");
    expanded.add("커머스api");
    expanded.add("commerce");
    expanded.add("seller");
    expanded.add("판매자");
  }

  if (/(인증|auth|oauth|oauth2|token|토큰|authorization|bearer|로그인)/u.test(normalized)) {
    expanded.add("인증");
    expanded.add("auth");
    expanded.add("oauth");
    expanded.add("oauth2");
    expanded.add("token");
    expanded.add("토큰");
    expanded.add("authorization");
    expanded.add("bearer");
    expanded.add("client_credentials");
  }

  if (/(방법|가이드|어떻게|하려면|설정|시작)/u.test(normalized)) {
    expanded.add("guide");
    expanded.add("가이드");
  }

  if (/(사이트맵|sitemap|tree|트리|구조|관계도|맵|overview)/u.test(normalized)) {
    expanded.add("사이트맵");
    expanded.add("sitemap");
    expanded.add("tree");
    expanded.add("트리");
    expanded.add("구조");
    expanded.add("관계도");
  }

  if (/(api|endpoint|엔드포인트|path|경로|method|메서드)/u.test(normalized)) {
    expanded.add("api");
    expanded.add("엔드포인트");
  }

  if (productIntent) {
    expanded.add("상품");
    expanded.add("product");
    expanded.add("products");
    expanded.add("/v2/products");
    expanded.add("v2 products");
  }

  if (productIntent && createIntent) {
    expanded.add("상품 등록");
    expanded.add("신규 상품");
    expanded.add("create product");
    expanded.add("product creation");
    expanded.add("originproduct");
  }

  return {
    question,
    normalized,
    tokens,
    expandedTokens: [...expanded],
    structureIntent: /(사이트맵|sitemap|tree|트리|구조|관계도|맵|overview)/u.test(normalized),
    guideIntent: /(방법|가이드|어떻게|하려면|시작|설정)/u.test(normalized),
    apiIntent: /(api|endpoint|엔드포인트|path|경로|method|메서드|호출)/u.test(normalized),
    authIntent: /(인증|auth|oauth|oauth2|token|토큰|authorization|bearer|로그인)/u.test(normalized),
    productIntent,
    createIntent,
  };
}

function loadDocs(docsRoot: string): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const dirName of OUTPUT_DIR_NAMES) {
    const fullDir = path.join(docsRoot, dirName);
    if (!fs.existsSync(fullDir)) continue;
    for (const filePath of walkMd(fullDir)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const [frontmatter, body] = parseFrontmatter(content);
      const title = asString(frontmatter["title"]);
      const description = asString(frontmatter["description"]);
      const category = asString(frontmatter["category"]);
      const apiPath = asString(frontmatter["path"]);
      const tags = toStringArray(frontmatter["tags"]);
      const keywords = toStringArray(frontmatter["keywords"]);
      const relFile = path.relative(docsRoot, filePath).replace(/\\/g, "/");
      const links = extractDocLinks(body, relFile);

      docs.push({
        filePath,
        relFile,
        docId: asString(frontmatter["doc-id"]),
        title,
        description,
        type: asString(frontmatter["type"]),
        method: asString(frontmatter["method"]),
        apiPath,
        category,
        tags,
        keywords,
        links,
        source: asString(frontmatter["source"]),
        body,
        normalized: {
          file: normalizeSearchText(relFile),
          title: normalizeSearchText(title),
          description: normalizeSearchText(description),
          category: normalizeSearchText(category),
          tags: normalizeSearchText(tags.join(" ")),
          keywords: normalizeSearchText(keywords.join(" ")),
          apiPath: normalizeSearchText(apiPath),
          body: normalizeSearchText(body),
        },
      });
    }
  }
  return docs;
}

function searchDocs(docs: SearchDoc[], plan: QueryPlan): SearchMatch[] {
  const working = new Map<string, WorkingMatch>();
  for (const doc of docs) {
    const match = scoreDoc(doc, plan);
    working.set(doc.relFile, {
      doc,
      score: match.score,
      matchedTerms: new Set(match.matchedTerms),
    });
  }

  applyRelationBoosts(working, plan);

  const results = [...working.values()]
    .filter((match) => match.score > 0)
    .map((match) => ({
      doc: match.doc,
      score: match.score,
      matchedTerms: [...match.matchedTerms].sort(),
      excerpt: pickExcerpt(match.doc, plan),
    }));

  return results.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const typeDelta = typeRank(left.doc.type, plan) - typeRank(right.doc.type, plan);
    if (typeDelta !== 0) return typeDelta;
    return left.doc.relFile.localeCompare(right.doc.relFile);
  });
}

function scoreDoc(doc: SearchDoc, plan: QueryPlan): SearchMatch {
  let score = 0;
  const matchedTerms = new Set<string>();

  if (plan.normalized.length >= 4) {
    score += scoreContains(doc.normalized.title, plan.normalized, 30, matchedTerms);
    score += scoreContains(doc.normalized.keywords, plan.normalized, 26, matchedTerms);
    score += scoreContains(doc.normalized.description, plan.normalized, 18, matchedTerms);
    score += scoreContains(doc.normalized.body, plan.normalized, 10, matchedTerms);
  }

  for (const token of plan.tokens) {
    score += scoreToken(doc, token, 1, matchedTerms);
  }
  for (const token of plan.expandedTokens) {
    if (plan.tokens.includes(token)) continue;
    score += scoreToken(doc, token, 0.65, matchedTerms);
  }

  if (plan.guideIntent) {
    if (doc.type === "guide") score += 18;
    else if (doc.type === "api-endpoint") score += 8;
  }
  if (plan.structureIntent) {
    if (doc.type === "guide") score += 22;
    else if (doc.type === "category-index") score += 16;
    if (/(사이트맵|구조|트리|관계도)/u.test(doc.title)) score += 20;
    if (doc.relFile === "guide/sitemap.md") score += 48;
  }
  if (plan.apiIntent) {
    if (doc.type === "api-endpoint") score += 18;
    else if (doc.type === "guide") score += 6;
  }
  if (plan.authIntent) {
    if (doc.category === "인증") score += 18;
    if (doc.apiPath === "/v1/oauth2/token") score += 24;
    if (doc.title.includes("OAuth") || doc.title.includes("인증")) score += 10;
    if (/authorization:\s*bearer/i.test(doc.body)) score += 20;
    if (/oauth 2\.0/i.test(doc.body) || /token url:/i.test(doc.body)) score += 12;
  }
  if (plan.productIntent) {
    if (doc.type === "api-endpoint") score += 8;
    if (doc.category === "상품") score += 18;
    if (/^\/v\d+\/products(?:\/|$)/.test(doc.apiPath)) score += 26;
    if (/(상품 등록|신규 상품|create product|product creation)/i.test(`${doc.title} ${doc.description}`)) {
      score += 18;
    }
  }
  if (plan.createIntent) {
    if (doc.method === "POST") score += 8;
    if (/(등록|생성|create|creation|new)/u.test(doc.normalized.title)) score += 14;
  }
  if (plan.productIntent && plan.createIntent && doc.method === "POST" && /^\/v\d+\/products(?:\/|$)/.test(doc.apiPath)) {
    score += 36;
  }
  if (plan.productIntent && doc.apiPath === "/v1/oauth2/token") score -= 32;
  if (plan.productIntent && doc.category === "인증") score -= 16;
  if (doc.type === "category-index") score -= 8;
  if (doc.type === "schema") score -= 4;
  if (plan.structureIntent && doc.type === "schema") score -= 16;

  return {
    doc,
    score,
    matchedTerms: [...matchedTerms].sort(),
    excerpt: pickExcerpt(doc, plan),
  };
}

function scoreToken(
  doc: SearchDoc,
  token: string,
  factor: number,
  matchedTerms: Set<string>,
): number {
  let score = 0;
  score += scoreContains(doc.normalized.title, token, Math.round(24 * factor), matchedTerms);
  score += scoreContains(doc.normalized.keywords, token, Math.round(20 * factor), matchedTerms);
  score += scoreContains(doc.normalized.tags, token, Math.round(14 * factor), matchedTerms);
  score += scoreContains(doc.normalized.category, token, Math.round(12 * factor), matchedTerms);
  score += scoreContains(doc.normalized.apiPath, token, Math.round(12 * factor), matchedTerms);
  score += scoreContains(doc.normalized.file, token, Math.round(9 * factor), matchedTerms);
  score += scoreContains(doc.normalized.description, token, Math.round(8 * factor), matchedTerms);
  score += scoreContains(doc.normalized.body, token, Math.round(4 * factor), matchedTerms);
  return score;
}

function scoreContains(
  haystack: string,
  needle: string,
  weight: number,
  matchedTerms: Set<string>,
): number {
  if (!needle || !haystack.includes(needle)) return 0;
  matchedTerms.add(needle);
  return weight;
}

function applyRelationBoosts(matches: Map<string, WorkingMatch>, plan: QueryPlan): void {
  const sources = [...matches.values()]
    .filter((match) => isRelationSource(match.doc) && match.score >= 18)
    .sort((left, right) => right.score - left.score);

  for (const source of sources) {
    for (const link of source.doc.links) {
      const target = matches.get(link);
      if (!target || target.doc.relFile === source.doc.relFile) continue;
      const boost = scoreRelationBoost(source, target, plan);
      if (boost <= 0) continue;
      target.score += boost;
    }
  }
}

function isRelationSource(doc: SearchDoc): boolean {
  if (doc.links.length === 0) return false;
  if (doc.type === "category-index") return true;
  if (doc.type === "guide" && doc.links.length <= 24) return true;
  return false;
}

function scoreRelationBoost(source: WorkingMatch, target: WorkingMatch, plan: QueryPlan): number {
  let boost = 0;

  if (source.doc.type === "category-index") boost += 8;
  else if (source.doc.type === "guide") boost += 4;

  if (target.doc.type === "api-endpoint") boost += 4;
  else if (target.doc.type === "schema") boost += 1;

  if (source.doc.category && source.doc.category === target.doc.category) boost += 4;
  if (plan.apiIntent && target.doc.type === "api-endpoint") boost += 4;
  if (plan.structureIntent && (target.doc.type === "guide" || target.doc.type === "category-index")) boost += 4;
  if (plan.authIntent && target.doc.apiPath === "/v1/oauth2/token") boost += 10;
  if (plan.productIntent && /^\/v\d+\/products(?:\/|$)/.test(target.doc.apiPath)) boost += 10;

  boost += Math.min(source.doc.type === "category-index" ? 10 : 6, Math.round(source.score * 0.08));

  if (target.score <= 0 && boost < 10) return 0;
  return boost;
}

function typeRank(type: string, plan: QueryPlan): number {
  if (plan.structureIntent) {
    if (type === "guide") return 0;
    if (type === "category-index") return 1;
    if (type === "api-endpoint") return 2;
    return 3;
  }
  if (plan.guideIntent) {
    if (type === "guide") return 0;
    if (type === "api-endpoint") return 1;
    if (type === "category-index") return 2;
    return 3;
  }
  if (plan.apiIntent) {
    if (type === "api-endpoint") return 0;
    if (type === "guide") return 1;
    if (type === "category-index") return 2;
    return 3;
  }
  if (type === "guide") return 0;
  if (type === "api-endpoint") return 1;
  if (type === "category-index") return 2;
  return 3;
}

function pickExcerpt(doc: SearchDoc, plan: QueryPlan): string {
  const paragraphs = doc.body
    .split(/\n\s*\n/g)
    .map((paragraph) => cleanExcerpt(paragraph))
    .filter((paragraph) => paragraph.length >= 20);

  if (paragraphs.length === 0) {
    return cleanExcerpt(doc.description || doc.title);
  }

  if (plan.structureIntent && doc.type === "guide") {
    if (doc.relFile === "guide/sitemap.md") {
      return truncate(paragraphs[0], 220);
    }
    const preferred = paragraphs.find((paragraph) => /(사이트맵|구조|트리|관계도)/u.test(paragraph)) ?? paragraphs[0];
    return truncate(preferred, 220);
  }

  let best = paragraphs[0];
  let bestScore = -1;
  for (const paragraph of paragraphs) {
    const normalized = normalizeSearchText(paragraph);
    let score = 0;
    for (const token of plan.expandedTokens) {
      if (normalized.includes(token)) score += 1;
    }
    if (score > bestScore) {
      best = paragraph;
      bestScore = score;
    }
  }
  if (!isUsefulExcerpt(best)) {
    return truncate(cleanExcerpt(doc.description || doc.title), 220);
  }
  return truncate(best, 220);
}

function cleanExcerpt(value: string): string {
  return value
    .replace(/^#+\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[_*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength - 3).trimEnd() + "...";
}

function isUsefulExcerpt(value: string): boolean {
  if (!value) return false;
  if (value.length < 24) return false;
  if (/^\]\(/.test(value)) return false;
  return /[가-힣a-z0-9]/i.test(value);
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(/[^a-z0-9가-힣/_{}.\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return dedupeTokens(
    (normalizeSearchText(value).match(/[a-z0-9가-힣]+(?:[._/-][a-z0-9가-힣{}]+)*/gu) ?? [])
      .filter((token) => token.length >= 2),
  );
}

function dedupeTokens(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function walkMd(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkMd(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".md")) results.push(fullPath);
  }
  return results.sort();
}

function extractDocLinks(body: string, relFile: string): string[] {
  const links = new Set<string>();
  const baseDir = path.posix.dirname(relFile);
  for (const match of body.matchAll(/\[[^\]]+]\(([^)]+)\)/g)) {
    const href = match[1]?.trim();
    if (!href || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) {
      continue;
    }
    const cleanHref = href.split("#", 1)[0].replace(/\\/g, "/");
    if (!cleanHref.endsWith(".md")) continue;
    const resolved = path.posix.normalize(path.posix.join(baseDir, cleanHref));
    if (!OUTPUT_DIR_NAMES.some((dir) => resolved.startsWith(`${dir}/`))) continue;
    links.add(resolved);
  }
  return [...links];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
