const fs = require('fs');
const path = require('path');
const { parseAudioDurationFromBuffer } = require('../src/services/audio.service');

const SERVER_ROOT = path.resolve(__dirname, '..');
const DOWNLOADED_DIR = path.join(SERVER_ROOT, 'downloaded_sounds');
const PACKS_JSON_PATH = path.join(SERVER_ROOT, 'packs_data_ready.json');
const REPORT_PATH = path.join(__dirname, 'organize_report.json');

const packsData = JSON.parse(fs.readFileSync(PACKS_JSON_PATH, 'utf8'));

// Map pack IDs from packs_data_ready.json to clean folder names
const PACK_ID_TO_FOLDER = {
  'p_2cdoatemd7': 'animals',
  'dong-vat': 'animals',
  'p_srnqjzjnb4': 'anime',
  'p_7mixu3ezyr': 'meme',
  'p_g435z2ivl5': 'meme',
  'p_ordy2tfokj': 'yankee',
  'p_7t37k4s46v': 'voices',
  'giong-nguoi': 'voices',
  'p_bi2oyatrbn': 'robots',
  'p_2q2wx4xovx': 'voice1',
  'coi-bao': 'signals',
  'tin-hieu': 'signals',
  'giai-dieu': 'melody',
  'hai-huoc': 'funny',
  'doi-thuong': 'everyday',
  'khong-gian': 'space'
};

// Explicit overrides for vehicles & specific base names
const EXPLICIT_BASE_TO_PACK = {
  'car-horn-honk': 'vehicles',
  'ship-foghorn': 'vehicles',
  'air-raid-horn': 'vehicles',
  'boxing-bell': 'vehicles',
  'train-horn': 'vehicles',
  'motorcycle-rev': 'yankee',
  'siren-up-down': 'signals',
  'ambulance': 'signals',
  'phone-ring': 'signals',
  'fire-alarm': 'signals',
  'school-bell': 'signals',
  'doorbell': 'signals',
  'clock-tick': 'signals',
  'elevator-ding': 'signals',
  'radar-ping': 'signals',
  'pager-beep': 'signals',
  'morse-5': 'signals',
  'cat-two': 'animals',
  'cat-meow': 'animals',
  'bird-trill': 'animals',
  'cow-moo': 'animals',
  'cricket-chirp': 'animals',
  'dog-bark': 'animals',
  'dog_laugh_demo': 'animals',
  'duck-quack': 'animals',
  'elephant-trumpet': 'animals',
  'frog-croak': 'animals',
  'horse-neigh': 'animals',
  'lion-roar': 'animals',
  'pig-oink': 'animals',
  'rooster': 'animals',
  'sheep-baa': 'animals',
  'wolf-howl': 'animals',
  'alien-chatter': 'space',
  'force-field': 'space',
  'laser-blaster': 'space',
  'space-robot': 'space',
  'tractor-beam': 'space',
  'warp-speed': 'space',
  'glass-break': 'everyday',
  'glass-shatter': 'everyday',
  'kame-charge': 'anime',
  'nani-sound': 'anime',
  'rasengan-spin': 'anime',
  'sword-slash': 'anime',
  'teleport-dash': 'anime',
  'baby-giggle': 'funny',
  'boing-spring': 'funny',
  'burp-slide': 'funny',
  'cartoon-slip': 'funny',
  'chewing-crunch': 'funny',
  'crazy-whistle': 'funny',
  'evil-laugh': 'funny',
  'gasp-surprise': 'funny',
  'kiss-smack': 'funny',
  'laugh-ha': 'funny',
  'pop-cork': 'funny',
  'rubber-duck': 'funny',
  'slurp-drink': 'funny',
  'snore-saw': 'funny',
  'whip-crack': 'funny',
  'ufo': 'space',
  'airhorn-triple': 'meme',
  'bonk-metal': 'meme',
  'bruh-sound': 'meme',
  'bye-bye-mewing': 'meme',
  'coffin-dance': 'meme',
  'dun-dun-dun': 'meme',
  'emotional-damage': 'meme',
  'fail-horn': 'meme',
  'fart-reverb': 'meme',
  'gigachad-theme': 'meme',
  'oh-no-laugh': 'meme',
  'oof-roblox': 'meme',
  'quack-duck': 'meme',
  'record-scratch': 'meme',
  'rick-roll-riff': 'meme',
  'run-meme': 'meme',
  'sad-violin': 'meme',
  'screaming-goat': 'meme',
  'sheesh-whistle': 'meme',
  'slap-sound': 'meme',
  'sponge-fail': 'meme',
  'vine-boom': 'meme',
  'windows-xp-error': 'meme',
  'wow-anime': 'meme',
  'yeah-boi': 'meme'
};

// Build map from audioMap and packs in packs_data_ready.json
const stemToPack = { ...EXPLICIT_BASE_TO_PACK };

// 1. From audioMap paths: e.g. "audio/anime/tuturu.mp3" -> folder "anime"
for (const [key, relPath] of Object.entries(packsData.audioMap || {})) {
  const parts = relPath.split('/');
  const fileStem = path.basename(relPath, path.extname(relPath));
  if (parts.length >= 3) {
    let sub = parts[1];
    if (sub === 'human_voice') sub = 'voices';
    if (sub !== 'common') {
      if (!stemToPack[fileStem]) stemToPack[fileStem] = sub;
      if (!stemToPack[key]) stemToPack[key] = sub;
    }
  }
}

// 2. From packs list in packs_data_ready.json
for (const pack of packsData.packs || []) {
  const folder = PACK_ID_TO_FOLDER[pack.id] || pack.category || 'funny';
  for (const pid of pack.patternIds || []) {
    if (!stemToPack[pid]) {
      stemToPack[pid] = folder;
    }
    const stripped = pid.replace(/^(p_[a-z0-9]+_|dong-vat_|giong-nguoi_)/i, '');
    if (!stemToPack[stripped]) {
      stemToPack[stripped] = folder;
    }
  }
}

function classifyFileName(fileName) {
  const stem = path.basename(fileName, path.extname(fileName));

  // Check explicit prefix first
  if (stem.startsWith('animals_')) return 'animals';
  if (stem.startsWith('anime_')) return 'anime';
  if (stem.startsWith('meme_')) return 'meme';
  if (stem.startsWith('voices_')) return 'voices';
  if (stem.startsWith('voice1_')) return 'voice1';
  if (stem.startsWith('robots_')) return 'robots';
  if (stem.startsWith('yankee_')) return 'yankee';
  if (stem.startsWith('everyday_')) return 'everyday';
  if (stem.startsWith('melody_')) return 'melody';
  if (stem.startsWith('funny_')) return 'funny';
  if (stem.startsWith('signals_')) return 'signals';
  if (stem.startsWith('space_')) return 'space';
  if (stem.startsWith('vehicles_')) return 'vehicles';
  if (stem.startsWith('voice-')) return 'voices';

  if (stem.startsWith('common_')) {
    const rest = stem.slice('common_'.length);
    if (stemToPack[rest]) return stemToPack[rest];
  }

  if (stemToPack[stem]) return stemToPack[stem];

  return 'misc';
}

// Collect all audio files currently in downloaded_sounds (both root and any existing subfolders)
function collectExistingFiles(dir, currentPack = null) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let results = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(collectExistingFiles(fullPath, entry.name));
    } else if (/\.(mp3|wav|ogg|m4a)$/i.test(entry.name)) {
      results.push({
        fileName: entry.name,
        fullPath,
        currentPack
      });
    }
  }
  return results;
}

const allFiles = collectExistingFiles(DOWNLOADED_DIR);

// Fix known bad file: cat-meow.mp3 (30s piano song) -> replace with cat-two.mp3 (1.5s real cat meow)
const catTwoFile = allFiles.find(f => f.fileName === 'cat-two.mp3');
const catMeowFile = allFiles.find(f => f.fileName === 'cat-meow.mp3');
let fixedFiles = [];
if (catTwoFile && catMeowFile) {
  const catMeowStat = fs.statSync(catMeowFile.fullPath);
  if (catMeowStat.size > 100000) {
    fs.copyFileSync(catTwoFile.fullPath, catMeowFile.fullPath);
    fixedFiles.push({
      fileName: 'cat-meow.mp3',
      reason: 'Replaced 30s piano song (481KB) with real cat meow from cat-two.mp3 (25KB)'
    });
  }
}

const packCounts = {};
const catalog = [];
const movedFiles = [];

for (const item of allFiles) {
  const targetPack = classifyFileName(item.fileName);
  const targetPackDir = path.join(DOWNLOADED_DIR, targetPack);
  if (!fs.existsSync(targetPackDir)) {
    fs.mkdirSync(targetPackDir, { recursive: true });
  }

  const destPath = path.join(targetPackDir, item.fileName);
  if (path.resolve(item.fullPath) !== path.resolve(destPath)) {
    fs.renameSync(item.fullPath, destPath);
    movedFiles.push({
      fileName: item.fileName,
      from: item.currentPack || '/',
      to: targetPack
    });
  }

  packCounts[targetPack] = (packCounts[targetPack] || 0) + 1;

  const buf = fs.readFileSync(destPath);
  const ext = path.extname(item.fileName);
  const duration = parseAudioDurationFromBuffer(buf, ext);

  catalog.push({
    id: path.basename(item.fileName, ext),
    pack: targetPack,
    fileName: item.fileName,
    relativePath: `${targetPack}/${item.fileName}`,
    duration,
    sizeBytes: buf.length
  });
}

// Remove any empty subdirectories (e.g. misc)
for (const entry of fs.readdirSync(DOWNLOADED_DIR, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    const subDir = path.join(DOWNLOADED_DIR, entry.name);
    if (fs.readdirSync(subDir).length === 0) {
      fs.rmdirSync(subDir);
    }
  }
}

// Sort catalog by pack then fileName
catalog.sort((a, b) => a.pack.localeCompare(b.pack) || a.fileName.localeCompare(b.fileName));

// Write catalog.json inside downloaded_sounds for fast indexing / CDN usage
const catalogPath = path.join(DOWNLOADED_DIR, 'catalog.json');
fs.writeFileSync(
  catalogPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      totalSounds: catalog.length,
      packCounts,
      sounds: catalog
    },
    null,
    2
  ),
  'utf8'
);

const { SOUND_PACKS } = require('../src/game/soundPacks');
const { buildSoundIndex, resolveSoundFile, getSoundDuration } = require('../src/services/audio.service');
buildSoundIndex(true);

const gamePackVerification = SOUND_PACKS.map(pack => {
  const verified = pack.sounds.map(s => {
    const res = resolveSoundFile(s.relativePath || s.fileName);
    return {
      id: s.id,
      relativePath: s.relativePath || s.fileName,
      found: Boolean(res),
      url: res ? res.url : null,
      duration: getSoundDuration(s.relativePath || s.fileName)
    };
  });
  return {
    packId: pack.id,
    folder: pack.folder,
    total: verified.length,
    foundCount: verified.filter(v => v.found).length,
    missing: verified.filter(v => !v.found).map(v => v.relativePath)
  };
});

// Write report to scripts/organize_report.json
fs.writeFileSync(
  REPORT_PATH,
  JSON.stringify(
    {
      totalFiles: catalog.length,
      fixedFiles,
      packCounts,
      movedCount: movedFiles.length,
      gamePackVerification
    },
    null,
    2
  ),
  'utf8'
);

console.log('DONE:', JSON.stringify(packCounts));
