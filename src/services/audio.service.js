const fs = require('fs');
const path = require('path');
const { SOUNDS_DIR, ASSET_CDN_URL } = require('../config/constants');

// Cache thời lượng âm thanh (giây) từ catalog.json
const durationCache = new Map();

// Cache index tra cứu file âm thanh theo tên file hoặc relativePath (pack/fileName)
let soundIndexCache = null;

/**
 * Tạo URL truy cập file âm thanh trên Cloudflare R2 CDN
 */
function getSoundUrl(relativePath) {
  const cleanRel = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const encodedPath = cleanRel
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  return `${ASSET_CDN_URL}/${encodedPath}`;
}

/**
 * Nạp danh mục 251 âm thanh và thời lượng đã tính sẵn từ sounds/catalog.json
 */
function buildSoundIndex(forceRebuild = false) {
  if (soundIndexCache && !forceRebuild) {
    return soundIndexCache;
  }

  const byFileName = new Map();
  const byRelativePath = new Map();
  const allSounds = [];

  const catalogPath = path.join(SOUNDS_DIR, 'catalog.json');
  if (fs.existsSync(catalogPath)) {
    try {
      const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      const catalogSounds = cat.sounds || [];
      for (const s of catalogSounds) {
        if (!s.relativePath) continue;
        const item = {
          id: s.id || path.parse(s.fileName).name,
          pack: s.pack || 'general',
          fileName: s.fileName,
          relativePath: s.relativePath,
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
    } catch (e) {
      // Bỏ qua nếu catalog.json lỗi
    }
  }

  soundIndexCache = { byFileName, byRelativePath, allSounds };
  return soundIndexCache;
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

  return null;
}

/**
 * Lấy danh sách toàn bộ file âm thanh theo từng pack từ catalog.json
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
 * Lấy thời lượng thực tế (giây) của file âm thanh từ catalog.json
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

  return 4.0;
}

module.exports = {
  getSoundDuration,
  resolveSoundFile,
  getSoundUrl,
  getAllDownloadedSounds,
  buildSoundIndex,
  durationCache
};
