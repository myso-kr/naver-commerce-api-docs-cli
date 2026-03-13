/**
 * YAML frontmatter 생성 및 카테고리/태그 매핑.
 */

// ── API 경로 → 카테고리 매핑 ──────────────────────────────────────────────────

export const PATH_TO_CATEGORY: Array<[string, string, string[]]> = [
  ["/v1/oauth2",             "인증",            ["auth", "oauth2"]],
  ["/v1/pay-order",          "주문",            ["order"]],
  ["/v2/products",           "상품",            ["product"]],
  ["/v1/products",           "상품",            ["product"]],
  ["/v1/pay-settle",         "정산",            ["settle"]],
  ["/v1/contents",           "문의",            ["inquiry"]],
  ["/v1/bizdata-stats",      "API데이터솔루션", ["stats"]],
  ["/v1/customer-data",      "API데이터솔루션", ["stats"]],
  ["/v1/commerce-solutions", "커머스솔루션",    ["commerce-solution"]],
  ["/v1/seller",             "판매자정보",      ["seller"]],
  ["/v1/pay-user",           "판매자정보",      ["seller"]],
  ["/v1/logistics",          "물류",            ["logistics"]],
  ["/v1/nfa",                "물류",            ["logistics"]],
  ["/v1/delivery",           "물류",            ["logistics"]],
  ["/v1/hope-delivery",      "물류",            ["logistics"]],
];

const SCHEMA_CATEGORY_HINTS: Record<string, [string, string[]]> = {
  "고객-문의": ["문의",  ["inquiry", "schema"]],
  "상품-문의": ["문의",  ["inquiry", "schema"]],
  "원상품":    ["상품",  ["product", "schema"]],
  "스마트스토어": ["상품", ["product", "schema"]],
  "쇼핑윈도":  ["상품",  ["product", "schema"]],
  "공지사항":  ["상품",  ["product", "schema"]],
  "묶음배송":  ["물류",  ["logistics", "schema"]],
  "희망일배송": ["물류", ["logistics", "schema"]],
  "반품":      ["물류",  ["logistics", "schema"]],
  "배송":      ["물류",  ["logistics", "schema"]],
  "주문":      ["주문",  ["order", "schema"]],
  "정산":      ["정산",  ["settle", "schema"]],
};

const CATEGORY_TO_TAGS: Record<string, string[]> = {
  "인증":           ["auth", "oauth2"],
  "주문":           ["order"],
  "상품":           ["product"],
  "정산":           ["settle"],
  "문의":           ["inquiry"],
  "API데이터솔루션": ["stats"],
  "커머스솔루션":    ["commerce-solution"],
  "판매자정보":      ["seller"],
  "물류":           ["logistics"],
};

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  "주문":           ["주문", "발송", "교환", "반품", "취소"],
  "상품":           ["상품", "SKU", "브랜드", "옵션", "제조사", "카탈로그", "모델"],
  "정산":           ["정산", "부가세", "세금"],
  "문의":           ["문의", "답변"],
  "API데이터솔루션": ["통계", "분석", "리포트", "bizdata"],
  "커머스솔루션":    ["커머스솔루션", "비즈월렛"],
  "판매자정보":      ["판매자", "셀러"],
  "물류":           ["물류", "배송", "택배", "NFA", "SKU"],
  "인증":           ["인증", "토큰", "OAuth"],
};

const CATEGORY_KEYWORD_ALIASES: Record<string, string[]> = {
  "인증": ["auth", "oauth", "oauth2", "token", "토큰", "authorization", "bearer"],
  "주문": ["order", "orders", "product-order", "발주", "발송", "교환", "반품", "취소"],
  "상품": ["product", "products", "originproduct", "channelproduct", "원상품", "채널상품"],
  "정산": ["settle", "settlement", "vat", "부가세", "세금"],
  "문의": ["inquiry", "qna", "question", "answer", "문의", "답변"],
  "API데이터솔루션": ["stats", "bizdata", "analytics", "report", "통계", "분석", "리포트"],
  "커머스솔루션": ["commerce-solution", "subscription", "wallet", "transaction", "비즈월렛"],
  "판매자정보": ["seller", "merchant", "smartstore", "판매자", "셀러", "스마트스토어"],
  "물류": ["logistics", "delivery", "sku", "nfa", "물류", "배송", "택배"],
  "기타": ["reference"],
};

const TAG_KEYWORD_ALIASES: Record<string, string[]> = {
  auth: ["인증", "oauth", "oauth2", "token", "토큰", "authorization", "bearer"],
  oauth2: ["oauth", "auth", "인증", "token", "토큰", "client_credentials"],
  product: ["상품", "products", "originproduct", "channelproduct", "원상품", "채널상품"],
  order: ["주문", "orders", "product-order", "발주", "발송", "교환", "반품", "취소"],
  settle: ["정산", "settlement", "vat", "부가세"],
  inquiry: ["문의", "qna", "question", "answer", "답변"],
  stats: ["통계", "분석", "report", "analytics", "bizdata"],
  "commerce-solution": ["커머스솔루션", "subscription", "transaction", "wallet", "비즈월렛"],
  seller: ["판매자", "seller", "merchant", "smartstore", "스마트스토어"],
  logistics: ["물류", "logistics", "delivery", "sku", "nfa", "배송", "택배"],
  schema: ["구조체", "schema"],
  category: ["카테고리", "category", "index"],
  reference: ["reference", "guide"],
  sitemap: ["사이트맵", "sitemap", "map", "구조", "overview"],
  tree: ["트리", "tree", "구조", "관계도"],
};

const SEGMENT_KEYWORD_ALIASES: Record<string, string[]> = {
  oauth2: ["auth", "oauth", "인증", "token", "토큰", "client_credentials"],
  token: ["auth", "oauth2", "인증", "토큰", "authorization", "bearer"],
  seller: ["판매자", "seller", "merchant", "smartstore", "스마트스토어"],
  sellers: ["판매자", "seller", "merchant", "smartstore", "스마트스토어"],
  merchant: ["판매자", "merchant", "seller"],
  products: ["product", "상품", "originproduct", "channelproduct", "원상품", "채널상품"],
  product: ["products", "상품"],
  originproducts: ["originproduct", "원상품"],
  channelproducts: ["channelproduct", "채널상품"],
  search: ["조회", "검색", "목록", "find", "list"],
  categories: ["카테고리", "category"],
  category: ["카테고리", "category"],
  brands: ["브랜드", "brand"],
  manufacturers: ["제조사", "manufacturer"],
  model: ["모델", "model"],
  models: ["모델", "model"],
  images: ["이미지", "image", "upload"],
  image: ["이미지", "image", "upload"],
  upload: ["업로드", "upload", "image", "이미지"],
  tags: ["태그", "tag"],
  options: ["옵션", "option"],
  option: ["옵션", "option"],
  notices: ["공지사항", "notice"],
  qnas: ["문의", "qna", "question", "answer", "답변"],
  inquiries: ["문의", "inquiry", "question", "answer", "답변"],
  contents: ["콘텐츠", "content", "notice", "qna"],
  logistics: ["물류", "delivery", "배송", "택배", "sku", "nfa"],
  delivery: ["배송", "delivery", "logistics", "택배"],
  settle: ["정산", "settlement", "vat", "부가세"],
  vat: ["부가세", "vat", "정산"],
  subscriptions: ["구독", "subscription"],
  transactions: ["거래", "transaction"],
  bizdata: ["통계", "분석", "bizdata", "stats", "report"],
  stats: ["통계", "분석", "bizdata", "stats", "report"],
  channels: ["채널", "channel"],
  sku: ["sku", "재고", "물류", "logistics"],
  nfa: ["nfa", "물류", "logistics"],
};

interface BuildKeywordsArgs {
  docId: string;
  title: string;
  description: string;
  pageType: string;
  method: string;
  apiPath: string;
  category: string;
  tags: string[];
  sourceUrl: string;
}

// ── 카테고리 / 태그 추론 ──────────────────────────────────────────────────────

export function getCategoryAndTags(apiPath: string): [string, string[]] {
  for (const [prefix, cat, tags] of PATH_TO_CATEGORY) {
    if (apiPath.startsWith(prefix)) return [cat, [...tags]];
  }
  return ["기타", ["reference"]];
}

export function guessCategoryFromContent(
  content: string,
  title: string,
): [string, string[]] {
  for (const [key, [cat, tags]] of Object.entries(SCHEMA_CATEGORY_HINTS)) {
    if (title.includes(key) || content.slice(0, 200).includes(key)) {
      return [cat, [...tags]];
    }
  }
  for (const [cat, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const kw of keywords) {
      if (title.includes(kw)) {
        return [cat, [...(CATEGORY_TO_TAGS[cat] ?? ["reference"])]];
      }
    }
  }
  return ["기타", ["reference"]];
}

// ── doc-id 생성 ───────────────────────────────────────────────────────────────

export function makeDocId(
  pageType: string,
  apiPath: string,
  method: string,
  sourceUrl: string,
  title: string,
): string {
  if (pageType === "api-endpoint" && apiPath) {
    const parts = apiPath
      .replace(/^\//, "")
      .split("/")
      .filter(Boolean)
      .map((p) => p.replace(/[{}]/g, ""));
    return parts.join("-") + `-${method.toLowerCase()}`;
  }
  let slug = sourceUrl ? sourceUrl.replace(/\/$/, "").split("/").pop()! : title;
  slug = slug.replace(/[^a-zA-Z0-9가-힣\-]/g, "-").replace(/^-+|-+$/g, "");
  const prefix =
    pageType === "schema"
      ? "schema"
      : pageType === "category-index"
        ? "category"
        : pageType === "guide"
          ? "guide"
          : "doc";
  return `${prefix}-${slug}`;
}

export function buildKeywords(args: BuildKeywordsArgs): string[] {
  const collector = createKeywordCollector();
  const {
    title,
    method,
    apiPath,
    category,
    tags,
    sourceUrl,
  } = args;

  collector.add(title);
  collector.addPhrase(title);

  collector.add(category);
  collector.addMany(CATEGORY_KEYWORD_ALIASES[category] ?? []);

  collector.addMany(tags);
  for (const tag of tags) {
    collector.addMany(TAG_KEYWORD_ALIASES[tag] ?? []);
  }

  if (method) {
    collector.add(method);
  }

  if (apiPath) {
    collector.add(apiPath);
    if (method) collector.add(`${method} ${apiPath}`);
    const segments = apiPath
      .replace(/^\//, "")
      .split("/")
      .map((segment) => segment.replace(/[{}]/g, ""))
      .map((segment) => normalizeKeyword(segment))
      .filter(Boolean);

    for (const segment of segments) {
      collector.add(segment);
      if (segment.endsWith("s") && segment.length > 4) collector.add(segment.slice(0, -1));
      collector.addMany(SEGMENT_KEYWORD_ALIASES[segment] ?? []);
    }

    if (segments.length >= 2) collector.add(segments.join(" "));
    if (segments.length >= 3) collector.add(segments.slice(-2).join(" "));
    if (segments.length >= 2 && /^v\d+$/.test(segments[0])) {
      collector.add(segments.slice(1).join(" "));
    }
  }

  const sourceSlug = sourceUrl.replace(/\/$/, "").split("/").pop() ?? "";
  collector.add(sourceSlug);
  for (const token of tokenizeKeywords(sourceSlug)) {
    collector.add(token);
    collector.addMany(SEGMENT_KEYWORD_ALIASES[token] ?? []);
  }

  return collector.values();
}

// ── frontmatter 빌드 ──────────────────────────────────────────────────────────

export function buildFrontmatter(
  docId: string,
  title: string,
  description: string,
  pageType: string,
  method: string,
  apiPath: string,
  baseUrl: string,
  category: string,
  tags: string[],
  keywords: string[],
  sourceUrl: string,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const safeTitle = title.replace(/"/g, '\\"');
  const safeDesc = description.replace(/"/g, '\\"');

  const lines: string[] = ["---"];
  lines.push(`doc-id: "${docId}"`);
  lines.push(`title: "${safeTitle}"`);
  lines.push(`description: "${safeDesc}"`);
  lines.push(`type: ${pageType}`);
  if (pageType === "api-endpoint" && method) {
    lines.push(`method: ${method}`);
    lines.push(`path: ${apiPath}`);
    lines.push(`base-url: ${baseUrl}`);
  }
  lines.push(`category: ${category}`);
  lines.push("tags:");
  for (const tag of [...new Set(tags)].sort()) {
    lines.push(`  - ${tag}`);
  }
  lines.push("keywords:");
  for (const keyword of keywords) {
    lines.push(`  - "${keyword.replace(/"/g, '\\"')}"`);
  }
  lines.push("status: stable");
  lines.push(`updated: "${today}"`);
  if (sourceUrl) lines.push(`source: ${sourceUrl}`);
  lines.push("---");

  return lines.join("\n");
}

function createKeywordCollector() {
  const seen = new Set<string>();
  const values: string[] = [];

  const add = (value: string): void => {
    const normalized = normalizeKeyword(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    values.push(normalized);
  };

  return {
    add,
    addMany(items: string[]): void {
      for (const item of items) add(item);
    },
    addPhrase(value: string): void {
      const tokens = tokenizeKeywords(value);
      add(tokens.join(" "));
      for (let i = 0; i < tokens.length - 1; i++) {
        add(`${tokens[i]} ${tokens[i + 1]}`);
      }
    },
    values(): string[] {
      return values.slice(0, 48);
    },
  };
}

function tokenizeKeywords(value: string): string[] {
  return [
    ...new Set(
      normalizeKeyword(value)
        .split(/[\s/_.-]+/g)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  ];
}

function normalizeKeyword(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(/[^a-z0-9가-힣/_{}.\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
