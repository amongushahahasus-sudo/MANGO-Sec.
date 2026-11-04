import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");

const [source, manifest] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);
JSON.parse(manifest);

// A data URL forces ESM parsing even though the generated output has no package.json.
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(
  typeof workerModule.default?.fetch,
  "function",
  `${pathToFileURL(workerPath)} must export default.fetch`,
);

console.log("Artifact is valid ESM and exports default.fetch");

const home = await workerModule.default.fetch(new Request("https://example.test/"));
assert.equal(home.status, 200);
assert.match(home.headers.get("Content-Type"), /text\/html/);
assert.match(await home.text(), /MANGO Sec\./);
for (const route of ["/app.js", "/styles.css", "/trading.js", "/auth-client.js", "/theme.js", "/charts.js"]) {
  const response = await workerModule.default.fetch(new Request("https://example.test" + route));
  assert.equal(response.status, 200, `${route} must be embedded`);
  assert.ok((await response.text()).length > 100);
}
const stocks = await workerModule.default.fetch(new Request("https://example.test/api/stocks"));
assert.ok((await stocks.json()).some(stock => stock.symbol === "285A.T"));
const missing = await workerModule.default.fetch(new Request("https://example.test/missing"));
assert.equal(missing.status, 404);
const head = await workerModule.default.fetch(new Request("https://example.test/api/stocks", {method:"HEAD"}));
assert.equal((await head.text()), "");
console.log("Worker routes serve browser assets and API; HEAD has no body");

const journal=JSON.parse(await readFile(resolve(projectRoot,"dist/.openai/drizzle/meta/_journal.json"),"utf8"));
assert.equal(journal.entries[0].tag,"0000_mango_accounts");
const cors=await workerModule.default.fetch(new Request("https://example.test/api/account",{headers:{Origin:"https://amongushahahasus-sudo.github.io"}}));
assert.equal(cors.status,401);
assert.equal(cors.headers.get("Access-Control-Allow-Origin"),"https://amongushahahasus-sudo.github.io");
console.log("Authenticated API and database migration sidecar are packaged");
