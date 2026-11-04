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

for (const route of ["/auth-config.js", "/account-ui.js", "/onboarding.js", "/pwa.js", "/sw.js", "/vendor/supabase-2.118.0.js", "/account-ui.css", "/onboarding.css"]) {
 const response=await workerModule.default.fetch(new Request("https://example.test"+route));
 assert.equal(response.status,200,route+" must be embedded");
 assert.ok((await response.text()).length>100);
}
const manifestResponse=await workerModule.default.fetch(new Request("https://example.test/manifest.webmanifest"));
const appManifest=await manifestResponse.json();assert.equal(appManifest.display,"standalone");assert.equal(appManifest.scope,"./");
const png=await workerModule.default.fetch(new Request("https://example.test/icons/icon-512.png"));
assert.equal(png.headers.get("Content-Type"),"image/png");
assert.deepEqual([...new Uint8Array(await png.arrayBuffer()).slice(0,8)],[137,80,78,71,13,10,26,10]);
const originalFetch=globalThis.fetch;
try {
 globalThis.fetch=async()=>new Response(JSON.stringify({id:"123e4567-e89b-42d3-a456-426614174000",email:"test@example.test",email_confirmed_at:"2026-01-01T00:00:00Z",is_anonymous:false,user_metadata:{}}),{headers:{"Content-Type":"application/json"}});
 const authenticated=await workerModule.default.fetch(new Request("https://example.test/api/account",{headers:{Authorization:"Bearer a.b.c"}}),{});
 assert.equal(authenticated.status,503,"verified provider identity must reach the database boundary");
 globalThis.fetch=async()=>new Response("{}",{status:401});
 const invalid=await workerModule.default.fetch(new Request("https://example.test/api/account",{headers:{Authorization:"Bearer a.b.c"}}),{});
 assert.equal(invalid.status,401,"forged provider identity must be rejected");
}finally{globalThis.fetch=originalFetch;}
console.log("PWA assets, icons and verified provider routing are packaged");
