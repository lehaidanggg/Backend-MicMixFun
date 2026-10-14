/**
 * Mimic Party Game Engine - Facade Entry Point
 * Re-export đầy đủ các thành phần từ cấu trúc modular `src/game` và `src/services/audio.service`
 */
const { GAME_STATES, STATE_LABELS, SOUND_PACKS, AI_REMARKS } = require('./src/game/soundPacks');
const { MimicGameSession } = require('./src/game/MimicGameSession');
const { getSoundDuration, parseAudioDurationFromBuffer } = require('./src/services/audio.service');

module.exports = {
  GAME_STATES,
  STATE_LABELS,
  SOUND_PACKS,
  AI_REMARKS,
  MimicGameSession,
  getSoundDuration,
  parseAudioDurationFromBuffer
};
