const fs = require('fs');
const path = require('path');
const { DOWNLOADED_SOUNDS_DIR, ASSET_CDN_URL } = require('../config/constants');

// Cache tính toán thời lượng âm thanh (giây)
const durationCache = new Map();

// Cache index tra cứu file âm thanh theo tên file hoặc relativePath (pack/fileName)
let soundIndexCache = null;

/**
 * Xây dựng bộ chỉ mục các file âm thanh trong downloaded_sounds (hỗ trợ cả chia theo folder pack và nằm phẳng)
 */
function buildSoundIndex(forceRebuild = false) {
  if (soundIndexCache && !forceRebuild) {
    return soundIndexCache;
  }

  const byFileName = new Map();
  const byRelativePath = new Map();
  const allSounds = [];

  if (!fs.existsSync(DOWNLOADED_SOUNDS_DIR)) {
    soundIndexCache = { byFileName, byRelativePath, allSounds };
    return soundIndexCache;
  }

  // Đọc catalog.json nếu có để lấy sẵn thời lượng đã tính trước (và hỗ trợ chạy hoàn toàn từ R2 CDN không cần giữ file .mp3 trên server)
  const catalogPath = path.join(DOWNLOADED_SOUNDS_DIR, 'catalog.json');
  const catalogDurMap = new Map();
  let catalogSounds = [];
  if (fs.existsSync(catalogPath)) {
    try {
      const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      catalogSounds = cat.sounds || [];
      for (const s of catalogSounds) {
        if (s.relativePath && typeof s.duration === 'number') {
          catalogDurMap.set(s.relativePath, s.duration);
        }
      }
    } catch (e) {
      // Bỏ qua nếu catalog.json lỗi
    }
  }

  const entries = fs.readdirSync(DOWNLOADED_SOUNDS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const packName = entry.name;
      const packDir = path.join(DOWNLOADED_SOUNDS_DIR, packName);
      const packFiles = fs.readdirSync(packDir, { withFileTypes: true });
      for (const f of packFiles) {
        if (f.isFile() && /\.(mp3|wav|ogg|m4a)$/i.test(f.name)) {
          const relativePath = `${packName}/${f.name}`;
          const fullPath = path.join(packDir, f.name);
          const id = path.parse(f.name).name;
          const item = {
            id,
            pack: packName,
            fileName: f.name,
            relativePath,
            fullPath,
            url: getSoundUrl(relativePath)
          };
          if (catalogDurMap.has(relativePath)) {
            const rawDur = catalogDurMap.get(relativePath);
            const clamped = parseFloat(Math.max(1.5, Math.min(12.0, rawDur)).toFixed(1));
            durationCache.set(relativePath, clamped);
            durationCache.set(f.name, clamped);
          }
          byRelativePath.set(relativePath, item);
          if (!byFileName.has(f.name)) {
            byFileName.set(f.name, item);
          }
          allSounds.push(item);
        }
      }
    } else if (entry.isFile() && /\.(mp3|wav|ogg|m4a)$/i.test(entry.name)) {
      const relativePath = entry.name;
      const fullPath = path.join(DOWNLOADED_SOUNDS_DIR, entry.name);
      const id = path.parse(entry.name).name;
      const item = {
        id,
        pack: 'general',
        fileName: entry.name,
        relativePath,
        fullPath,
        url: getSoundUrl(relativePath)
      };
      byRelativePath.set(relativePath, item);
      if (!byFileName.has(entry.name)) {
        byFileName.set(entry.name, item);
      }
      allSounds.push(item);
    }
  }

  // Nếu các file .mp3 đã được chuyển hẳn lên R2/CDN và xóa khỏi ổ cứng server, nạp danh mục từ catalog.json
  for (const s of catalogSounds) {
    if (s.relativePath && !byRelativePath.has(s.relativePath)) {
      const item = {
        id: s.id || path.parse(s.fileName).name,
        pack: s.pack || 'general',
        fileName: s.fileName,
        relativePath: s.relativePath,
        fullPath: null,
        url: getSoundUrl(s.relativePath)
      };
      if (typeof s.duration === 'number') {
        const clamped = parseFloat(Math.max(1.5, Math.min(12.0, s.duration)).toFixed(1));
        durationCache.set(s.relativePath, clamped);
        durationCache.set(s.fileName, clamped);
      }
      byRelativePath.set(s.relativePath, item);
      if (!byFileName.has(s.fileName)) {
        byFileName.set(s.fileName, item);
      }
      allSounds.push(item);
    }
  }

  soundIndexCache = { byFileName, byRelativePath, allSounds };
  return soundIndexCache;
}

/**
 * Tạo URL truy cập file âm thanh (Hỗ trợ tự động chuyển sang CDN R2/S3 nếu có ASSET_CDN_URL)
 */
function getSoundUrl(relativePath) {
  const cleanRel = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const encodedPath = cleanRel
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  if (ASSET_CDN_URL) {
    return `${ASSET_CDN_URL}/${encodedPath}`;
  }
  return `/downloaded_sounds/${encodedPath}`;
}

/**
 * Tra cứu thông tin file âm thanh từ tên file ("cat-two.mp3") hoặc đường dẫn tương đối ("animals/cat-two.mp3")
 */
function resolveSoundFile(fileNameOrRelativePath) {
  if (!fileNameOrRelativePath) return null;
  const normalized = String(fileNameOrRelativePath).replace(/\\/g, '/').replace(/^\/+/, '');
  const index = buildSoundIndex();

  if (index.byRelativePath.has(normalized)) {
    return index.byRelativePath.get(normalized);
  }
  const base = path.basename(normalized);
  if (index.byFileName.has(base)) {
    return index.byFileName.get(base);
  }
  const strippedBase = base.replace(/^(animals|anime|meme|voices|voice1|robots|yankee|everyday|melody|funny|signals|space|vehicles|common)_/i, '');
  if (strippedBase !== base && index.byFileName.has(strippedBase)) {
    return index.byFileName.get(strippedBase);
  }

  // Fallback kiểm tra trực tiếp trên ổ đĩa nếu mới thêm file
  const directPath = path.join(DOWNLOADED_SOUNDS_DIR, normalized);
  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    const refreshed = buildSoundIndex(true);
    return refreshed.byRelativePath.get(normalized) || refreshed.byFileName.get(base) || null;
  }

  return null;
}

/**
 * Lấy danh sách toàn bộ file âm thanh đã chia theo folder pack
 */
function getAllDownloadedSounds(packFilter = null) {
  const index = buildSoundIndex();
  let list = index.allSounds;
  if (packFilter) {
    const target = String(packFilter).toLowerCase();
    list = list.filter(s => s.pack.toLowerCase() === target);
  }
  return list.map(s => ({
    id: s.id,
    pack: s.pack,
    fileName: s.fileName,
    relativePath: s.relativePath,
    name: s.id.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    url: s.url
  }));
}

/**
 * Đọc thời lượng file âm thanh (.mp3 / .wav) bằng Pure Node.js Buffer Parser
 * Hoạt động đa nền tảng (Windows, Linux, macOS), không dùng execSync gây block Event Loop.
 */
function parseAudioDurationFromBuffer(buffer, ext) {
  if (!buffer || buffer.length < 44) return 4.0;

  // 1. Phân tích file WAV (RIFF header)
  if (ext === '.wav' || buffer.toString('ascii', 0, 4) === 'RIFF') {
    const byteRate = buffer.readUInt32LE(28);
    if (byteRate > 0) {
      let offset = 12;
      while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        if (chunkId === 'data') {
          return chunkSize / byteRate;
        }
        offset += 8 + chunkSize;
      }
      return (buffer.length - 44) / byteRate;
    }
  }

  // 2. Phân tích file MP3 (ID3v2 + MPEG Audio Frame Header / Xing / VBRI)
  let offset = 0;
  if (buffer.toString('ascii', 0, 3) === 'ID3' && buffer.length >= 10) {
    const id3Size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f);
    offset = 10 + id3Size;
  }

  const bitratesV1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const bitratesV2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const sampleRatesV1 = [44100, 48000, 32000, 0];
  const sampleRatesV2 = [22050, 24000, 16000, 0];
  const sampleRatesV25 = [11025, 12000, 8000, 0];

  let totalDuration = 0;
  let framesFound = 0;
  const maxScan = buffer.length - 4;

  while (offset < maxScan) {
    if (buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0) {
      const b1 = buffer[offset + 1];
      const b2 = buffer[offset + 2];
      const versionBits = (b1 >> 3) & 0x03;
      const layerBits = (b1 >> 1) & 0x03;
      const bitrateIdx = (b2 >> 4) & 0x0f;
      const srIdx = (b2 >> 2) & 0x03;
      const padding = (b2 >> 1) & 0x01;

      if (versionBits !== 0x01 && layerBits === 0x01 && bitrateIdx > 0 && bitrateIdx < 15 && srIdx < 3) {
        const isV1 = versionBits === 0x03;
        const bitrateKbps = isV1 ? bitratesV1L3[bitrateIdx] : bitratesV2L3[bitrateIdx];
        const sampleRate = isV1
          ? sampleRatesV1[srIdx]
          : (versionBits === 0x02 ? sampleRatesV2[srIdx] : sampleRatesV25[srIdx]);

        if (bitrateKbps > 0 && sampleRate > 0) {
          const samplesPerFrame = isV1 ? 1152 : 576;
          const frameSize = Math.floor(((samplesPerFrame / 8) * bitrateKbps * 1000) / sampleRate) + padding;

          if (frameSize > 24 && offset + frameSize <= buffer.length) {
            const isXingOrInfo =
              framesFound === 0 &&
              (buffer.indexOf('Xing', offset, offset + frameSize) !== -1 ||
                buffer.indexOf('Info', offset, offset + frameSize) !== -1);

            if (!isXingOrInfo) {
              totalDuration += samplesPerFrame / sampleRate;
            }
            framesFound++;
            offset += frameSize;
            continue;
          }
        }
      }
    }
    offset++;
  }

  if (framesFound > 5 && totalDuration > 0.3) {
    return totalDuration;
  }

  return Math.max(1.5, Math.min(10.0, (buffer.length * 8) / (128 * 1000)));
}

/**
 * Lấy thời lượng thực tế (giây) của file âm thanh trong downloaded_sounds (hỗ trợ cả pack/fileName và fileName)
 */
function getSoundDuration(fileNameOrRelativePath) {
  if (!fileNameOrRelativePath) return 4.0;
  if (durationCache.has(fileNameOrRelativePath)) {
    return durationCache.get(fileNameOrRelativePath);
  }

  const resolved = resolveSoundFile(fileNameOrRelativePath);
  if (resolved) {
    if (durationCache.has(resolved.relativePath)) {
      return durationCache.get(resolved.relativePath);
    }
    if (durationCache.has(resolved.fileName)) {
      return durationCache.get(resolved.fileName);
    }
  }

  const fPath = resolved && resolved.fullPath
    ? resolved.fullPath
    : path.join(DOWNLOADED_SOUNDS_DIR, fileNameOrRelativePath);

  if (fPath && fs.existsSync(fPath)) {
    try {
      const buf = fs.readFileSync(fPath);
      const ext = path.extname(fPath).toLowerCase();
      const rawDur = parseAudioDurationFromBuffer(buf, ext);
      const dur = parseFloat(Math.max(1.5, Math.min(12.0, rawDur)).toFixed(1));
      durationCache.set(fileNameOrRelativePath, dur);
      if (resolved) {
        durationCache.set(resolved.relativePath, dur);
        durationCache.set(resolved.fileName, dur);
      }
      return dur;
    } catch (e) {
      // Fallback an toàn
    }
  }
  return 4.0;
}

module.exports = {
  parseAudioDurationFromBuffer,
  getSoundDuration,
  resolveSoundFile,
  getSoundUrl,
  getAllDownloadedSounds,
  buildSoundIndex,
  durationCache
};
