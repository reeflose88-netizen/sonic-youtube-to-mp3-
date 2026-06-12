// CRC-32 table for ZIP checksums
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

function writeUint16LE(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}
function writeUint32LE(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

export async function createZip(files: { name: string; data: Uint8Array }[]): Promise<Blob> {
  const localHeaders: Uint8Array[] = [];
  const centralDirs: Uint8Array[] = [];
  const offsets: number[] = [];
  let dataOffset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const compressed = await deflate(file.data);
    const crc = crc32(file.data);
    offsets.push(dataOffset);

    // Local file header (30 bytes + name)
    const lh = new DataView(new ArrayBuffer(30 + nameBytes.length));
    writeUint32LE(lh, 0, 0x04034b50);  // signature
    writeUint16LE(lh, 4, 20);           // version needed
    writeUint16LE(lh, 6, 0);            // flags
    writeUint16LE(lh, 8, 8);            // deflate
    writeUint16LE(lh, 10, 0);           // mod time
    writeUint16LE(lh, 12, 0);           // mod date
    writeUint32LE(lh, 14, crc);
    writeUint32LE(lh, 18, compressed.length);
    writeUint32LE(lh, 22, file.data.length);
    writeUint16LE(lh, 26, nameBytes.length);
    writeUint16LE(lh, 28, 0);           // extra field length
    new Uint8Array(lh.buffer).set(nameBytes, 30);

    const lhBytes = new Uint8Array(lh.buffer);
    localHeaders.push(lhBytes, compressed);
    dataOffset += lhBytes.length + compressed.length;

    // Central directory entry (46 bytes + name)
    const cd = new DataView(new ArrayBuffer(46 + nameBytes.length));
    writeUint32LE(cd, 0, 0x02014b50);
    writeUint16LE(cd, 4, 20);
    writeUint16LE(cd, 6, 20);
    writeUint16LE(cd, 8, 0);
    writeUint16LE(cd, 10, 8);           // deflate
    writeUint16LE(cd, 12, 0);
    writeUint16LE(cd, 14, 0);
    writeUint32LE(cd, 16, crc);
    writeUint32LE(cd, 20, compressed.length);
    writeUint32LE(cd, 24, file.data.length);
    writeUint16LE(cd, 28, nameBytes.length);
    writeUint16LE(cd, 30, 0);
    writeUint16LE(cd, 32, 0);
    writeUint16LE(cd, 34, 0);
    writeUint16LE(cd, 36, 0);
    writeUint32LE(cd, 38, 0);
    writeUint32LE(cd, 42, offsets[centralDirs.length]);
    new Uint8Array(cd.buffer).set(nameBytes, 46);
    centralDirs.push(new Uint8Array(cd.buffer));
  }

  // Central directory bytes
  const cdSize = centralDirs.reduce((s, e) => s + e.length, 0);
  const cdBuffer = new Uint8Array(cdSize);
  let cdOff = 0;
  for (const entry of centralDirs) { cdBuffer.set(entry, cdOff); cdOff += entry.length; }

  // End of central directory
  const eocd = new DataView(new ArrayBuffer(22));
  writeUint32LE(eocd, 0, 0x06054b50);
  writeUint16LE(eocd, 4, 0);
  writeUint16LE(eocd, 6, 0);
  writeUint16LE(eocd, 8, files.length);
  writeUint16LE(eocd, 10, files.length);
  writeUint32LE(eocd, 12, cdSize);
  writeUint32LE(eocd, 16, dataOffset);
  writeUint16LE(eocd, 20, 0);

  return new Blob([...localHeaders, cdBuffer, new Uint8Array(eocd.buffer)], { type: "application/zip" });
}
