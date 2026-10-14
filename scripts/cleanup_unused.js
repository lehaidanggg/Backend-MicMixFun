const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SERVER_ROOT = path.resolve(__dirname, '..');
const DOWNLOADED_DIR = path.join(SERVER_ROOT, 'downloaded_sounds');

function countFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFilesRecursive(full);
    else count++;
  }
  return count;
}

const removedFolders = [];
const removedFiles = [];

// 1. Xóa các folder âm thanh/assets thừa ở thư mục gốc và trong server/
const unusedDirs = [
  path.join(SERVER_ROOT, 'audio'),
  path.join(PROJECT_ROOT, 'downloaded_sounds'),
  path.join(PROJECT_ROOT, 'local_assets')
];

for (const dirPath of unusedDirs) {
  if (fs.existsSync(dirPath)) {
    const count = countFilesRecursive(dirPath);
    fs.rmSync(dirPath, { recursive: true, force: true });
    removedFolders.push({
      path: path.relative(PROJECT_ROOT, dirPath).replace(/\\/g, '/'),
      filesRemoved: count
    });
  }
}

// 2. Xóa các file dump / script python cũ không còn sử dụng trong server/
const unusedServerFiles = [
  'audio_manifest.json',
  'catalog_dump.json',
  'server.py'
];

for (const fName of unusedServerFiles) {
  const fPath = path.join(SERVER_ROOT, fName);
  if (fs.existsSync(fPath)) {
    fs.unlinkSync(fPath);
    removedFiles.push(`server/${fName}`);
  }
}

// 3. Dọn dẹp các file trùng tiền tố (animals_*, voice1_*, voices_*) trong server/downloaded_sounds/
const betterAnimalsPrefixes = ['dog-bark.mp3', 'duck-quack.mp3', 'frog-croak.mp3', 'rooster.mp3', 'wolf-howl.mp3'];
for (const baseName of betterAnimalsPrefixes) {
  const prefixed = path.join(DOWNLOADED_DIR, 'animals', `animals_${baseName}`);
  const clean = path.join(DOWNLOADED_DIR, 'animals', baseName);
  if (fs.existsSync(prefixed)) {
    fs.copyFileSync(prefixed, clean);
    fs.unlinkSync(prefixed);
    removedFiles.push(`server/downloaded_sounds/animals/animals_${baseName} (merged into ${baseName})`);
  }
}

// Xóa các file animals_* còn lại đã có bản gốc sạch trong animals/
const animalsDir = path.join(DOWNLOADED_DIR, 'animals');
if (fs.existsSync(animalsDir)) {
  for (const f of fs.readdirSync(animalsDir)) {
    if (f.startsWith('animals_')) {
      fs.unlinkSync(path.join(animalsDir, f));
      removedFiles.push(`server/downloaded_sounds/animals/${f}`);
    }
  }
}

// Xóa các file voice1_* bị trùng với pack meme/
const voice1Dir = path.join(DOWNLOADED_DIR, 'voice1');
if (fs.existsSync(voice1Dir)) {
  for (const f of fs.readdirSync(voice1Dir)) {
    if (f.startsWith('voice1_')) {
      fs.unlinkSync(path.join(voice1Dir, f));
      removedFiles.push(`server/downloaded_sounds/voice1/${f}`);
    }
  }
}

// Đổi tên voices/voices_evil-laugh.mp3 -> voices/evil-laugh.mp3 cho sạch tiền tố
const voicesEvilPrefixed = path.join(DOWNLOADED_DIR, 'voices', 'voices_evil-laugh.mp3');
const voicesEvilClean = path.join(DOWNLOADED_DIR, 'voices', 'evil-laugh.mp3');
if (fs.existsSync(voicesEvilPrefixed)) {
  fs.renameSync(voicesEvilPrefixed, voicesEvilClean);
}

// 4. Cập nhật lại catalog.json và kiểm tra 100% SOUND_PACKS
const { parseAudioDurationFromBuffer, buildSoundIndex, resolveSoundFile } = require('../src/services/audio.service');
const { SOUND_PACKS } = require('../src/game/soundPacks');

const catalog = [];
const packCounts = {};
let totalBytes = 0;

for (const entry of fs.readdirSync(DOWNLOADED_DIR, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    const pack = entry.name;
    const packDir = path.join(DOWNLOADED_DIR, pack);
    for (const f of fs.readdirSync(packDir, { withFileTypes: true })) {
      if (f.isFile() && /\.mp3$/i.test(f.name)) {
        const full = path.join(packDir, f.name);
        const buf = fs.readFileSync(full);
        const dur = parseAudioDurationFromBuffer(buf, '.mp3');
        totalBytes += buf.length;
        packCounts[pack] = (packCounts[pack] || 0) + 1;
        catalog.push({
          id: path.basename(f.name, '.mp3'),
          pack,
          fileName: f.name,
          relativePath: `${pack}/${f.name}`,
          duration: parseFloat(dur.toFixed(2)),
          sizeBytes: buf.length
        });
      }
    }
  }
}

catalog.sort((a, b) => a.pack.localeCompare(b.pack) || a.fileName.localeCompare(b.fileName));
fs.writeFileSync(
  path.join(DOWNLOADED_DIR, 'catalog.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      totalSounds: catalog.length,
      totalSizeKB: Math.round(totalBytes / 102.4) / 10,
      packCounts,
      sounds: catalog
    },
    null,
    2
  ),
  'utf8'
);

buildSoundIndex(true);
const missingGameSounds = [];
for (const pack of SOUND_PACKS) {
  for (const s of pack.sounds || []) {
    if (!resolveSoundFile(s.relativePath || s.fileName)) {
      missingGameSounds.push(s.relativePath || s.fileName);
    }
  }
}

const report = {
  removedFolders,
  removedFiles,
  remainingSoundsCount: catalog.length,
  remainingTotalMB: parseFloat((totalBytes / (1024 * 1024)).toFixed(2)),
  packCounts,
  missingGameSounds
};

fs.writeFileSync(path.join(__dirname, 'cleanup_report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log('FINAL_CLEANUP_DONE:', JSON.stringify(report));
