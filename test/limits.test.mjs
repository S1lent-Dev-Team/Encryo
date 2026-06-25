// limits.test.mjs — Upload-/Quota-Logik (rein, ohne DB/Server). Robust gegen
// Anpassungen der konkreten Zahlen: prüft gegen LIMITS/ACCOUNT_QUOTA selbst.

import assert from "node:assert/strict";
import {
  checkUpload,
  effectiveExpiryHours,
  checkAccountQuota,
  LIMITS,
  ACCOUNT_QUOTA,
  FORCED_EXPIRY_HOURS,
} from "../src/lib/limits.js";

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

console.log("Limits");

await test("anon: unter Freikontingent -> ok, nicht erzwungen", () => {
  assert.deepEqual(checkUpload({ totalSize: LIMITS.anon.free - 1, isLoggedIn: false }), {
    ok: true,
    forced: false,
  });
});

await test("anon: zwischen free und hard -> erlaubt, Ablauf erzwungen", () => {
  if (LIMITS.anon.hard <= LIMITS.anon.free) return; // bei free==hard nichts zu prüfen
  assert.deepEqual(checkUpload({ totalSize: LIMITS.anon.free + 1, isLoggedIn: false }), {
    ok: true,
    forced: true,
  });
});

await test("anon: über hard -> NEED_ACCOUNT", () => {
  const r = checkUpload({ totalSize: LIMITS.anon.hard + 1, isLoggedIn: false });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "NEED_ACCOUNT");
});

await test("account: über hard -> TOO_BIG", () => {
  const r = checkUpload({ totalSize: LIMITS.account.hard + 1, isLoggedIn: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "TOO_BIG");
});

await test("effectiveExpiryHours: über free deckelt auf FORCED", () => {
  assert.equal(
    effectiveExpiryHours({ totalSize: LIMITS.account.free + 1, isLoggedIn: true, requestedHours: null }),
    FORCED_EXPIRY_HOURS
  );
});

await test("effectiveExpiryHours: kürzere Wahl bleibt erhalten", () => {
  assert.equal(
    effectiveExpiryHours({ totalSize: LIMITS.account.free + 1, isLoggedIn: true, requestedHours: 1 }),
    1
  );
});

await test("effectiveExpiryHours: unter free bleibt unverändert", () => {
  assert.equal(
    effectiveExpiryHours({ totalSize: 1, isLoggedIn: true, requestedHours: 168 }),
    168
  );
});

await test("checkAccountQuota: Link-Limit", () => {
  assert.deepEqual(
    checkAccountQuota({ currentLinks: ACCOUNT_QUOTA.maxLinks, currentBytes: 0, addBytes: 1 }),
    { ok: false, reason: "LINK_LIMIT" }
  );
});

await test("checkAccountQuota: Speicher-Limit", () => {
  assert.deepEqual(
    checkAccountQuota({ currentLinks: 0, currentBytes: ACCOUNT_QUOTA.maxTotal, addBytes: 1 }),
    { ok: false, reason: "STORAGE_LIMIT" }
  );
});

await test("checkAccountQuota: im Rahmen -> ok", () => {
  assert.deepEqual(checkAccountQuota({ currentLinks: 0, currentBytes: 0, addBytes: 1 }), {
    ok: true,
  });
});

if (failed) {
  console.error(`\n${failed} Test(s) fehlgeschlagen.`);
  process.exit(1);
}
console.log("\nAlle Tests bestanden.");
