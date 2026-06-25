// ratelimit.test.mjs — der In-Memory-Limiter (Middleware), ohne echten Server.

import assert from "node:assert/strict";
import { rateLimit } from "../server/ratelimit.js";

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("  ✓ " + name);
  } catch (e) {
    failed++;
    console.error("  ✗ " + name + "\n    " + (e?.message || e));
  }
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

// Ruft den Limiter einmal auf -> { passed, res }
function hit(limiter, ip) {
  const req = { ip, socket: {} };
  const res = fakeRes();
  let passed = false;
  limiter(req, res, () => {
    passed = true;
  });
  return { passed, res };
}

console.log("Rate-Limit");

await test("lässt bis max durch, danach 429 mit Retry-After", () => {
  const limiter = rateLimit({ windowMs: 1000, max: 3 });
  let allowed = 0;
  let last;
  for (let i = 0; i < 4; i++) {
    const { passed, res } = hit(limiter, "1.2.3.4");
    if (passed) allowed++;
    last = res;
  }
  assert.equal(allowed, 3);
  assert.equal(last.statusCode, 429);
  assert.ok(last.headers["Retry-After"]);
  assert.equal(last.body.retryAfter > 0, true);
});

await test("verschiedene IPs zählen unabhängig", () => {
  const limiter = rateLimit({ windowMs: 1000, max: 1 });
  assert.equal(hit(limiter, "1.1.1.1").passed, true);
  assert.equal(hit(limiter, "2.2.2.2").passed, true);
  assert.equal(hit(limiter, "1.1.1.1").passed, false); // 2. Treffer derselben IP
});

if (failed) {
  console.error(`\n${failed} Test(s) fehlgeschlagen.`);
  process.exit(1);
}
console.log("\nAlle Tests bestanden.");
