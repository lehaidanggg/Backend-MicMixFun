const fs = require('fs');
const path = require('path');
const { parseAudioDurationFromBuffer } = require('../src/services/audio.service');

const SERVER_ROOT = path.resolve(__dirname, '..');
const DOWNLOADED_DIR = path.join(SERVER_ROOT, 'downloaded_sounds');
const CATALOG_PATH = path.join(DOWNLOADED_DIR, 'catalog.json');
const REPORT_PATH = path.join(__dirname, 'optimize_report.json');

const MAX_DURATION_SEC = 10.0; // Cắt gọn các file nhạc quá dài (>10s) về đúng 10.0s cao trào đầu tiên

const bitratesV1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const bitratesV2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const sampleRatesV1 = [44100, 48000, 32000, 0];
const sampleRatesV2 = [22050, 24000, 16000, 0];
const sampleRatesV25 = [11025, 12000, 8000, 0];

/**
 * Kiểm tra xem 4 byte tại offset có phải là MPEG Layer III Frame Header hợp lệ không
 */
function parseFrameHeader(buffer, offset) {
  if (offset + 4 > buffer.length) return null;
  if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) return null;

  const b1 = buffer[offset + 1];
  const b2 = buffer[offset + 2];
  const b3 = buffer[offset + 3];

  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  const hasCrc = (b1 & 0x01) === 0;
  const bitrateIdx = (b2 >> 4) & 0x0f;
  const srIdx = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  const channelMode = (b3 >> 6) & 0x03;

  // Chỉ nhận MPEG-1/2/2.5 (versionBits !== 0x01) và Layer III (layerBits === 0x01)
  if (versionBits === 0x01 || layerBits !== 0x01) return null;
  if (bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) return null;

  const isV1 = versionBits === 0x03;
  const bitrateKbps = isV1 ? bitratesV1L3[bitrateIdx] : bitratesV2L3[bitrateIdx];
  const sampleRate = isV1
    ? sampleRatesV1[srIdx]
    : (versionBits === 0x02 ? sampleRatesV2[srIdx] : sampleRatesV25[srIdx]);

  if (!bitrateKbps || !sampleRate) return null;

  const samplesPerFrame = isV1 ? 1152 : 576;
  const frameSize = Math.floor(((samplesPerFrame / 8) * bitrateKbps * 1000) / sampleRate) + padding;
  if (frameSize <= 24 || offset + frameSize > buffer.length) return null;

  const isMono = channelMode === 0x03;
  const sideInfoSize = isV1 ? (isMono ? 17 : 32) : (isMono ? 9 : 17);
  const headerAndSideSize = 4 + (hasCrc ? 2 : 0) + sideInfoSize;

  return {
    offset,
    frameSize,
    versionBits,
    sampleRate,
    bitrateKbps,
    samplesPerFrame,
    durationSec: samplesPerFrame / sampleRate,
    headerAndSideSize
  };
}

/**
 * Kiểm tra xem một MP3 frame có phải là frame im lặng kỹ thuật số hoàn toàn (digital silence) không
 */
function isFrameDigitalSilence(buffer, frame) {
  const start = frame.offset + frame.headerAndSideSize;
  const end = frame.offset + frame.frameSize;
  const payloadLen = end - start;
  if (payloadLen <= 4) return true;

  let fillerCount = 0;
  for (let i = start; i < end; i++) {
    const byte = buffer[i];
    if (byte === 0x00 || byte === 0xff || byte === 0x55 || byte === 0xaa) {
      fillerCount++;
    }
  }
  return (fillerCount / payloadLen) >= 0.96;
}

/**
 * Tối ưu hóa 1 file MP3 ở mức nhị phân (Lossless Frame Boundary Optimization):
 * 1. Gọt sạch toàn bộ ID3v2 (ảnh bìa APIC JPEG/PNG), ID3v1, APEv2 và dữ liệu rác ngoài frame.
 * 2. Cắt bỏ chuỗi frame im lặng kỹ thuật số thừa ở đầu & cuối file (giữ lại 2 frame đệm an toàn cho bit reservoir).
 * 3. Cắt gọn các file quá dài (> MAX_DURATION_SEC = 10s) về đúng 10.0s theo ranh giới frame.
 * 4. Cập nhật lại chính xác thông số totalFrames & totalBytes trong Xing/Info VBR header (nếu có).
 */
function optimizeMp3Buffer(origBuffer) {
  let offset = 0;
  let strippedId3Bytes = 0;

  // 1. Bỏ qua mọi ID3v2 tag ở đầu file
  while (offset + 10 <= origBuffer.length && origBuffer.toString('ascii', offset, offset + 3) === 'ID3') {
    const flags = origBuffer[offset + 5];
    const id3Size =
      ((origBuffer[offset + 6] & 0x7f) << 21) |
      ((origBuffer[offset + 7] & 0x7f) << 14) |
      ((origBuffer[offset + 8] & 0x7f) << 7) |
      (origBuffer[offset + 9] & 0x7f);
    const footerSize = (flags & 0x10) ? 10 : 0;
    const totalTagSize = 10 + id3Size + footerSize;
    if (offset + totalTagSize > origBuffer.length) break;
    strippedId3Bytes += totalTagSize;
    offset += totalTagSize;
  }

  // 2. Loại bỏ ID3v1 ('TAG' 128 bytes) ở cuối file khi quét
  let scanEnd = origBuffer.length;
  if (scanEnd >= 128 && origBuffer.toString('ascii', scanEnd - 128, scanEnd - 125) === 'TAG') {
    strippedId3Bytes += 128;
    scanEnd -= 128;
  }

  // 3. Quét danh sách các MPEG Layer III Frames hợp lệ
  const frames = [];
  while (offset + 4 <= scanEnd) {
    const hdr = parseFrameHeader(origBuffer, offset);
    if (hdr && offset + hdr.frameSize <= scanEnd) {
      // Nếu là frame đầu tiên, kiểm tra xem frame kế tiếp có khớp sync word không (tránh false sync trong rác)
      if (frames.length === 0 && offset + hdr.frameSize + 4 <= scanEnd) {
        const nextHdr = parseFrameHeader(origBuffer, offset + hdr.frameSize);
        if (!nextHdr || nextHdr.versionBits !== hdr.versionBits || nextHdr.sampleRate !== hdr.sampleRate) {
          offset++;
          strippedId3Bytes++;
          continue;
        }
      }
      frames.push(hdr);
      offset += hdr.frameSize;
    } else {
      offset++;
      strippedId3Bytes++;
    }
  }

  if (frames.length < 3) {
    return {
      optimizedBuffer: origBuffer,
      changed: false,
      strippedId3Bytes: 0,
      trimmedDuration: false,
      trimmedSilenceFrames: 0,
      fixedXing: false,
      oldDuration: 0,
      newDuration: 0
    };
  }

  // 4. Tách Xing/Info VBR metadata frame (nếu nằm ở frame[0])
  let xingFrame = null;
  let audioFrames = frames;
  const f0 = frames[0];
  const f0Slice = origBuffer.subarray(f0.offset, f0.offset + f0.frameSize);
  const xingPos = f0Slice.indexOf('Xing');
  const infoPos = xingPos === -1 ? f0Slice.indexOf('Info') : xingPos;

  if (infoPos !== -1 && infoPos + 16 <= f0Slice.length) {
    xingFrame = { ...f0, infoPos };
    audioFrames = frames.slice(1);
  }

  const origDuration = audioFrames.reduce((sum, f) => sum + f.durationSec, 0);

  // 5. Cắt các frame im lặng kỹ thuật số hoàn toàn ở đầu và cuối (giữ 2 frame đệm để bảo toàn bit reservoir)
  let firstActiveIdx = 0;
  while (firstActiveIdx < audioFrames.length && isFrameDigitalSilence(origBuffer, audioFrames[firstActiveIdx])) {
    firstActiveIdx++;
  }
  let lastActiveIdx = audioFrames.length - 1;
  while (lastActiveIdx > firstActiveIdx && isFrameDigitalSilence(origBuffer, audioFrames[lastActiveIdx])) {
    lastActiveIdx--;
  }

  const startIdx = Math.max(0, firstActiveIdx - 2);
  const endIdx = Math.min(audioFrames.length - 1, lastActiveIdx + 2);
  let trimmedSilenceFrames = 0;

  if (endIdx - startIdx + 1 >= 5 && (startIdx > 0 || endIdx < audioFrames.length - 1)) {
    trimmedSilenceFrames = audioFrames.length - (endIdx - startIdx + 1);
    audioFrames = audioFrames.slice(startIdx, endIdx + 1);
  }

  // 6. Cắt gọn các file quá dài (> MAX_DURATION_SEC = 10.0s)
  let trimmedDuration = false;
  let accDuration = 0;
  const keptFrames = [];
  for (const frame of audioFrames) {
    if (accDuration + frame.durationSec > MAX_DURATION_SEC && keptFrames.length >= 10) {
      trimmedDuration = true;
      break;
    }
    keptFrames.push(frame);
    accDuration += frame.durationSec;
  }

  const totalAudioBytes = keptFrames.reduce((sum, f) => sum + f.frameSize, 0);
  const totalOutBytes = (xingFrame ? xingFrame.frameSize : 0) + totalAudioBytes;

  // 7. Ghép buffer mới và cập nhật Xing/Info header nếu có
  const outBuffer = Buffer.allocUnsafe(totalOutBytes);
  let writePos = 0;
  let fixedXing = false;

  if (xingFrame) {
    origBuffer.copy(outBuffer, 0, xingFrame.offset, xingFrame.offset + xingFrame.frameSize);
    const flagsOffset = xingFrame.infoPos + 4;
    if (flagsOffset + 12 <= xingFrame.frameSize) {
      const xFlags = outBuffer.readUInt32BE(flagsOffset);
      let cursor = flagsOffset + 4;
      if (xFlags & 0x01) {
        const oldFrames = outBuffer.readUInt32BE(cursor);
        if (oldFrames !== keptFrames.length) {
          outBuffer.writeUInt32BE(keptFrames.length, cursor);
          fixedXing = true;
        }
        cursor += 4;
      }
      if (xFlags & 0x02 && cursor + 4 <= xingFrame.frameSize) {
        const oldBytes = outBuffer.readUInt32BE(cursor);
        if (oldBytes !== totalOutBytes) {
          outBuffer.writeUInt32BE(totalOutBytes, cursor);
          fixedXing = true;
        }
      }
    }
    writePos += xingFrame.frameSize;
  }

  for (const frame of keptFrames) {
    origBuffer.copy(outBuffer, writePos, frame.offset, frame.offset + frame.frameSize);
    writePos += frame.frameSize;
  }

  const changed =
    outBuffer.length < origBuffer.length ||
    trimmedDuration ||
    trimmedSilenceFrames > 0 ||
    fixedXing;

  return {
    optimizedBuffer: outBuffer,
    changed,
    strippedId3Bytes,
    trimmedDuration,
    trimmedSilenceFrames,
    fixedXing,
    oldDuration: parseFloat(origDuration.toFixed(2)),
    newDuration: parseFloat(accDuration.toFixed(2))
  };
}

// Quét toàn bộ các folder pack trong downloaded_sounds
const packDirs = fs
  .readdirSync(DOWNLOADED_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

let totalOldBytes = 0;
let totalNewBytes = 0;
let id3StrippedCount = 0;
let durationTrimmedCount = 0;
let silenceTrimmedCount = 0;
let xingFixedCount = 0;

const topSavedFiles = [];
const trimmedDurationFiles = [];
const fixedXingFiles = [];
const catalog = [];
const packCounts = {};

for (const pack of packDirs) {
  const packPath = path.join(DOWNLOADED_DIR, pack);
  const files = fs
    .readdirSync(packPath, { withFileTypes: true })
    .filter(f => f.isFile() && /\.mp3$/i.test(f.name))
    .map(f => f.name);

  for (const fileName of files) {
    const fullPath = path.join(packPath, fileName);
    const origBuf = fs.readFileSync(fullPath);
    const oldSize = origBuf.length;
    totalOldBytes += oldSize;

    const res = optimizeMp3Buffer(origBuf);
    let finalBuf = origBuf;

    if (res.changed && res.optimizedBuffer.length > 500) {
      fs.writeFileSync(fullPath, res.optimizedBuffer);
      finalBuf = res.optimizedBuffer;
    }

    const newSize = finalBuf.length;
    totalNewBytes += newSize;
    const savedBytes = oldSize - newSize;

    if (res.strippedId3Bytes > 64) {
      id3StrippedCount++;
    }
    if (res.trimmedDuration) {
      durationTrimmedCount++;
      trimmedDurationFiles.push({
        relativePath: `${pack}/${fileName}`,
        oldDuration: res.oldDuration,
        newDuration: res.newDuration,
        oldKB: Math.round(oldSize / 102.4) / 10,
        newKB: Math.round(newSize / 102.4) / 10
      });
    }
    if (res.trimmedSilenceFrames > 0) {
      silenceTrimmedCount++;
    }
    if (res.fixedXing) {
      xingFixedCount++;
      fixedXingFiles.push(`${pack}/${fileName}`);
    }

    if (savedBytes > 1024) {
      topSavedFiles.push({
        relativePath: `${pack}/${fileName}`,
        oldKB: Math.round(oldSize / 102.4) / 10,
        newKB: Math.round(newSize / 102.4) / 10,
        savedKB: Math.round(savedBytes / 102.4) / 10,
        savedPct: Math.round((savedBytes / oldSize) * 100),
        oldDuration: res.oldDuration,
        newDuration: res.newDuration
      });
    }

    const parsedDur = parseAudioDurationFromBuffer(finalBuf, '.mp3');
    packCounts[pack] = (packCounts[pack] || 0) + 1;

    catalog.push({
      id: path.basename(fileName, '.mp3'),
      pack,
      fileName,
      relativePath: `${pack}/${fileName}`,
      duration: parseFloat(parsedDur.toFixed(2)),
      sizeBytes: newSize
    });
  }
}

topSavedFiles.sort((a, b) => b.savedKB - a.savedKB);
trimmedDurationFiles.sort((a, b) => b.oldDuration - a.oldDuration);
catalog.sort((a, b) => a.pack.localeCompare(b.pack) || a.fileName.localeCompare(b.fileName));

// Cập nhật lại catalog.json
fs.writeFileSync(
  CATALOG_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      totalSounds: catalog.length,
      totalSizeKB: Math.round(totalNewBytes / 102.4) / 10,
      packCounts,
      sounds: catalog
    },
    null,
    2
  ),
  'utf8'
);

// Ghi báo cáo kết quả tối ưu vào scripts/optimize_report.json
const report = {
  totalFilesProcessed: catalog.length,
  totalOldMB: parseFloat((totalOldBytes / (1024 * 1024)).toFixed(2)),
  totalNewMB: parseFloat((totalNewBytes / (1024 * 1024)).toFixed(2)),
  savedMB: parseFloat(((totalOldBytes - totalNewBytes) / (1024 * 1024)).toFixed(2)),
  savedPercent: parseFloat((((totalOldBytes - totalNewBytes) / totalOldBytes) * 100).toFixed(1)),
  id3StrippedCount,
  durationTrimmedCount,
  silenceTrimmedCount,
  xingFixedCount,
  topSavedFiles: topSavedFiles.slice(0, 25),
  trimmedDurationFiles
};

fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
console.log('OPTIMIZE_DONE:', JSON.stringify({
  oldMB: report.totalOldMB,
  newMB: report.totalNewMB,
  savedMB: report.savedMB,
  savedPercent: report.savedPercent
}));
