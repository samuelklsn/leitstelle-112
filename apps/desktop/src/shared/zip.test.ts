import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, createZip } from './zip';

/** Liest ein Archiv über das zentrale Verzeichnis – so wie es Windows-Explorer tut. */
function readZip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const localNameLen = buf.readUInt16LE(offset + 26);
    const start = offset + 30 + localNameLen;
    const data = inflateRawSync(buf.subarray(start, start + size));
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    p += 46 + nameLen;
  }
  return out;
}

describe('ZIP-Schreiber', () => {
  it('berechnet CRC-32 wie der Standard', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('erzeugt ein lesbares Archiv mit Umlauten im Namen', () => {
    const zip = createZip([
      { name: 'logs/main.log', data: Buffer.from('{"msg":"App startet"}\n'.repeat(50)) },
      { name: 'crashes/Bericht-Übersicht.json', data: Buffer.from('{"ok":true}') },
      { name: 'leer.txt', data: new Uint8Array() },
    ]);
    const files = readZip(zip);
    expect([...files.keys()]).toEqual([
      'logs/main.log',
      'crashes/Bericht-Übersicht.json',
      'leer.txt',
    ]);
    expect(files.get('crashes/Bericht-Übersicht.json')?.toString()).toBe('{"ok":true}');
    expect(files.get('leer.txt')?.length).toBe(0);
  });
});
