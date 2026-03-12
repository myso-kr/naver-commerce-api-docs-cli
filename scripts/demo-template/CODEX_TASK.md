Build a deeper Node.js ESM demo client in `codex-child/` for the Naver Commerce API.

Requirements:
- Use the locally installed `npx naver-commerce-api-docs-cli` as the primary evidence source for docs and endpoint grounding.
- Follow the generated `AGENTS.md` and installed skill before doing anything else.
- Do not use web search or external browsing for API docs in this task.
- Call the CLI as a subprocess. Do not import from `node_modules/naver-commerce-api-docs-cli/dist/*`.
- Do not inspect `node_modules/naver-commerce-api-docs-cli/` for evidence, including `docs/`, `dist/`, or `package.json`. Treat the package as a subprocess-only tool.
- Gather evidence in this order: `npx naver-commerce-api-docs-cli ask "<question>"`, then `npx naver-commerce-api-docs-cli api --path <path> --method <METHOD> --body`, then implementation.
- For multi-endpoint tasks, split retrieval into separate CLI questions per endpoint instead of relying on one broad `ask` query to cover everything.
- Before writing any files, collect exact endpoint grounding for all three endpoints:
  - `POST /v1/oauth2/token`
  - `POST /v2/products`
  - `POST /v1/products/search`
- After the three exact `api` lookups are complete and before writing files, emit an agent progress message that contains the exact marker `GROUNDING_COMPLETE`.
- Create `codex-child/client.mjs` that exports:
  - `issueToken({ clientId, clientSecretSign, timestamp, type, accountId, fetchImpl })`
  - `createProduct({ token, payload, fetchImpl })`
  - `searchProducts({ token, criteria, fetchImpl })`
  - `createAndVerifyProduct({ auth, productPayload, fetchImpl })`
- Use the exact documented HTTP methods, paths, content types, and auth header requirements.
- `issueToken` should call the token issuance endpoint and return parsed JSON.
- `createProduct` should call the product creation endpoint and return parsed JSON.
- `searchProducts` should call the documented product search endpoint and return parsed JSON.
- `createAndVerifyProduct` should:
  - issue a token
  - create a product
  - read `originProductNo` from the create response
  - search for that origin product with `POST /v1/products/search`
  - return the chained results
- Accept `fetchImpl` so the module can be tested without real network calls.
- Create `codex-child/client.test.mjs` with mocked fetch tests that verify:
  - token request URL, method, headers, and form encoding
  - product creation URL, method, headers, and JSON body
  - product search URL, method, headers, and JSON body
  - the chained `createAndVerifyProduct(...)` flow
- Create `codex-child/REPORT.md` summarizing what evidence you used and why the implementation matches it.
- In `REPORT.md`, cite the CLI commands you ran as evidence. Do not cite direct file reads from the installed package.
- Run the relevant checks before finishing.

Do not ask for clarification. Make reasonable assumptions and complete the work end-to-end.
