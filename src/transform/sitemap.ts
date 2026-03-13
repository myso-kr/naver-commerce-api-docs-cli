import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "../core/frontmatter.js";
import { OUTPUT_DIR_NAMES, resolveWritableDocsRoot } from "../core/paths.js";
import { buildFrontmatter, buildKeywords } from "./frontmatter.js";
import type { TransformResult } from "./llms.js";

interface DocEntry {
  relFile: string;
  title: string;
  description: string;
  type: string;
  method: string;
  apiPath: string;
  category: string;
}

const SOURCE_URL = "https://apicenter.commerce.naver.com/docs/commerce-api/current";

export function generateSitemapDoc(opts: { dst?: string } = {}): TransformResult | null {
  const dst = opts.dst ? path.resolve(opts.dst) : resolveWritableDocsRoot();
  const entries = collectDocEntries(dst).filter((entry) => entry.relFile !== "guide/sitemap.md");
  if (entries.length === 0) return null;

  const body = buildSitemapBody(entries);
  const title = "커머스API 사이트맵";
  const description =
    `커머스API 문서 구조와 주요 경로를 한 페이지에서 탐색할 수 있는 관계 인덱스입니다. ` +
    `총 ${entries.length}개 문서(API ${count(entries, "api-endpoint")}, 카테고리 ${count(entries, "category-index")}, 가이드 ${count(entries, "guide")}, 스키마 ${count(entries, "schema")}).`;
  const docId = "guide-sitemap";
  const keywords = mergeKeywords(
    buildKeywords({
      docId,
      title,
      description,
      pageType: "guide",
      method: "",
      apiPath: "",
      category: "기타",
      tags: ["reference", "sitemap", "tree"],
      sourceUrl: SOURCE_URL,
    }),
    [
      "사이트맵",
      "문서 구조",
      "문서 관계도",
      "tree view",
      "api tree",
      "category tree",
      ...entries.map((entry) => entry.category),
    ],
  );

  const content = [
    buildFrontmatter(
      docId,
      title,
      description,
      "guide",
      "",
      "",
      "",
      "기타",
      ["reference", "sitemap", "tree"],
      keywords,
      SOURCE_URL,
    ),
    "",
    body,
  ].join("\n");

  const destPath = path.join(dst, "guide", "sitemap.md");
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, content, "utf-8");
  return [destPath, destPath, content];
}

function collectDocEntries(dst: string): DocEntry[] {
  const entries: DocEntry[] = [];
  for (const dirName of OUTPUT_DIR_NAMES) {
    const fullDir = path.join(dst, dirName);
    if (!fs.existsSync(fullDir)) continue;
    for (const filePath of walkMd(fullDir)) {
      const relFile = path.relative(dst, filePath).replace(/\\/g, "/");
      if (relFile.startsWith("llms")) continue;
      const [frontmatter] = parseFrontmatter(fs.readFileSync(filePath, "utf-8"));
      entries.push({
        relFile,
        title: asString(frontmatter["title"]) || path.basename(filePath, ".md"),
        description: asString(frontmatter["description"]),
        type: asString(frontmatter["type"]),
        method: asString(frontmatter["method"]),
        apiPath: asString(frontmatter["path"]),
        category: asString(frontmatter["category"]) || "기타",
      });
    }
  }
  return entries.sort((left, right) => left.relFile.localeCompare(right.relFile));
}

function buildSitemapBody(entries: DocEntry[]): string {
  const lines: string[] = [
    "# 커머스API 사이트맵",
    "",
    `총 ${entries.length}개 문서입니다. API ${count(entries, "api-endpoint")}개, 카테고리 ${count(entries, "category-index")}개, 가이드 ${count(entries, "guide")}개, 스키마 ${count(entries, "schema")}개를 포함합니다.`,
    "",
    "## 카테고리 트리",
    "",
  ];

  for (const [category, docs] of groupByCategory(entries)) {
    const categoryDoc = docs.find((doc) => doc.type === "category-index");
    const guides = docs.filter((doc) => doc.type === "guide");
    const endpoints = docs.filter((doc) => doc.type === "api-endpoint");
    const schemas = docs.filter((doc) => doc.type === "schema");

    lines.push(`- ${category} (${docs.length})`);
    if (categoryDoc) {
      lines.push(`  - 분류 문서: [${categoryDoc.title}](${relativeGuideLink("guide/sitemap.md", categoryDoc.relFile)})`);
    }
    if (guides.length) {
      lines.push(`  - 가이드: ${guides.map((doc) => `[${doc.title}](${relativeGuideLink("guide/sitemap.md", doc.relFile)})`).join(", ")}`);
    }
    if (endpoints.length) {
      lines.push(`  - API ${endpoints.length}개`);
      for (const endpoint of endpoints.slice(0, 8)) {
        lines.push(`    - [${endpoint.title}](${relativeGuideLink("guide/sitemap.md", endpoint.relFile)}) — ${endpoint.method} \`${endpoint.apiPath}\``);
      }
      if (endpoints.length > 8) {
        lines.push(`    - ... 외 ${endpoints.length - 8}개`);
      }
    }
    if (schemas.length) {
      lines.push(`  - 스키마 ${schemas.length}개`);
    }
  }

  lines.push("", "## API 경로 트리", "");
  for (const [version, segments] of groupEndpointsByVersion(entries)) {
    lines.push(`- ${version}`);
    for (const [segment, docs] of segments) {
      lines.push(`  - ${segment} (${docs.length})`);
      for (const doc of docs) {
        lines.push(`    - [${doc.title}](${relativeGuideLink("guide/sitemap.md", doc.relFile)}) — ${doc.method} \`${doc.apiPath}\``);
      }
    }
  }

  const guides = entries.filter((entry) => entry.type === "guide" && entry.relFile !== "guide/sitemap.md");
  const schemas = entries.filter((entry) => entry.type === "schema");
  if (guides.length) {
    lines.push("", "## 가이드", "");
    for (const guide of guides) {
      lines.push(`- [${guide.title}](${relativeGuideLink("guide/sitemap.md", guide.relFile)})`);
    }
  }
  if (schemas.length) {
    lines.push("", "## 스키마", "");
    for (const schema of schemas) {
      lines.push(`- [${schema.title}](${relativeGuideLink("guide/sitemap.md", schema.relFile)})`);
    }
  }

  return lines.join("\n");
}

function groupByCategory(entries: DocEntry[]): Array<[string, DocEntry[]]> {
  const grouped = new Map<string, DocEntry[]>();
  for (const entry of entries) {
    const key = entry.category || "기타";
    const bucket = grouped.get(key) ?? [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], "ko"))
    .map(([category, docs]) => [category, docs.sort(compareDocs)]);
}

function groupEndpointsByVersion(entries: DocEntry[]): Array<[string, Array<[string, DocEntry[]]>]> {
  const grouped = new Map<string, Map<string, DocEntry[]>>();
  for (const entry of entries) {
    if (entry.type !== "api-endpoint" || !entry.apiPath) continue;
    const segments = entry.apiPath.replace(/^\//, "").split("/");
    const version = segments[0] || "other";
    const branch = segments[1] || "(root)";
    const branchMap = grouped.get(version) ?? new Map<string, DocEntry[]>();
    const docs = branchMap.get(branch) ?? [];
    docs.push(entry);
    branchMap.set(branch, docs);
    grouped.set(version, branchMap);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([version, branchMap]) => [
      version,
      [...branchMap.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([segment, docs]) => [segment, docs.sort(compareDocs)]),
    ]);
}

function relativeGuideLink(fromRel: string, toRel: string): string {
  return path.posix.relative(path.posix.dirname(fromRel), toRel);
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

function compareDocs(left: DocEntry, right: DocEntry): number {
  if (left.type !== right.type) return left.type.localeCompare(right.type);
  if (left.apiPath && right.apiPath && left.apiPath !== right.apiPath) return left.apiPath.localeCompare(right.apiPath);
  return left.title.localeCompare(right.title, "ko");
}

function count(entries: DocEntry[], type: string): number {
  return entries.filter((entry) => entry.type === type).length;
}

function mergeKeywords(...parts: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const part of parts) {
    for (const item of part) {
      const normalized = item.toLowerCase().trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      merged.push(normalized);
    }
  }
  return merged.slice(0, 48);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
