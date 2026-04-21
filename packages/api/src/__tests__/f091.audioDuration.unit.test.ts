// F091 — Unit tests for parseAudioDuration in audioDuration.ts
//
// Validates in-process audio header parsing for webm EBML, mp4 moov/mvhd,
// ogg page header, and mp3 Xing/VBRI. Also covers:
//   - Buffer too short → null
//   - Unknown MIME → null
//   - MIME normalisation (strips codec params)
//   - selectVerifiedDuration: server-vs-client comparison helper

import { describe, it, expect } from 'vitest';
import { parseAudioDuration, selectVerifiedDuration } from '../lib/audioDuration.js';

// ---------------------------------------------------------------------------
// Helper builders for minimal valid binary frames
// ---------------------------------------------------------------------------

/** Build a minimal WebM EBML buffer with a Segment/Info/Duration element.
 *
 * Simplified structure:
 *   EBML header (minimal)
 *   Segment (0x18538067)
 *     Info (0x1549A966)
 *       TimecodeScale (0x2AD7B1) — 1ms = 1 000 000 ns
 *       Duration (0x4489)       — 64-bit float (big-endian) in timecode units
 */
function buildWebmBuffer(durationMs: number): Buffer {
  // TimecodeScale = 1_000_000 (1ms per timecode unit)
  // We'll store duration in ms as a float64 BE
  const timecodeScaleValue = Buffer.alloc(4);
  timecodeScaleValue.writeUInt32BE(1_000_000, 0);

  // Duration as float64 big-endian
  const durationBuf = Buffer.alloc(8);
  durationBuf.writeDoubleBE(durationMs, 0);

  // Build EBML Duration element: ID 0x4489, size 0x88 (float64), value
  // 0x88 = 1000 0000 | 0x08 = vint for 8 bytes
  const durationElement = Buffer.concat([
    Buffer.from([0x44, 0x89]), // ID: Duration
    Buffer.from([0x88]),        // Size: vint = 8 bytes (0x80 | 0x08)
    durationBuf,
  ]);

  // TimecodeScale element: ID 0x2A, 0xD7, 0xB1, size 0x84 (4 bytes)
  const timecodeElement = Buffer.concat([
    Buffer.from([0x2A, 0xD7, 0xB1]), // ID: TimecodeScale
    Buffer.from([0x84]),               // Size: vint = 4 bytes
    timecodeScaleValue,
  ]);

  // Info element: ID 0x15, 0x49, 0xA9, 0x66 + vint size + content
  const infoContent = Buffer.concat([timecodeElement, durationElement]);
  const infoSizeVint = encodeVint(infoContent.length);
  const infoElement = Buffer.concat([
    Buffer.from([0x15, 0x49, 0xA9, 0x66]),
    infoSizeVint,
    infoContent,
  ]);

  // Segment element: ID 0x18, 0x53, 0x80, 0x67 + vint size (unknown size = 0x01FF FFFF FFFF FFFF)
  // For tests, we'll use a known size
  const segmentContent = infoElement;
  const segmentSizeVint = encodeVint(segmentContent.length);
  const segmentElement = Buffer.concat([
    Buffer.from([0x18, 0x53, 0x80, 0x67]),
    segmentSizeVint,
    segmentContent,
  ]);

  // Minimal EBML header
  const ebmlHeader = Buffer.from([
    0x1A, 0x45, 0xDF, 0xA3, // EBML element ID
    0x9F,                    // Size: vint = 31 bytes (0x80 | 0x1F)
    // EBML header contents (31 bytes of plausible data for parser to skip)
    0x42, 0x86, 0x81, 0x01, // EBMLVersion = 1
    0x42, 0xF7, 0x81, 0x01, // EBMLReadVersion = 1
    0x42, 0xF2, 0x81, 0x04, // EBMLMaxIDLength = 4
    0x42, 0xF3, 0x81, 0x08, // EBMLMaxSizeLength = 8
    0x42, 0x82, 0x84,        // DocType ID + size=4
    0x77, 0x65, 0x62, 0x6D, // "webm"
    0x42, 0x87, 0x81, 0x02, // DocTypeVersion = 2
    0x42, 0x85, 0x81, 0x02, // DocTypeReadVersion = 2
  ]);

  return Buffer.concat([ebmlHeader, segmentElement]);
}

/** Encode a positive integer as a minimal EBML vint (variable-length integer) */
function encodeVint(value: number): Buffer {
  if (value < 0x7F) {
    return Buffer.from([0x80 | value]);
  } else if (value < 0x3FFF) {
    return Buffer.from([0x40 | (value >> 8), value & 0xFF]);
  } else if (value < 0x1FFFFF) {
    return Buffer.from([0x20 | (value >> 16), (value >> 8) & 0xFF, value & 0xFF]);
  } else {
    return Buffer.from([
      0x10 | (value >> 24),
      (value >> 16) & 0xFF,
      (value >> 8) & 0xFF,
      value & 0xFF,
    ]);
  }
}

/** Build a minimal MP4 buffer with moov/mvhd atom containing duration.
 *
 * Structure: ftyp atom + moov atom { mvhd atom }
 * mvhd version 0: timeScale (4 bytes) + duration (4 bytes)
 * mvhd version 1: timeScale (4 bytes) + duration (8 bytes)
 */
function buildMp4Buffer(durationSeconds: number): Buffer {
  const timeScale = 1000; // 1000 ticks per second
  const durationTicks = Math.round(durationSeconds * timeScale);

  // mvhd v0 atom: 108 bytes total
  // 4 bytes size + 4 bytes 'mvhd' + 1 version + 3 flags + 4 ctime + 4 mtime
  // + 4 timeScale + 4 duration + ...
  const mvhdContent = Buffer.alloc(100); // remaining after size+type = 100 bytes
  mvhdContent.writeUInt8(0, 0); // version 0
  mvhdContent.writeUInt32BE(0, 4); // creation time
  mvhdContent.writeUInt32BE(0, 8); // modification time
  mvhdContent.writeUInt32BE(timeScale, 12); // timescale
  mvhdContent.writeUInt32BE(durationTicks, 16); // duration

  const mvhdSize = 8 + mvhdContent.length;
  const mvhd = Buffer.alloc(mvhdSize);
  mvhd.writeUInt32BE(mvhdSize, 0);
  mvhd.write('mvhd', 4, 'ascii');
  mvhdContent.copy(mvhd, 8);

  // moov atom
  const moovContent = mvhd;
  const moovSize = 8 + moovContent.length;
  const moov = Buffer.alloc(moovSize);
  moov.writeUInt32BE(moovSize, 0);
  moov.write('moov', 4, 'ascii');
  moovContent.copy(moov, 8);

  // ftyp atom (minimal)
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x0C, // size = 12
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x6D, 0x70, 0x34, 0x31, // 'mp41'
  ]);

  return Buffer.concat([ftyp, moov]);
}

/** Build a minimal Ogg page buffer with an Opus ID header (duration not in header).
 *
 * Ogg can only determine duration from the last page's granule position.
 * Our parser reads the pre-roll comment header which doesn't have duration,
 * so for Ogg, the parser should return null (cannot determine duration
 * without scanning to end of file).
 */
function buildOggBuffer(): Buffer {
  // Ogg capture pattern: OggS
  return Buffer.from([
    0x4F, 0x67, 0x67, 0x53, // "OggS" magic
    0x00,                    // version
    0x02,                    // header type (beginning of stream)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // granule position
    0x00, 0x00, 0x00, 0x00, // serial number
    0x00, 0x00, 0x00, 0x00, // sequence number
    0x00, 0x00, 0x00, 0x00, // checksum
    0x01,                    // page segments
    0x13,                    // segment table: 19 bytes
    // OpusHead magic (8 bytes) + version + channels + pre-skip + sample rate + gain + channel map
    0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // "OpusHead"
    0x01,                    // version
    0x02,                    // channels
    0x38, 0x01,              // pre-skip (312)
    0x80, 0xBB, 0x00, 0x00, // sample rate 48000
    0x00, 0x00,              // output gain
    0x00,                    // channel map
  ]);
}

/** Build a minimal MP3 buffer with a Xing VBR header.
 *
 * Structure: 4-byte sync + side info + Xing header with frame count
 * MPEG1, Layer 3, 128kbps, 44100Hz, stereo
 *
 * Xing header location for MPEG1 stereo: offset 36 from frame start
 * Frame header: FF FB 90 00
 *   FF = sync word
 *   FB = 1111 1011 => MPEG1, Layer3, 128kbps, no padding
 *   90 = 1001 0000 => 44100Hz, joint stereo
 *   00 = no padding
 */
function buildMp3XingBuffer(durationSeconds: number): Buffer {
  // Frame rate for MPEG1 Layer3 = 1152 samples/frame
  // Sample rate 44100
  // fps = 44100 / 1152 = 38.28...
  const sampleRate = 44100;
  const samplesPerFrame = 1152;
  const frameCount = Math.round((durationSeconds * sampleRate) / samplesPerFrame);

  // MP3 frame header for MPEG1, Layer3, 128kbps, 44100Hz, joint stereo
  const frameHeader = Buffer.from([0xFF, 0xFB, 0x90, 0x00]);

  // Side information for MPEG1 stereo = 32 bytes
  const sideInfo = Buffer.alloc(32, 0);

  // Xing header starts at offset 36 (4 + 32) from frame start
  // "Xing" or "Info" + flags (4 bytes) + frame count (4 bytes)
  const xingId = Buffer.from('Xing', 'ascii');
  const xingFlags = Buffer.alloc(4);
  xingFlags.writeUInt32BE(0x01, 0); // bit 0 = frames field present

  const xingFrameCount = Buffer.alloc(4);
  xingFrameCount.writeUInt32BE(frameCount, 0);

  return Buffer.concat([frameHeader, sideInfo, xingId, xingFlags, xingFrameCount]);
}

// ---------------------------------------------------------------------------
// Tests: parseAudioDuration
// ---------------------------------------------------------------------------

describe('parseAudioDuration', () => {
  // -------------------------------------------------------------------------
  // MP4 / moov mvhd
  // -------------------------------------------------------------------------

  it('parses mp4 duration from moov/mvhd atom (version 0)', () => {
    const buf = buildMp4Buffer(30);
    const result = parseAudioDuration(buf, 'audio/mp4');
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(30, 0);
  });

  it('parses mp4 duration from moov/mvhd for 90 seconds', () => {
    const buf = buildMp4Buffer(90);
    const result = parseAudioDuration(buf, 'audio/mp4');
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(90, 0);
  });

  it('returns null for buffer too short to contain mp4 atoms', () => {
    const buf = Buffer.alloc(10, 0);
    const result = parseAudioDuration(buf, 'audio/mp4');
    expect(result).toBeNull();
  });

  it('returns null for mp4 with no moov atom', () => {
    // ftyp only, no moov
    const ftyp = Buffer.from([
      0x00, 0x00, 0x00, 0x0C,
      0x66, 0x74, 0x79, 0x70,
      0x6D, 0x70, 0x34, 0x31,
    ]);
    const result = parseAudioDuration(ftyp, 'audio/mp4');
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // WebM / EBML
  // -------------------------------------------------------------------------

  it('parses webm duration from EBML Segment/Info/Duration (15 seconds)', () => {
    const buf = buildWebmBuffer(15_000); // 15000ms
    const result = parseAudioDuration(buf, 'audio/webm');
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(15, 0);
  });

  it('parses webm duration from EBML for 60 seconds', () => {
    const buf = buildWebmBuffer(60_000);
    const result = parseAudioDuration(buf, 'audio/webm');
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(60, 0);
  });

  it('returns null for webm buffer that is too short', () => {
    const buf = Buffer.alloc(8, 0);
    const result = parseAudioDuration(buf, 'audio/webm');
    expect(result).toBeNull();
  });

  it('strips codec parameters from MIME before parsing webm (audio/webm;codecs=opus)', () => {
    const buf = buildWebmBuffer(20_000);
    const result = parseAudioDuration(buf, 'audio/webm;codecs=opus');
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(20, 0);
  });

  // -------------------------------------------------------------------------
  // MP3 / Xing VBR header
  // -------------------------------------------------------------------------

  it('parses mp3 duration from Xing VBR header (30 seconds)', () => {
    const buf = buildMp3XingBuffer(30);
    const result = parseAudioDuration(buf, 'audio/mpeg');
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(30, 1);
  });

  it('returns null for mp3 buffer without Xing header', () => {
    const buf = Buffer.from([0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00]);
    const result = parseAudioDuration(buf, 'audio/mpeg');
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // OGG — cannot determine duration from header alone
  // -------------------------------------------------------------------------

  it('returns null for ogg (cannot determine duration from page header alone)', () => {
    const buf = buildOggBuffer();
    const result = parseAudioDuration(buf, 'audio/ogg');
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Unknown / unsupported MIME
  // -------------------------------------------------------------------------

  it('returns null for unknown MIME type', () => {
    const buf = Buffer.alloc(100, 0);
    const result = parseAudioDuration(buf, 'audio/x-unknown');
    expect(result).toBeNull();
  });

  it('returns null for empty buffer regardless of MIME', () => {
    const result = parseAudioDuration(Buffer.alloc(0), 'audio/mp4');
    expect(result).toBeNull();
  });

  it('returns null for null-like zero buffer for webm', () => {
    const result = parseAudioDuration(Buffer.alloc(4, 0), 'audio/webm');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: selectVerifiedDuration
// ---------------------------------------------------------------------------

describe('selectVerifiedDuration', () => {
  it('returns server value when it is present and client does not exceed it by > 2s', () => {
    // client = 10s, server = 10s → same → use server (10)
    expect(selectVerifiedDuration(10, 10)).toBe(10);
  });

  it('returns server value when client is within 2s above server', () => {
    // client = 12s, server = 10s → diff = 2s, NOT strictly > 2 → use server (10)
    expect(selectVerifiedDuration(12, 10)).toBe(10);
  });

  it('returns server value when client exceeds server by > 2s (billing guard)', () => {
    // client = 15s, server = 10s → diff = 5s > 2s → use server (10) — client inflated
    expect(selectVerifiedDuration(15, 10)).toBe(10);
  });

  it('returns client value when server is null (parse failure fallback)', () => {
    expect(selectVerifiedDuration(25, null)).toBe(25);
  });

  it('returns server value when client is less than server', () => {
    // client = 8s, server = 12s → client understated → use server (12) for accounting
    expect(selectVerifiedDuration(8, 12)).toBe(12);
  });

  it('uses server when client exceeds server by exactly 2.1s', () => {
    expect(selectVerifiedDuration(12.1, 10)).toBe(10);
  });

  it('uses client (= server) when both are equal to 0', () => {
    expect(selectVerifiedDuration(0, 0)).toBe(0);
  });

  it('returns client value when server is null even for large durations', () => {
    expect(selectVerifiedDuration(120, null)).toBe(120);
  });
});
