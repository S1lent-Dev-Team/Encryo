// db.test.mjs — Server-Persistenz/Logik gegen eine frische Temp-DB. DATA_DIR wird
// VOR dem Import gesetzt, db.js dann dynamisch geladen (legt die DB dort an).

import assert from "node:assert/strict";
import os from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

process.env.DATA_DIR = join(os.tmpdir(), "encryo-test-" + randomBytes(6).toString("hex"));
const db = await import("../server/db.js");

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

// Minimal-Datei-Payload (wie sie der Client schickt).
const f = (filename, size) => ({
  filename,
  size,
  mimetype: "application/octet-stream",
  iv: "iv",
  ciphertext: "ct",
});

console.log("DB");

await test("User + Session Round-Trip", () => {
  const u = db.createUser("alice", "pw123456");
  assert.ok(u.id);
  assert.ok(db.verifyUser("alice", "pw123456"));
  assert.equal(db.verifyUser("alice", "falsch"), null);
  const tok = db.createSession(u.id);
  assert.equal(db.getSessionUser(tok).username, "alice");
  db.deleteSession(tok);
  assert.equal(db.getSessionUser(tok), null);
});

await test("createLink + getLinkMeta (Größe/Anzahl)", () => {
  const { id } = db.createLink({ files: [f("a.bin", 10), f("b.bin", 20)] });
  const m = db.getLinkMeta(id);
  assert.equal(m.found, true);
  assert.equal(m.fileCount, 2);
  assert.equal(m.totalSize, 30);
  assert.equal(m.oneTime, false);
});

await test("openLink erhöht view_count (normal)", () => {
  const { id } = db.createLink({ files: [f("x", 5)] });
  assert.equal(db.openLink(id).ok, true);
  const r = db.openLink(id);
  assert.equal(r.ok, true);
  assert.equal(r.meta.viewCount, 2);
});

await test("One-Time brennt nach dem ersten Öffnen", () => {
  const { id } = db.createLink({ files: [f("x", 5)], oneTime: true });
  assert.equal(db.openLink(id).ok, true);
  const r2 = db.openLink(id);
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, "BURNED");
});

await test("Max-Views brennt beim Erreichen des Limits", () => {
  const { id } = db.createLink({ files: [f("x", 5)], maxViews: 2 });
  assert.equal(db.openLink(id).ok, true);
  assert.equal(db.openLink(id).ok, true);
  const r3 = db.openLink(id);
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, "BURNED");
});

await test("Revoke sperrt sofort; nur der Owner darf", () => {
  const owner = db.createUser("bob", "pw123456");
  const { id } = db.createLink({ files: [f("x", 5)], ownerId: owner.id });
  assert.equal(db.revokeLink(id, "fremd").reason, "FORBIDDEN");
  assert.equal(db.revokeLink(id, owner.id).ok, true);
  assert.equal(db.openLink(id).reason, "REVOKED");
});

await test("Delete nur durch Owner; Link verschwindet", () => {
  const owner = db.createUser("carol", "pw123456");
  const { id } = db.createLink({ files: [f("x", 5)], ownerId: owner.id });
  assert.equal(db.deleteLink(id, "fremd").reason, "FORBIDDEN");
  assert.equal(db.deleteLink(id, owner.id).ok, true);
  assert.equal(db.getLinkMeta(id).found, false);
});

await test("ownerUsage zählt Links + Bytes korrekt", () => {
  const owner = db.createUser("dave", "pw123456");
  db.createLink({ files: [f("x", 100)], ownerId: owner.id });
  db.createLink({ files: [f("y", 50), f("z", 25)], ownerId: owner.id });
  const u = db.ownerUsage(owner.id);
  assert.equal(u.count, 2);
  assert.equal(u.bytes, 175);
});

await test("reclaimDeadCiphertext gibt verbrannte Links frei", () => {
  const { id } = db.createLink({ files: [f("x", 5)], oneTime: true });
  db.openLink(id); // brennt
  assert.ok(db.reclaimDeadCiphertext() >= 1);
  // Bereits geleerte Links zählen nicht erneut.
  assert.equal(db.reclaimDeadCiphertext(), 0);
});

await test("purgeExpiredSessions lässt frische Sessions leben", () => {
  const u = db.createUser("erin", "pw123456");
  const tok = db.createSession(u.id);
  db.purgeExpiredSessions();
  assert.equal(db.getSessionUser(tok)?.username, "erin");
});

await test("API-Token: erstellen, auflösen, widerrufen", () => {
  const u = db.createUser("frank", "pw123456");
  const { id, token } = db.createApiToken(u.id, "cli");
  assert.ok(token.startsWith("enc_"));
  // Rohwert löst auf den richtigen User auf.
  assert.equal(db.getUserByApiToken(token)?.id, u.id);
  // Falscher Token -> null.
  assert.equal(db.getUserByApiToken("enc_falsch"), null);
  // Listing zeigt das Token (ohne Rohwert) + lastUsed nach Nutzung.
  const list = db.listApiTokens(u.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].label, "cli");
  assert.ok(list[0].lastUsed);
  // Widerrufen -> Token wirkungslos.
  assert.equal(db.deleteApiToken(id, u.id).ok, true);
  assert.equal(db.getUserByApiToken(token), null);
});

await test("API-Token: nur der Owner darf widerrufen", () => {
  const u = db.createUser("grace", "pw123456");
  const { id } = db.createApiToken(u.id, "x");
  assert.equal(db.deleteApiToken(id, "fremd").ok, false);
});

if (failed) {
  console.error(`\n${failed} Test(s) fehlgeschlagen.`);
  process.exit(1);
}
console.log("\nAlle Tests bestanden.");
