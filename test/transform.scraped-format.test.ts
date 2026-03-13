import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pageToMarkdown, urlToFilepath as topLevelUrlToFilepath } from "../src/scrape/browser.js";
import { urlToFilepath as apiUrlToFilepath } from "../src/scrape-api/crawler.js";
import {
  detectPageType,
  extractMethodAndPath,
  makeDestPath,
} from "../src/transform/converter.js";
import { convertMethodBlock } from "../src/transform/fixes.js";
import { run as runTransform, transformFile } from "../src/transform/index.js";
import { parseFrontmatter } from "../src/core/frontmatter.js";

describe("scraped raw format compatibility", () => {
  it("detects plain scraped method blocks as api endpoints", () => {
    const content = [
      "# (v2) 그룹상품 등록",
      "",
      "> 원문: https://apicenter.commerce.naver.com/docs/commerce-api/current/create-product-1-product",
      "",
      "# (v2) 그룹상품 등록",
      "",
      "POST ",
      "",
      "## /v2/standard-group-products",
      "",
      "비동기로 동작합니다.",
      "",
    ].join("\n");

    expect(detectPageType(content, "create-product-1-product.md")).toBe("api-endpoint");
    expect(extractMethodAndPath(content)).toEqual(["POST", "/v2/standard-group-products"]);
    expect(
      convertMethodBlock(
        content,
        "POST",
        "/v2/standard-group-products",
        "https://api.commerce.naver.com/external",
      ),
    ).toContain("> **POST** `https://api.commerce.naver.com/external/v2/standard-group-products`");
  });

  it("decodes percent-encoded source filenames for destination paths", () => {
    const dest = makeDestPath(
      "category-index",
      "",
      "",
      "%EA%B3%A0%EA%B0%9D-%EB%8D%B0%EC%9D%B4%ED%84%B0.md",
      { dst: "docs" },
    );
    expect(dest).toBe(path.join("docs", "category", "고객-데이터.md"));
  });

  it("uses decoded path segments when saving scraped files", () => {
    expect(
      apiUrlToFilepath(
        "https://apicenter.commerce.naver.com/docs/commerce-api/current/%EA%B3%A0%EA%B0%9D-%EB%8D%B0%EC%9D%B4%ED%84%B0",
        "raw",
      ),
    ).toBe(path.join("raw", "고객-데이터.md"));

    expect(
      topLevelUrlToFilepath(
        "https://apicenter.commerce.naver.com/docs/%EC%A0%9C%ED%95%9C-%EC%82%AC%ED%95%AD",
        "raw",
      ),
    ).toBe(path.join("raw", "제한-사항.md"));
  });

  it("normalizes category cards and avoids /docs links in category descriptions", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "naver-commerce-category-"));
    const srcRoot = path.join(tmpRoot, "raws");
    const dstRoot = path.join(tmpRoot, "docs");
    const srcPath = path.join(srcRoot, "브랜드.md");

    fs.mkdirSync(srcRoot, { recursive: true });
    fs.writeFileSync(
      srcPath,
      [
        "# 브랜드",
        "",
        "> 원문: https://apicenter.commerce.naver.com/docs/commerce-api/current/브랜드",
        "",
        "브랜드 API",
        "",
        "[## 📄️ 브랜드 조회",
        "",
        "브랜드 조회](/docs/commerce-api/current/get-brand-list-product)",
        "",
      ].join("\n"),
      "utf-8",
    );

    const stemMap = new Map<string, string>([
      ["get-brand-list-product", path.join(dstRoot, "api", "v1", "product-brands.GET.md")],
    ]);

    const result = transformFile(srcPath, stemMap, { src: srcRoot, dst: dstRoot });
    expect(result).not.toBeNull();

    const [, output] = result!;
    const [fm, body] = parseFrontmatter(output);
    expect(String(fm.description)).not.toMatch(/\/docs\//);
    expect(String(fm.description)).toMatch(/브랜드 관련 API 문서를 모아둔 카테고리 인덱스/);
    expect(body).toMatch(/카테고리 인덱스입니다/);
    expect(body).toMatch(/## 관련 문서/);
    expect(body).toMatch(/\| \[브랜드 조회\]\(\.\.\/api\/v1\/product-brands\.GET\.md\) \| 브랜드 조회 \|/);
  });

  it("detects newline-delimited category cards from fresh scrape output", () => {
    const content = [
      "# OAuth 2.0",
      "",
      "> 원문: https://apicenter.commerce.naver.com/docs/commerce-api/current/o-auth-2-0",
      "",
      "OAuth 2.0 API",
      "",
      "[",
      "",
      "## 📄️ 인증 토큰 발급 요청",
      "",
      "인증 문서 설명",
      "",
      "](/docs/commerce-api/current/exchange-sellers-auth)",
    ].join("\n");

    expect(detectPageType(content, "o-auth-2-0.md")).toBe("category-index");
  });

  it("emits frontmatter keywords derived from api metadata", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "naver-commerce-keywords-"));
    const srcRoot = path.join(tmpRoot, "raws");
    const dstRoot = path.join(tmpRoot, "docs");
    const srcPath = path.join(srcRoot, "oauth-token.md");

    fs.mkdirSync(srcRoot, { recursive: true });
    fs.writeFileSync(
      srcPath,
      [
        "# 인증 토큰 발급 요청",
        "",
        "> 원문: https://apicenter.commerce.naver.com/docs/commerce-api/current/create-access-token",
        "",
        "POST ",
        "",
        "## /v1/oauth2/token",
        "",
        "OAuth 2.0 client credentials 방식으로 인증 토큰을 발급합니다.",
      ].join("\n"),
      "utf-8",
    );

    const result = transformFile(srcPath, new Map<string, string>(), { src: srcRoot, dst: dstRoot });
    expect(result).not.toBeNull();

    const [, output] = result!;
    const [fm] = parseFrontmatter(output);
    expect(fm.keywords).toEqual(expect.arrayContaining([
      "oauth2",
      "token",
      "client_credentials",
      "/v1/oauth2/token",
      "post /v1/oauth2/token",
    ]));
    expect((fm.keywords as string[]).every((keyword) => keyword.length <= 96)).toBe(true);
  });

  it("generates a sitemap guide from normalized docs", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "naver-commerce-sitemap-"));
    const srcRoot = path.join(tmpRoot, "raws");
    const dstRoot = path.join(tmpRoot, "docs");

    fs.mkdirSync(srcRoot, { recursive: true });
    fs.writeFileSync(
      path.join(srcRoot, "oauth-token.md"),
      [
        "# 인증 토큰 발급 요청",
        "",
        "> 원문: https://apicenter.commerce.naver.com/docs/commerce-api/current/exchange-sellers-auth",
        "",
        "POST ",
        "",
        "## /v1/oauth2/token",
        "",
        "OAuth 2.0 client credentials 방식으로 인증 토큰을 발급합니다.",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(srcRoot, "create-product.md"),
      [
        "# 상품 등록",
        "",
        "> 원문: https://apicenter.commerce.naver.com/docs/commerce-api/current/create-product-product",
        "",
        "POST ",
        "",
        "## /v2/products",
        "",
        "상품을 등록합니다.",
      ].join("\n"),
      "utf-8",
    );

    expect(runTransform({ src: srcRoot, dst: dstRoot })).toBe(0);

    const sitemapPath = path.join(dstRoot, "guide", "sitemap.md");
    expect(fs.existsSync(sitemapPath)).toBe(true);

    const [fm, body] = parseFrontmatter(fs.readFileSync(sitemapPath, "utf-8"));
    expect(fm.title).toBe("커머스API 사이트맵");
    expect(fm.tags).toEqual(expect.arrayContaining(["reference", "sitemap", "tree"]));
    expect(body).toMatch(/## 카테고리 트리/);
    expect(body).toMatch(/\[인증 토큰 발급 요청\]\(\.\.\/api\/v1\/oauth2\/token\.POST\.md\)/);
    expect(body).toMatch(/## API 경로 트리/);
    expect(body).toMatch(/POST `\/v1\/oauth2\/token`/);
    expect(body).toMatch(/POST `\/v2\/products`/);
  });
});
