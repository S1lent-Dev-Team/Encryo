// zip.js — minimaler ZIP-Writer (Speichermethode, ohne Kompression), damit eine
// Collection als eine .zip heruntergeladen werden kann. Bewusst ohne Dependency:
// die Dateien liegen ohnehin schon entschlüsselt im Speicher.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// DOS-Zeitstempel (ZIP nutzt das alte FAT-Format). Aktuelle Zeit reicht.
function dosDateTime(d = new Date()) {
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const date =
    ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// Doppelte Namen innerhalb des Archivs eindeutig machen ("a.png", "a (1).png").
function dedupeNames(names) {
  const seen = new Map();
  return names.map((name) => {
    if (!seen.has(name)) {
      seen.set(name, 0);
      return name;
    }
    const n = seen.get(name) + 1;
    seen.set(name, n);
    const dot = name.lastIndexOf(".");
    return dot > 0
      ? `${name.slice(0, dot)} (${n})${name.slice(dot)}`
      : `${name} (${n})`;
  });
}

// entries: [{ name, bytes: Uint8Array }] -> Blob (application/zip)
export function makeZipBlob(entries) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime();
  const names = dedupeNames(entries.map((e) => e.name));

  const localParts = [];
  const central = [];
  let offset = 0;

  entries.forEach((entry, i) => {
    const nameBytes = enc.encode(names[i]);
    const data = entry.bytes;
    const crc = crc32(data);
    const size = data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header signature
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // flags: UTF-8 names
    local.setUint16(8, 0, true); // method: store
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed size
    local.setUint32(22, size, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra length
    localParts.push(new Uint8Array(local.buffer), nameBytes, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); // central dir signature
    cen.setUint16(4, 20, true); // version made by
    cen.setUint16(6, 20, true); // version needed
    cen.setUint16(8, 0x0800, true); // flags
    cen.setUint16(10, 0, true); // method
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, size, true);
    cen.setUint32(24, size, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint16(30, 0, true); // extra
    cen.setUint16(32, 0, true); // comment
    cen.setUint16(34, 0, true); // disk
    cen.setUint16(36, 0, true); // internal attrs
    cen.setUint32(38, 0, true); // external attrs
    cen.setUint32(42, offset, true); // local header offset
    central.push(new Uint8Array(cen.buffer), nameBytes);

    offset += 30 + nameBytes.length + size;
  });

  const centralSize = central.reduce((s, p) => s + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // end of central dir signature
  eocd.setUint16(8, entries.length, true); // entries on this disk
  eocd.setUint16(10, entries.length, true); // total entries
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true); // central dir offset
  eocd.setUint16(20, 0, true); // comment length

  return new Blob([...localParts, ...central, new Uint8Array(eocd.buffer)], {
    type: "application/zip",
  });
}
