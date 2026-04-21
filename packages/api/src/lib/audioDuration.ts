// audioDuration.ts — In-process audio header duration parser (F091)
//
// Parses minimal audio container headers to determine clip duration without
// shelling out or reading the full file. Returns null on parse failure so the
// caller can fall back to client-supplied duration.
//
// Supported formats:
//   - audio/mp4:   reads moov/mvhd atom (version 0 and 1)
//   - audio/webm:  reads EBML Segment/Info/Duration element
//   - audio/mpeg:  reads Xing/VBRI VBR frame header
//   - audio/ogg:   cannot determine duration from page header alone → null
//
// Zero new npm dependencies. All parsing is pure TypeScript with Buffer ops.

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse audio duration in seconds from a buffer.
 *
 * @param buffer   Raw audio bytes (partial buffer is acceptable — parser stops
 *                 when it has enough information)
 * @param mimeType MIME type including optional codec params
 *                 (e.g. 'audio/webm;codecs=opus')
 * @returns Duration in seconds, or null if the format is unsupported or the
 *          buffer is too short / malformed
 */
export function parseAudioDuration(buffer: Buffer, mimeType: string): number | null {
  if (buffer.length === 0) return null;

  const baseMime = mimeType.split(';')[0]?.trim() ?? '';

  switch (baseMime) {
    case 'audio/mp4':
      return parseMp4Duration(buffer);
    case 'audio/webm':
      return parseWebmDuration(buffer);
    case 'audio/mpeg':
      return parseMp3XingDuration(buffer);
    case 'audio/ogg':
      // OGG duration requires scanning to the last page for the final granule
      // position. Not feasible in-process without a full Ogg parser.
      return null;
    default:
      return null;
  }
}

/**
 * Select the verified duration to use for per-IP minute accounting.
 *
 * If the server parsed a duration, that value is authoritative. If the client
 * supplied a duration that exceeds the server-parsed value by more than 2
 * seconds, the server value wins (billing guard against inflated client values).
 * If the server could not parse a duration (null), the client value is used as
 * a fallback.
 *
 * @param clientDuration  Duration in seconds from client form field
 * @param serverDuration  Duration in seconds from parseAudioDuration, or null
 * @returns Duration in seconds to use for accounting
 */
export function selectVerifiedDuration(
  clientDuration: number,
  serverDuration: number | null,
): number {
  if (serverDuration === null) {
    // Parse failure — fall back to client value
    return clientDuration;
  }
  // Server value is always used when present — it is the authoritative measurement.
  // If the client sent an inflated value (clientDuration > serverDuration + 2s),
  // using the server value prevents billing abuse.
  return serverDuration;
}

// ---------------------------------------------------------------------------
// MP4 parser — moov/mvhd atom
// ---------------------------------------------------------------------------

function parseMp4Duration(buffer: Buffer): number | null {
  // Walk the top-level MP4 box list looking for the 'moov' box
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const boxSize = buffer.readUInt32BE(offset);
    if (boxSize < 8) break; // Invalid box size

    const boxType = buffer.slice(offset + 4, offset + 8).toString('ascii');

    if (boxType === 'moov') {
      return parseMoovBox(buffer, offset + 8, offset + boxSize);
    }

    offset += boxSize;
  }
  return null;
}

function parseMoovBox(buffer: Buffer, start: number, end: number): number | null {
  let offset = start;
  while (offset + 8 <= end && offset + 8 <= buffer.length) {
    const boxSize = buffer.readUInt32BE(offset);
    if (boxSize < 8) break;

    const boxType = buffer.slice(offset + 4, offset + 8).toString('ascii');

    if (boxType === 'mvhd') {
      return parseMvhdBox(buffer, offset + 8);
    }

    offset += boxSize;
  }
  return null;
}

function parseMvhdBox(buffer: Buffer, start: number): number | null {
  // mvhd layout (after 8-byte box header):
  //   version (1 byte) + flags (3 bytes)
  //   version 0: ctime (4) + mtime (4) + timeScale (4) + duration (4) = 16 bytes
  //   version 1: ctime (8) + mtime (8) + timeScale (4) + duration (8) = 28 bytes
  if (start + 1 > buffer.length) return null;

  const version = buffer.readUInt8(start);

  if (version === 0) {
    const needed = start + 4 + 4 + 4 + 4 + 4; // flags + ctime + mtime + timeScale + duration
    if (needed > buffer.length) return null;
    const timeScale = buffer.readUInt32BE(start + 4 + 8);     // skip flags(3)+version(1)+ctime(4)+mtime(4)
    const duration = buffer.readUInt32BE(start + 4 + 8 + 4);  // skip +timeScale(4)
    if (timeScale === 0) return null;
    return duration / timeScale;
  } else if (version === 1) {
    const needed = start + 4 + 8 + 8 + 4 + 8;
    if (needed > buffer.length) return null;
    const timeScale = buffer.readUInt32BE(start + 4 + 16);     // skip flags+ctime(8)+mtime(8)
    // duration is a 64-bit integer — read as two 32-bit halves
    const durHigh = buffer.readUInt32BE(start + 4 + 16 + 4);
    const durLow = buffer.readUInt32BE(start + 4 + 16 + 4 + 4);
    const duration = durHigh * 0x100000000 + durLow;
    if (timeScale === 0) return null;
    return duration / timeScale;
  }

  return null;
}

// ---------------------------------------------------------------------------
// WebM / EBML parser — Segment > Info > Duration
// ---------------------------------------------------------------------------

/** Read a single byte from buffer safely (returns 0 on out-of-bounds) */
function b(buf: Buffer, i: number): number {
  return buf[i] ?? 0;
}

/**
 * Read an EBML vint from the buffer at the given offset.
 * Returns { value, length } where length is the byte width of the vint.
 * Returns null if buffer is too short.
 */
function readVint(buffer: Buffer, offset: number): { value: number; length: number } | null {
  if (offset >= buffer.length) return null;

  const first = b(buffer, offset);

  if (first & 0x80) {
    // 1-byte vint
    return { value: first & 0x7F, length: 1 };
  } else if (first & 0x40) {
    // 2-byte vint
    if (offset + 2 > buffer.length) return null;
    const b1 = b(buffer, offset + 1);
    return { value: ((first & 0x3F) << 8) | b1, length: 2 };
  } else if (first & 0x20) {
    // 3-byte vint
    if (offset + 3 > buffer.length) return null;
    const b1 = b(buffer, offset + 1);
    const b2 = b(buffer, offset + 2);
    return {
      value: ((first & 0x1F) << 16) | (b1 << 8) | b2,
      length: 3,
    };
  } else if (first & 0x10) {
    // 4-byte vint
    if (offset + 4 > buffer.length) return null;
    const b1 = b(buffer, offset + 1);
    const b2 = b(buffer, offset + 2);
    const b3 = b(buffer, offset + 3);
    return {
      value: ((first & 0x0F) << 24) | (b1 << 16) | (b2 << 8) | b3,
      length: 4,
    };
  }

  // Larger vints are not expected for size values we care about
  return null;
}

/**
 * Read an EBML element ID from the buffer at the given offset.
 * EBML IDs use the vint encoding but do NOT mask out the leading 1-bit.
 * Returns { id, length } or null if buffer too short.
 */
function readEbmlId(buffer: Buffer, offset: number): { id: number; length: number } | null {
  if (offset >= buffer.length) return null;

  const first = b(buffer, offset);

  if (first & 0x80) {
    return { id: first, length: 1 };
  } else if (first & 0x40) {
    if (offset + 2 > buffer.length) return null;
    const b1 = b(buffer, offset + 1);
    return { id: (first << 8) | b1, length: 2 };
  } else if (first & 0x20) {
    if (offset + 3 > buffer.length) return null;
    const b1 = b(buffer, offset + 1);
    const b2 = b(buffer, offset + 2);
    return { id: (first << 16) | (b1 << 8) | b2, length: 3 };
  } else if (first & 0x10) {
    if (offset + 4 > buffer.length) return null;
    const b1 = b(buffer, offset + 1);
    const b2 = b(buffer, offset + 2);
    const b3 = b(buffer, offset + 3);
    return { id: (first << 24) | (b1 << 16) | (b2 << 8) | b3, length: 4 };
  }

  return null;
}

// EBML element IDs (as 32-bit integers)
const EBML_ID_EBML      = 0x1A45DFA3;
const EBML_ID_SEGMENT   = 0x18538067;
const EBML_ID_INFO      = 0x1549A966;
const EBML_ID_TIMESCALE = 0x2AD7B1;
const EBML_ID_DURATION  = 0x4489;

function parseWebmDuration(buffer: Buffer): number | null {
  if (buffer.length < 4) return null;

  // Verify EBML magic
  const firstId = readEbmlId(buffer, 0);
  if (!firstId || firstId.id !== EBML_ID_EBML) return null;

  // Skip EBML header — read size and jump over it
  const ebmlSizeResult = readVint(buffer, firstId.length);
  if (!ebmlSizeResult) return null;

  const segmentOffset = firstId.length + ebmlSizeResult.length + ebmlSizeResult.value;

  return parseEbmlForDuration(buffer, segmentOffset, buffer.length, 0);
}

/**
 * Recursively scan EBML elements in [start, end) looking for Duration.
 * depth is used to limit recursion (we only need 3 levels: Segment > Info > Duration).
 */
function parseEbmlForDuration(
  buffer: Buffer,
  start: number,
  end: number,
  depth: number,
): number | null {
  if (depth > 3) return null;

  let offset = start;
  let timecodeScaleNs = 1_000_000; // default: 1ms per timecode unit

  while (offset < end && offset < buffer.length) {
    const idResult = readEbmlId(buffer, offset);
    if (!idResult) break;

    offset += idResult.length;

    const sizeResult = readVint(buffer, offset);
    if (!sizeResult) break;

    offset += sizeResult.length;
    const contentStart = offset;
    const contentSize = sizeResult.value;
    const contentEnd = contentStart + contentSize;

    switch (idResult.id) {
      case EBML_ID_SEGMENT:
        // Recurse into Segment — it wraps the Info element
        return parseEbmlForDuration(buffer, contentStart, Math.min(contentEnd, buffer.length), depth + 1);

      case EBML_ID_INFO: {
        // Recurse into Info to collect TimecodeScale + Duration
        const info = parseEbmlInfo(buffer, contentStart, Math.min(contentEnd, buffer.length));
        if (info !== null) return info;
        break;
      }

      case EBML_ID_TIMESCALE:
        // TimecodeScale at current level (unexpected, but handle gracefully)
        if (contentSize <= 8 && contentStart + contentSize <= buffer.length) {
          timecodeScaleNs = readUintBE(buffer, contentStart, contentSize);
        }
        break;

      case EBML_ID_DURATION:
        // Duration as float64 in timecode units
        if (contentSize === 8 && contentStart + 8 <= buffer.length) {
          const durationTicks = buffer.readDoubleBE(contentStart);
          return (durationTicks * timecodeScaleNs) / 1_000_000_000;
        }
        break;
    }

    offset = contentEnd;
    if (offset <= contentStart) break; // Prevent infinite loop on zero-size elements
  }

  return null;
}

/**
 * Parse an EBML Info element to extract TimecodeScale and Duration.
 * Returns duration in seconds, or null if not found.
 */
function parseEbmlInfo(buffer: Buffer, start: number, end: number): number | null {
  let offset = start;
  let timecodeScaleNs = 1_000_000; // default 1ms
  let durationTicks: number | null = null;

  while (offset < end && offset < buffer.length) {
    const idResult = readEbmlId(buffer, offset);
    if (!idResult) break;

    offset += idResult.length;

    const sizeResult = readVint(buffer, offset);
    if (!sizeResult) break;

    offset += sizeResult.length;
    const contentStart = offset;
    const contentSize = sizeResult.value;
    const contentEnd = contentStart + contentSize;

    switch (idResult.id) {
      case EBML_ID_TIMESCALE:
        if (contentSize >= 1 && contentSize <= 8 && contentStart + contentSize <= buffer.length) {
          timecodeScaleNs = readUintBE(buffer, contentStart, contentSize);
        }
        break;

      case EBML_ID_DURATION:
        if (contentSize === 8 && contentStart + 8 <= buffer.length) {
          durationTicks = buffer.readDoubleBE(contentStart);
        }
        break;
    }

    offset = contentEnd;
    if (offset <= contentStart) break;
  }

  if (durationTicks === null) return null;
  return (durationTicks * timecodeScaleNs) / 1_000_000_000;
}

/** Read a big-endian unsigned integer of 1–8 bytes from buffer */
function readUintBE(buffer: Buffer, offset: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i++) {
    value = value * 256 + (buffer[offset + i] ?? 0);
  }
  return value;
}

// ---------------------------------------------------------------------------
// MP3 parser — Xing/VBRI VBR frame header
// ---------------------------------------------------------------------------

/**
 * Attempt to parse duration from an MP3 Xing or VBRI VBR header.
 *
 * The Xing header is located at a fixed byte offset within the first MP3 frame:
 *   MPEG1 stereo:  offset 36 from frame start (4 header + 32 side info)
 *   MPEG1 mono:    offset 21 from frame start (4 header + 17 side info)
 *   MPEG2/2.5:     offset 21 / 13 depending on stereo
 *
 * The header contains (when bit 0 of flags is set): total frame count.
 * Duration = frames × samplesPerFrame / sampleRate
 */
function parseMp3XingDuration(buffer: Buffer): number | null {
  if (buffer.length < 8) return null;

  // Verify MP3 sync word: first 11 bits must be 1
  const byte0 = b(buffer, 0);
  const byte1 = b(buffer, 1);
  if ((byte0 & 0xFF) !== 0xFF) return null;
  if ((byte1 & 0xE0) !== 0xE0) return null;

  // Parse frame header byte 1 (index 1)
  const header1 = byte1;
  // MPEG version: bits 3-4 of byte 1 (after sync)
  //   00 = MPEG 2.5, 10 = MPEG 2, 11 = MPEG 1
  const mpegVersionBits = (header1 >> 3) & 0x03;
  const isMpeg1 = mpegVersionBits === 0x03;

  // Channel mode from byte 3: bits 6-7
  //   00=stereo, 01=joint stereo, 10=dual, 11=mono
  const header3 = b(buffer, 3);
  const channelMode = (header3 >> 6) & 0x03;
  const isMono = channelMode === 0x03;

  // Determine Xing offset based on MPEG version and channel mode
  let xingOffset: number;
  if (isMpeg1) {
    xingOffset = isMono ? 4 + 17 : 4 + 32;
  } else {
    // MPEG2 / 2.5
    xingOffset = isMono ? 4 + 9 : 4 + 17;
  }

  if (xingOffset + 12 > buffer.length) return null;

  // Check for 'Xing' or 'Info' identifier
  const tag = buffer.slice(xingOffset, xingOffset + 4).toString('ascii');
  if (tag !== 'Xing' && tag !== 'Info') return null;

  // Read flags (next 4 bytes after tag)
  const flags = buffer.readUInt32BE(xingOffset + 4);
  if (!(flags & 0x01)) return null; // bit 0 = frame count field present

  // Frame count (4 bytes after flags)
  if (xingOffset + 12 > buffer.length) return null;
  const frameCount = buffer.readUInt32BE(xingOffset + 8);

  // Determine sample rate from byte 2, bits 2-3
  const header2 = b(buffer, 2);
  const sampleRateBits = (header2 >> 2) & 0x03;
  const sampleRateTable: Record<number, Record<number, number>> = {
    0x03: { 0x00: 44100, 0x01: 48000, 0x02: 32000 }, // MPEG1
    0x02: { 0x00: 22050, 0x01: 24000, 0x02: 16000 }, // MPEG2
    0x00: { 0x00: 11025, 0x01: 12000, 0x02: 8000 },  // MPEG2.5
  };

  const sampleRate = sampleRateTable[mpegVersionBits]?.[sampleRateBits];
  if (!sampleRate) return null;

  const samplesPerFrame = isMpeg1 ? 1152 : 576;

  return (frameCount * samplesPerFrame) / sampleRate;
}
