// recovery.test.mjs — deckt den Recovery-Vault-Round-Trip ab (reine Krypto, keine
// DB, kein Server). Nutzt dieselben Web-Crypto-Funktionen wie der Browser
// (in Node 20+ global verfügbar).
//
//   node test/recovery.test.mjs   bzw.   npm test

import assert from "node:assert/strict";
import {
  generateKey,
  exportKeyToFragment,
  importKeyFromFragment,
  newSalt,
  deriveRecoveryKey,
  wrapSecret,
  unwrapSecret,
  encryptBytes,
  decryptToBytes,
} from "../src/lib/crypto.js";

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

console.log("Recovery-Vault");

await test("Round-Trip: keyless-Secret wrappen → unwrappen ergibt dasselbe", async () => {
  const salt = newSalt();
  const rkey = await deriveRecoveryKey("account-pw", salt);
  const key = await generateKey();
  const fragment = await exportKeyToFragment(key);

  const blob = await wrapSecret(rkey, { t: "k", v: fragment });
  const out = await unwrapSecret(rkey, blob);
  assert.deepEqual(out, { t: "k", v: fragment });
});

await test("Recovertes Fragment rekonstruiert einen funktionierenden Datei-Key", async () => {
  const salt = newSalt();
  const rkey = await deriveRecoveryKey("account-pw", salt);
  const key = await generateKey();
  const fragment = await exportKeyToFragment(key);

  // mit dem Originalschlüssel etwas verschlüsseln …
  const plain = new TextEncoder().encode("geheime Datei");
  const { iv, ciphertext } = await encryptBytes(key, plain);

  // … Vault rundreisen, Key aus dem recoverten Fragment neu aufbauen …
  const blob = await wrapSecret(rkey, { t: "k", v: fragment });
  const { v } = await unwrapSecret(rkey, blob);
  const recoveredKey = await importKeyFromFragment(v);

  // … und damit wieder entschlüsseln.
  const back = await decryptToBytes(recoveredKey, iv, ciphertext);
  assert.equal(new TextDecoder().decode(back), "geheime Datei");
});

await test("Falsches Account-Passwort kann den Vault nicht öffnen", async () => {
  const salt = newSalt();
  const rkey = await deriveRecoveryKey("richtig", salt);
  const wrong = await deriveRecoveryKey("falsch", salt);
  const blob = await wrapSecret(rkey, { t: "p", v: "dateipasswort" });
  await assert.rejects(() => unwrapSecret(wrong, blob));
});

await test("Re-Wrap: nach PW-Wechsel öffnet nur der neue Key", async () => {
  const salt = newSalt();
  const oldKey = await deriveRecoveryKey("altes-pw", salt);
  const newKey = await deriveRecoveryKey("neues-pw", salt);
  const secret = { t: "p", v: "s3cr3t" };

  const oldBlob = await wrapSecret(oldKey, secret);
  const recovered = await unwrapSecret(oldKey, oldBlob);
  const newBlob = await wrapSecret(newKey, recovered); // re-wrap

  assert.deepEqual(await unwrapSecret(newKey, newBlob), secret);
  await assert.rejects(() => unwrapSecret(oldKey, newBlob));
});

if (failed) {
  console.error(`\n${failed} Test(s) fehlgeschlagen.`);
  process.exit(1);
}
console.log("\nAlle Tests bestanden.");
