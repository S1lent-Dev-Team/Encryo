// store.js — Datenlayer gegen das echte Backend (Express + SQLite).
// Verschlüsselung passiert weiterhin komplett im Browser; hier geht nur
// Ciphertext + Metadaten über die Leitung. Der Key (im #-Fragment) und das
// Datei-Passwort werden NIE an den Server gesendet.

const API = "/api";

async function req(path, opts = {}) {
  const res = await fetch(API + path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* leere Antwort */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// POST /api/links  — Einmal-Upload (kleine Dateien). Server vergibt die ID.
// opts: { files, salt, verifier, oneTime, expiresInHours, passwordProtected,
//         maxViews, recovery, preview }. Antwort: { id, expiresAt, forced }.
export async function createLink(opts) {
  return req("/links", { method: "POST", body: JSON.stringify(opts) });
}

// base64-Zeichen pro Chunk (~6 MB Request) — klein genug für Proxy-Body-Limits.
const UPLOAD_CHUNK = 6 * 1024 * 1024;

function abortError() {
  const e = new Error("Abgebrochen.");
  e.aborted = true;
  return e;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Flexibler XHR-Request mit Upload-/Download-Fortschritt + Abbruch (AbortSignal).
function xhrRequest(method, path, body, { onUpload, onDownload, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const xhr = new XMLHttpRequest();
    xhr.open(method, API + path);
    if (body != null) xhr.setRequestHeader("Content-Type", "application/json");
    xhr.withCredentials = true;
    if (onUpload && xhr.upload)
      xhr.upload.onprogress = (e) => e.lengthComputable && onUpload(e.loaded, e.total);
    if (onDownload) xhr.onprogress = (e) => e.lengthComputable && onDownload(e.loaded, e.total);
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort);
    const done = () => signal?.removeEventListener("abort", onAbort);
    xhr.onload = () => {
      done();
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* leere/ungültige Antwort */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        const err = new Error(data?.error || `HTTP ${xhr.status}`);
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => {
      done();
      reject(new Error("Netzwerkfehler."));
    };
    xhr.onabort = () => {
      done();
      reject(abortError());
    };
    xhr.send(body);
  });
}

// Chunk mit Retry (exponentieller Backoff) bei transienten Fehlern.
async function sendChunkWithRetry(path, body, { signal, onUpload }, retries = 3) {
  let attempt = 0;
  for (;;) {
    try {
      return await xhrRequest("POST", path, body, { signal, onUpload });
    } catch (e) {
      if (e.aborted) throw e;
      // 4xx (außer 429) sind dauerhaft -> nicht wiederholen.
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
      if (++attempt > retries) throw e;
      await sleep(Math.min(4000, 400 * 2 ** (attempt - 1)));
      if (signal?.aborted) throw abortError();
    }
  }
}

// --- Granulare Chunk-Upload-API (ermöglicht Abbruch + Resume in der UI) -----
export async function startUpload() {
  const { uploadId } = await req("/uploads", { method: "POST", body: "{}" });
  return uploadId;
}

export function completeUpload(uploadId, opts) {
  return req(`/uploads/${encodeURIComponent(uploadId)}/complete`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export function uploadTotalChars(files) {
  return files.reduce((s, f) => s + f.ciphertext.length, 0) || 1;
}

// Lädt alle Chunks ab `from` ({fileIndex,chunkIndex}) hoch. onProgress(sentChars)
// ist absolut. Wirft bei Abbruch (e.aborted) ODER Fehler — beides mit e.position
// für ein Resume. Idempotent dank chunkIndex (Retry/Resume überschreiben sich).
export async function uploadChunks(uploadId, files, { signal, onProgress, from } = {}) {
  const startFile = from?.fileIndex ?? 0;
  const startChunk = from?.chunkIndex ?? 0;
  let sent = 0;
  let pos = { fileIndex: 0, chunkIndex: 0 };
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const nChunks = Math.max(1, Math.ceil(f.ciphertext.length / UPLOAD_CHUNK));
      for (let ci = 0; ci < nChunks; ci++) {
        const chunk = f.ciphertext.slice(ci * UPLOAD_CHUNK, (ci + 1) * UPLOAD_CHUNK);
        if (i < startFile || (i === startFile && ci < startChunk)) {
          sent += chunk.length; // bereits hochgeladen (Resume überspringt)
          continue;
        }
        pos = { fileIndex: i, chunkIndex: ci };
        const base = sent;
        await sendChunkWithRetry(
          `/uploads/${encodeURIComponent(uploadId)}/chunk`,
          JSON.stringify({
            fileIndex: i,
            chunkIndex: ci,
            filename: f.filename,
            size: f.size,
            mimetype: f.mimetype,
            iv: f.iv,
            chunk,
          }),
          { signal, onUpload: (l, t) => onProgress?.(base + (t ? l / t : 1) * chunk.length) }
        );
        sent += chunk.length;
        onProgress?.(sent);
      }
    }
  } catch (e) {
    e.position = pos;
    throw e;
  }
}

// GET /api/links/:id — öffentliche Metadaten (ohne Ciphertext, nicht destruktiv).
export async function getLinkMeta(id) {
  return req(`/links/${encodeURIComponent(id)}`);
}

// POST /api/links/:id/open — atomar: view_count++, ggf. burn. Liefert Ciphertext.
// onDownload(loaded,total) meldet den Download-Fortschritt des (großen) Ciphertexts.
export async function openLink(id, onDownload) {
  return xhrRequest("POST", `/links/${encodeURIComponent(id)}/open`, null, { onDownload });
}

// DELETE /api/links/:id — nur als Owner (Session).
export async function deleteLink(id) {
  return req(`/links/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// POST /api/links/:id/revoke — Kill-Switch, sperrt den Link sofort (nur Owner).
export async function revokeLink(id) {
  return req(`/links/${encodeURIComponent(id)}/revoke`, { method: "POST" });
}

// GET /api/links/:id/recovery — verschlüsselter Recovery-Vault (nur Owner).
export async function getLinkRecovery(id) {
  return req(`/links/${encodeURIComponent(id)}/recovery`);
}

// GET /api/links — eigene Links (erfordert Login). Wirft bei 401.
export async function listMyLinks() {
  return req("/links");
}
