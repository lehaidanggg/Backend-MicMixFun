import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_CDN_URL } from '../src/config/constants';
import {
  buildSoundIndex,
  getAllDownloadedSounds,
  getSoundDuration,
  getSoundUrl,
  normalizeBotDifficulty,
  resolveSoundFile,
  transformTargetSoundForBot
} from '../src/services/audio.service';

test('Audio Service — Matrix Test: getSoundUrl', () => {
  const matrix: Array<{
    caseName: string;
    relativePath: string | null | undefined;
    expected: string;
  }> = [
    {
      caseName: 'Standard pack/file relativePath',
      relativePath: 'animals/cat-two.mp3',
      expected: `${ASSET_CDN_URL}/animals/cat-two.mp3`
    },
    {
      caseName: 'Windows backslashes converted to forward slashes',
      relativePath: 'meme\\emotional-damage.mp3',
      expected: `${ASSET_CDN_URL}/meme/emotional-damage.mp3`
    },
    {
      caseName: 'Leading slashes stripped',
      relativePath: '///anime/tuturu.mp3',
      expected: `${ASSET_CDN_URL}/anime/tuturu.mp3`
    },
    {
      caseName: 'Special characters URL-encoded per segment',
      relativePath: 'voices/my sound #1.mp3',
      expected: `${ASSET_CDN_URL}/voices/my%20sound%20%231.mp3`
    },
    {
      caseName: 'Null/empty relativePath',
      relativePath: null,
      expected: `${ASSET_CDN_URL}/`
    }
  ];

  for (const row of matrix) {
    assert.equal(getSoundUrl(row.relativePath), row.expected, `[Matrix Fail] ${row.caseName}`);
  }
});

test('Audio Service — Matrix Test: buildSoundIndex & resolveSoundFile', () => {
  const index = buildSoundIndex(true);
  assert.equal(index.allSounds.length, 251, 'Catalog should contain exactly 251 sounds');

  const matrix: Array<{
    caseName: string;
    query: string | null | undefined;
    expectFound: boolean;
    expectedRelativePath?: string;
  }> = [
    {
      caseName: 'Exact relativePath match',
      query: 'animals/cat-two.mp3',
      expectFound: true,
      expectedRelativePath: 'animals/cat-two.mp3'
    },
    {
      caseName: 'FileName-only lookup',
      query: 'cat-two.mp3',
      expectFound: true,
      expectedRelativePath: 'animals/cat-two.mp3'
    },
    {
      caseName: 'Pack-prefixed fileName lookup (animals_dog-bark.mp3 -> dog-bark.mp3)',
      query: 'animals_dog-bark.mp3',
      expectFound: true,
      expectedRelativePath: 'animals/dog-bark.mp3'
    },
    {
      caseName: 'Windows backslash path lookup',
      query: 'meme\\vine-boom.mp3',
      expectFound: true,
      expectedRelativePath: 'meme/vine-boom.mp3'
    },
    {
      caseName: 'Leading slash path lookup',
      query: '/anime/tuturu.mp3',
      expectFound: true,
      expectedRelativePath: 'anime/tuturu.mp3'
    },
    {
      caseName: 'Non-existent sound file returns null',
      query: 'animals/non-existent-unicorn.mp3',
      expectFound: false
    },
    {
      caseName: 'Null or empty query returns null',
      query: '',
      expectFound: false
    }
  ];

  for (const row of matrix) {
    const resolved = resolveSoundFile(row.query);
    if (row.expectFound) {
      assert.ok(resolved, `[Matrix Fail] ${row.caseName} should resolve`);
      assert.equal(resolved.relativePath, row.expectedRelativePath, `[Matrix Fail] ${row.caseName}`);
      assert.ok(resolved.url.startsWith(ASSET_CDN_URL));
    } else {
      assert.equal(resolved, null, `[Matrix Fail] ${row.caseName} should return null`);
    }
  }
});

test('Audio Service — Matrix Test: getAllDownloadedSounds & getSoundDuration', () => {
  const filterMatrix: Array<{
    caseName: string;
    packFilter: string | null;
    expectedMinCount: number;
    expectedMaxCount: number;
  }> = [
    { caseName: 'All sounds (no filter)', packFilter: null, expectedMinCount: 251, expectedMaxCount: 251 },
    { caseName: 'Filter by "animals"', packFilter: 'animals', expectedMinCount: 40, expectedMaxCount: 50 },
    { caseName: 'Filter by case-insensitive "ANIME"', packFilter: 'ANIME', expectedMinCount: 35, expectedMaxCount: 45 },
    { caseName: 'Filter by "meme"', packFilter: 'meme', expectedMinCount: 20, expectedMaxCount: 30 },
    { caseName: 'Filter by unknown pack returns empty array', packFilter: 'non_existent_pack', expectedMinCount: 0, expectedMaxCount: 0 }
  ];

  for (const row of filterMatrix) {
    const list = getAllDownloadedSounds(row.packFilter);
    assert.ok(
      list.length >= row.expectedMinCount && list.length <= row.expectedMaxCount,
      `[Matrix Fail] ${row.caseName}: got ${list.length}`
    );
  }

  const durationMatrix: Array<{
    caseName: string;
    input: string | null | undefined;
    expectFallback4: boolean;
  }> = [
    { caseName: 'Known sound by relativePath', input: 'animals/cat-two.mp3', expectFallback4: false },
    { caseName: 'Known sound by fileName', input: 'vine-boom.mp3', expectFallback4: false },
    { caseName: 'Unknown sound falls back to 4.0s', input: 'unknown_file_xyz.mp3', expectFallback4: true },
    { caseName: 'Null input falls back to 4.0s', input: null, expectFallback4: true }
  ];

  for (const row of durationMatrix) {
    const dur = getSoundDuration(row.input);
    assert.equal(typeof dur, 'number');
    assert.ok(dur >= 1.5 && dur <= 12.0, `[Matrix Fail] ${row.caseName}: duration ${dur} out of [1.5, 12.0]`);
    if (row.expectFallback4) {
      assert.equal(dur, 4.0, `[Matrix Fail] ${row.caseName}`);
    }
  }
});

test('Audio Service — Matrix Test: normalizeBotDifficulty & transformTargetSoundForBot (EASY / NORMAL / HARD)', () => {
  assert.equal(normalizeBotDifficulty('WEAK'), 'EASY');
  assert.equal(normalizeBotDifficulty('YEU'), 'EASY');
  assert.equal(normalizeBotDifficulty('EASY'), 'EASY');
  assert.equal(normalizeBotDifficulty('NORMAL'), 'NORMAL');
  assert.equal(normalizeBotDifficulty('THONG_THUONG'), 'NORMAL');
  assert.equal(normalizeBotDifficulty('HARD'), 'HARD');
  assert.equal(normalizeBotDifficulty('KHO'), 'HARD');

  const easy = transformTargetSoundForBot('animals/cat-two.mp3', 'animals', 'EASY', 101);
  const normal = transformTargetSoundForBot('animals/cat-two.mp3', 'animals', 'NORMAL', 202);
  const hard = transformTargetSoundForBot('animals/cat-two.mp3', 'animals', 'HARD', 303);

  // All modes transform the exact original targetSound (not a different sound file)
  assert.equal(easy.sound.relativePath, 'animals/cat-two.mp3');
  assert.equal(normal.sound.relativePath, 'animals/cat-two.mp3');
  assert.equal(hard.sound.relativePath, 'animals/cat-two.mp3');

  // Noise & distortion scale strictly from HARD < NORMAL < EASY
  assert.ok(hard.effects.noiseLevel < normal.effects.noiseLevel, 'HARD should have less noise than NORMAL');
  assert.ok(normal.effects.noiseLevel < easy.effects.noiseLevel, 'NORMAL should have less noise than EASY');
  assert.ok(hard.effects.distortion < normal.effects.distortion, 'HARD should have less distortion than NORMAL');
  assert.ok(normal.effects.distortion < easy.effects.distortion, 'NORMAL should have less distortion than EASY');
  assert.ok(hard.effects.startDelayMs < normal.effects.startDelayMs);
  assert.ok(normal.effects.startDelayMs < easy.effects.startDelayMs);

  // Valid WAV buffer & RIFF header generated for each bot
  assert.equal(easy.audioBuffer.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(normal.audioBuffer.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(hard.audioBuffer.subarray(0, 4).toString('ascii'), 'RIFF');
});
