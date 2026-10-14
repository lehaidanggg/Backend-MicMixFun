const { getSoundDuration, resolveSoundFile, getSoundUrl } = require('../services/audio.service');
const { GAME_STATES, STATE_LABELS, SOUND_PACKS, AI_REMARKS } = require('./soundPacks');

class MimicGameSession {
  constructor(roomId, io, config = {}) {
    this.roomId = roomId;
    this.io = io;
    this.totalRounds = config.totalRounds || 3;
    this.recordDuration = config.recordDuration || 5;
    this.customRecordDuration = null;
    this.useCustomRecordDuration = false;
    this.currentRound = 0;
    this.state = GAME_STATES.IDLE;
    this.players = new Map();
    this.disconnectedPlayers = new Map();
    this.selectedPack = null;
    this.targetSound = null;
    this.usedSoundIds = new Set();
    this.timer = null;
    this.nextStageTimer = null;
    this.timeRemaining = 0;
    this.currentDuration = 0;
    this.currentPayload = {};
    this.showdownSkipVotes = new Set();
    this.sampleDoneSockets = new Set();
    this.sampleStartTime = 0;
    this.audioStore = new Map(); // socketId -> { buffer, mimeType, updatedAt }
  }

  addPlayer(socketId, userName, avatar, role = 'PLAYER', userId = null, isAuthenticated = false) {
    const savedState = (userId && isAuthenticated) ? this.disconnectedPlayers.get(userId) : null;

    if (savedState && (Date.now() - savedState.disconnectedAt < 120000)) {
      this.disconnectedPlayers.delete(userId);
      this.players.set(socketId, {
        socketId,
        userId,
        userName,
        avatar: avatar || savedState.avatar || '🎧',
        role,
        totalScore: savedState.totalScore || 0,
        isReady: (this.state === GAME_STATES.ROUND_RESULT || this.state === GAME_STATES.GAME_OVER)
          ? false
          : (role === 'HOST'),
        roundScore: savedState.roundScore || 0,
        currentAttempt: savedState.currentAttempt || null,
        joinedMidRound: false
      });
      return { restored: true, totalScore: savedState.totalScore || 0 };
    }

    if (!this.players.has(socketId)) {
      const isMidRound = (
        this.state === GAME_STATES.USER_RECORDING ||
        this.state === GAME_STATES.AI_SCORING ||
        this.state === GAME_STATES.SHOWDOWN_REVEAL
      );
      this.players.set(socketId, {
        socketId,
        userId,
        userName,
        avatar: avatar || '🎧',
        role,
        totalScore: 0,
        isReady: (this.state === GAME_STATES.ROUND_RESULT || this.state === GAME_STATES.GAME_OVER)
          ? false
          : (role === 'HOST'),
        roundScore: 0,
        currentAttempt: null,
        joinedMidRound: isMidRound
      });
    }
    return { restored: false, totalScore: 0 };
  }

  setHost(newHostSocketId) {
    this.hostId = newHostSocketId;
    for (const [sId, p] of this.players.entries()) {
      p.role = (sId === newHostSocketId) ? 'HOST' : 'PLAYER';
      if (p.role === 'HOST' && this.state === GAME_STATES.IDLE) {
        p.isReady = true;
      }
    }
  }

  setPlayerReady(socketId, isReady) {
    const p = this.players.get(socketId);
    if (p) {
      p.isReady = isReady;
    }
  }

  updateConfig({ totalRounds, recordDuration, useCustomRecordDuration }) {
    if (this.state !== GAME_STATES.IDLE && this.state !== GAME_STATES.GAME_OVER) return false;
    if (totalRounds && [3, 5, 7, 10].includes(Number(totalRounds))) {
      this.totalRounds = Number(totalRounds);
    }
    if (recordDuration && Number(recordDuration) >= 3 && Number(recordDuration) <= 15) {
      this.recordDuration = Number(recordDuration);
      this.customRecordDuration = Number(recordDuration);
      if (typeof useCustomRecordDuration === 'boolean') {
        this.useCustomRecordDuration = useCustomRecordDuration;
      }
    }
    return true;
  }

  removePlayer(socketId) {
    const leavingPlayer = this.players.get(socketId);
    if (leavingPlayer && leavingPlayer.userId && (leavingPlayer.totalScore > 0 || leavingPlayer.currentAttempt)) {
      this.disconnectedPlayers.set(leavingPlayer.userId, {
        ...leavingPlayer,
        disconnectedAt: Date.now()
      });
    }

    this.players.delete(socketId);
    this.showdownSkipVotes.delete(socketId);
    this.sampleDoneSockets.delete(socketId);

    if (this.players.size === 0) {
      this.stopTimer();
      this.state = GAME_STATES.IDLE;
      return;
    }

    if (this.state === GAME_STATES.PLAYING_SAMPLE) {
      if (this.sampleDoneSockets.size >= this.players.size && !this.sampleFinishedHandled) {
        this.sampleFinishedHandled = true;
        this.stopTimer();
        const rawDuration = getSoundDuration(this.targetSound ? this.targetSound.fileName : null);
        this.startPrepareRecordingState(rawDuration);
      }
    } else if (this.state === GAME_STATES.USER_RECORDING) {
      const activePlayers = Array.from(this.players.values()).filter(p => !p.joinedMidRound);
      const allSubmitted = activePlayers.length > 0 && activePlayers.every(p => p.currentAttempt !== null);
      if (allSubmitted && this.timeRemaining > 1) {
        this.startAiScoringState();
      }
    } else if (this.state === GAME_STATES.SHOWDOWN_REVEAL) {
      const skipCount = this.showdownSkipVotes.size;
      const totalCount = this.players.size;
      const allSkipConfirmed = (totalCount > 0 && skipCount === totalCount);

      this.io.to(this.roomId).emit('showdown_skip_updated', {
        socketId: null,
        userName: 'System',
        skipCount,
        totalCount,
        allSkipConfirmed,
        votedSockets: Array.from(this.showdownSkipVotes)
      });

      if (allSkipConfirmed) {
        this.startRoundResultState();
      }
    } else if (this.state === GAME_STATES.ROUND_RESULT || this.state === GAME_STATES.GAME_OVER) {
      const readyPlayers = Array.from(this.players.values()).filter(p => p.isReady);
      const totalCount = this.players.size;
      const readyCount = readyPlayers.length;
      const allReady = (totalCount > 0 && readyCount === totalCount);

      this.io.to(this.roomId).emit('round_ready_updated', {
        readyCount,
        totalCount,
        allReady,
        players: Array.from(this.players.values()).map(p => ({
          socketId: p.socketId,
          userName: p.userName,
          avatar: p.avatar,
          role: p.role,
          isReady: p.isReady
        }))
      });

      if (allReady) {
        this.triggerNextStageAfterAllReady();
      }
    }
  }

  transitionToState(nextState, durationSeconds, payload = {}, onComplete = null) {
    this.stopTimer();
    this.state = nextState;
    this.currentDuration = durationSeconds;
    this.timeRemaining = Math.ceil(durationSeconds);
    this.currentPayload = payload;

    console.log(`[GameSession:${this.roomId}] 🔄 State => ${nextState} (${durationSeconds}s) - Vòng ${this.currentRound}/${this.totalRounds}`);

    this.io.to(this.roomId).emit('game_state_changed', {
      state: this.state,
      stateLabel: STATE_LABELS[this.state] || this.state,
      round: this.currentRound,
      totalRounds: this.totalRounds,
      duration: this.currentDuration,
      timeRemaining: this.timeRemaining,
      timestamp: Date.now(),
      payload: this.currentPayload
    });

    if (durationSeconds > 0) {
      const totalTicks = Math.ceil(durationSeconds);
      this.timer = setInterval(() => {
        this.timeRemaining = Math.max(0, this.timeRemaining - 1);

        this.io.to(this.roomId).emit('game_state_tick', {
          state: this.state,
          timeRemaining: this.timeRemaining,
          totalDuration: totalTicks,
          progressPercent: Math.max(0, Math.min(100, Math.round(((totalTicks - this.timeRemaining) / totalTicks) * 100)))
        });

        if (this.timeRemaining <= 0) {
          this.stopTimer();
          if (onComplete) onComplete();
        }
      }, 1000);
    }
  }

  getStateSnapshot() {
    return {
      roomId: this.roomId,
      hostId: this.hostId,
      state: this.state,
      stateLabel: STATE_LABELS[this.state] || this.state,
      round: this.currentRound,
      totalRounds: this.totalRounds,
      recordDuration: this.recordDuration,
      duration: this.currentDuration,
      timeRemaining: this.timeRemaining,
      selectedPack: this.selectedPack,
      targetSound: this.targetSound,
      payload: this.currentPayload,
      players: Array.from(this.players.values()).map(p => ({
        socketId: p.socketId,
        userName: p.userName,
        avatar: p.avatar,
        role: p.role || (p.socketId === this.hostId ? 'HOST' : 'PLAYER'),
        isReady: p.isReady || (this.state === GAME_STATES.IDLE && p.role === 'HOST'),
        totalScore: p.totalScore,
        roundScore: p.roundScore
      }))
    };
  }

  startGame(options = {}) {
    if (this.state !== GAME_STATES.IDLE && this.state !== GAME_STATES.GAME_OVER) return false;
    if (this.players.size === 0) return false;

    if (options.requireAllReady) {
      const unready = Array.from(this.players.values()).filter(p => p.role !== 'HOST' && !p.isReady);
      if (unready.length > 0) {
        return false;
      }
    }

    this.currentRound = 0;
    this.usedSoundIds.clear();
    this.audioStore.clear();
    for (const player of this.players.values()) {
      player.totalScore = 0;
      player.roundScore = 0;
      player.currentAttempt = null;
      player.joinedMidRound = false;
    }
    this.startNextRound();
    return true;
  }

  startNextRound() {
    this.currentRound++;
    if (this.currentRound > this.totalRounds) {
      this.finishGame();
      return;
    }

    this.audioStore.clear();
    for (const player of this.players.values()) {
      player.roundScore = 0;
      player.currentAttempt = null;
      player.joinedMidRound = false;
    }

    const packsWithFiles = SOUND_PACKS.map(pack => {
      const existingSounds = (pack.sounds || []).filter(s =>
        Boolean(resolveSoundFile(s.relativePath || s.fileName))
      );
      return { ...pack, existingSounds };
    }).filter(p => p.existingSounds.length > 0);

    let candidatePacks = packsWithFiles.map(p => ({
      ...p,
      unusedSounds: p.existingSounds.filter(s => !this.usedSoundIds.has(s.id))
    })).filter(p => p.unusedSounds.length > 0);

    if (candidatePacks.length === 0) {
      this.usedSoundIds.clear();
      candidatePacks = packsWithFiles.map(p => ({
        ...p,
        unusedSounds: p.existingSounds
      }));
    }

    const chosenPack = candidatePacks[Math.floor(Math.random() * candidatePacks.length)] || SOUND_PACKS[0];
    this.selectedPack = SOUND_PACKS.find(p => p.id === chosenPack.id) || chosenPack;

    const pool = chosenPack.unusedSounds || chosenPack.sounds;
    this.targetSound = pool[Math.floor(Math.random() * pool.length)] || this.selectedPack.sounds[0];
    if (this.targetSound && this.targetSound.id) {
      this.usedSoundIds.add(this.targetSound.id);
    }

    this.transitionToState(
      GAME_STATES.THEME_SELECTION,
      3.5,
      {
        selectedPack: {
          id: this.selectedPack.id,
          name: this.selectedPack.name,
          emoji: this.selectedPack.emoji,
          description: this.selectedPack.description
        },
        allPacks: SOUND_PACKS.map(p => ({ id: p.id, name: p.name, emoji: p.emoji }))
      },
      () => this.startPlaySampleState()
    );
  }

  getTargetSoundUrl(sound) {
    if (!sound) return '';
    const resolved = resolveSoundFile(sound.relativePath || sound.fileName);
    if (resolved) return resolved.url;
    return getSoundUrl(sound.relativePath || sound.fileName);
  }

  startPlaySampleState() {
    const soundRef = this.targetSound.relativePath || this.targetSound.fileName;
    const rawDuration = getSoundDuration(soundRef);
    const playDuration = Math.max(2, Math.ceil(rawDuration));
    const audioUrl = this.getTargetSoundUrl(this.targetSound);

    this.sampleFinishedHandled = false;
    this.sampleDoneSockets.clear();
    this.sampleStartTime = Date.now();

    console.log(`[MimicGame:${this.roomId}] 🔊 Phát âm thanh mẫu: ${this.targetSound.name} (Độ dài: ${rawDuration}s | Timer: ${playDuration}s)`);

    this.transitionToState(
      GAME_STATES.PLAYING_SAMPLE,
      playDuration,
      {
        pack: {
          id: this.selectedPack.id,
          name: this.selectedPack.name,
          emoji: this.selectedPack.emoji
        },
        targetSound: {
          id: this.targetSound.id,
          name: this.targetSound.name,
          emoji: this.targetSound.emoji,
          hint: this.targetSound.hint,
          audioUrl,
          rawDuration,
          exactDuration: rawDuration,
          duration: playDuration
        }
      },
      () => {
        if (!this.sampleFinishedHandled) {
          this.sampleFinishedHandled = true;
          this.startPrepareRecordingState(rawDuration);
        }
      }
    );
  }

  handleSamplePlaybackDone(socketId) {
    if (this.state !== GAME_STATES.PLAYING_SAMPLE || this.sampleFinishedHandled) return;
    if (!this.players.has(socketId)) return;

    this.sampleDoneSockets.add(socketId);
    const elapsedSec = (Date.now() - this.sampleStartTime) / 1000;
    const isHostDone = (socketId === this.hostId && elapsedSec >= 0.8);
    const isAllDone = (this.sampleDoneSockets.size >= this.players.size);

    if (isAllDone || isHostDone) {
      this.sampleFinishedHandled = true;
      this.stopTimer();
      const soundRef = this.targetSound ? (this.targetSound.relativePath || this.targetSound.fileName) : null;
      const rawDuration = getSoundDuration(soundRef);
      console.log(`[MimicGame:${this.roomId}] 🔊 Audio mẫu đã phát xong trọn vẹn (báo bởi ${socketId}, ${this.sampleDoneSockets.size}/${this.players.size}) ➔ Bắt đầu đếm 3..2..1!`);
      this.startPrepareRecordingState(rawDuration);
    }
  }

  startPrepareRecordingState(recordingDuration) {
    const soundRef = this.targetSound ? (this.targetSound.relativePath || this.targetSound.fileName) : null;
    const rawDuration = getSoundDuration(soundRef);
    const exactDuration = (this.useCustomRecordDuration && this.customRecordDuration)
      ? this.customRecordDuration
      : ((typeof recordingDuration === 'number' && recordingDuration > 0) ? recordingDuration : rawDuration);
    const roundedDuration = Math.max(2, Math.ceil(exactDuration));
    const audioUrl = this.getTargetSoundUrl(this.targetSound);

    console.log(`[MimicGame:${this.roomId}] 🧘 Chuẩn bị lấy hơi & bật micro (3s đệm) -> Thời gian nhại: ${exactDuration}s`);

    this.transitionToState(
      GAME_STATES.PREPARE_RECORDING,
      3,
      {
        targetSound: {
          id: this.targetSound.id,
          name: this.targetSound.name,
          emoji: this.targetSound.emoji,
          hint: this.targetSound.hint,
          audioUrl,
          rawDuration: exactDuration,
          exactDuration,
          duration: roundedDuration
        },
        exactDuration,
        recordingDuration: roundedDuration,
        message: 'Lấy hơi! Chuẩn bị micro để nhại lại trong 3 giây...'
      },
      () => this.startUserRecordingState(exactDuration)
    );
  }

  startUserRecordingState(customDuration = null) {
    const soundRef = this.targetSound ? (this.targetSound.relativePath || this.targetSound.fileName) : null;
    const rawDuration = getSoundDuration(soundRef);
    const exactDuration = (typeof customDuration === 'number' && customDuration > 0) ? customDuration : rawDuration;
    const duration = Math.max(2, Math.ceil(exactDuration));
    const audioUrl = this.getTargetSoundUrl(this.targetSound);

    console.log(`[MimicGame:${this.roomId}] 🎙️ Tới lượt user nhại lại - Thời gian nhại: ${exactDuration}s (Timer: ${duration}s)`);

    this.transitionToState(
      GAME_STATES.USER_RECORDING,
      duration,
      {
        targetSound: {
          id: this.targetSound.id,
          name: this.targetSound.name,
          emoji: this.targetSound.emoji,
          hint: this.targetSound.hint,
          audioUrl,
          rawDuration: exactDuration,
          exactDuration,
          duration
        },
        exactDuration,
        duration,
        message: '🎙️ TỚI LƯỢT BẠN! HÃY NHẠI LẠI NGAY VÀO MICRO!'
      },
      () => this.startAiScoringState()
    );
  }

  submitMimicAudio(socketId, audioBase64, mimeType = 'audio/webm', clientMetrics = null) {
    if (this.state !== GAME_STATES.USER_RECORDING && this.state !== GAME_STATES.AI_SCORING) {
      return { success: false, message: 'Hiện không trong thời gian thu âm!' };
    }

    const player = this.players.get(socketId);
    if (!player) {
      return { success: false, message: 'Người chơi không tồn tại trong phòng!' };
    }

    if (player.currentAttempt !== null) {
      console.warn(`[MimicGame:${this.roomId}] ⚠️ Chặn ${player.userName} nộp bài trùng lặp trong vòng ${this.currentRound}`);
      return { success: false, message: 'Bạn đã nộp bài trong vòng này rồi!' };
    }

    const evaluation = this.evaluateMimicAttempt(audioBase64, clientMetrics);

    let resolvedAudioUrl = audioBase64 || null;
    if (audioBase64 && typeof audioBase64 === 'string') {
      const commaIdx = audioBase64.indexOf(',');
      const rawB64 = commaIdx !== -1 ? audioBase64.slice(commaIdx + 1) : audioBase64;
      try {
        const buf = Buffer.from(rawB64, 'base64');
        this.audioStore.set(socketId, {
          buffer: buf,
          mimeType: mimeType || 'audio/webm',
          updatedAt: Date.now()
        });
        if (audioBase64.length > 65536) {
          resolvedAudioUrl = `/api/attempts/${encodeURIComponent(this.roomId)}/${encodeURIComponent(socketId)}?r=${this.currentRound}&t=${Date.now()}`;
        }
      } catch (e) {}
    }

    player.roundScore = evaluation.totalScore;
    player.totalScore += evaluation.totalScore;
    player.currentAttempt = {
      audioUrl: resolvedAudioUrl,
      audioStreamUrl: `/api/attempts/${encodeURIComponent(this.roomId)}/${encodeURIComponent(socketId)}?r=${this.currentRound}`,
      mimeType,
      evaluation,
      submittedAt: Date.now()
    };

    console.log(`[MimicGame:${this.roomId}] 🎯 ${player.userName} nộp bài nhại: ${evaluation.totalScore}đ (${evaluation.grade})`);

    const activePlayers = Array.from(this.players.values()).filter(p => !p.joinedMidRound);
    const allSubmitted = activePlayers.length > 0 && activePlayers.every(p => p.currentAttempt !== null);
    if (allSubmitted && this.state === GAME_STATES.USER_RECORDING && this.timeRemaining > 1) {
      console.log(`[MimicGame:${this.roomId}] ⚡ Tất cả người chơi đã nộp bài! Chuyển nhanh sang chấm điểm...`);
      this.startAiScoringState();
    }

    return { success: true, evaluation };
  }

  getAttemptAudio(socketId) {
    return this.audioStore.get(socketId) || null;
  }

  startAiScoringState() {
    const suspenseDuration = 5;
    console.log(`[MimicGame:${this.roomId}] 🤖 AI Voice Detector đang phân tích & chấm điểm hồi hộp (${suspenseDuration}s)...`);

    this.transitionToState(
      GAME_STATES.AI_SCORING,
      suspenseDuration,
      {
        duration: suspenseDuration,
        message: '🤖 AI Voice Detector đang phân tích & đối chiếu phổ âm thanh...',
        suspenseDuration
      },
      () => this.startShowdownRevealState()
    );
  }

  startShowdownRevealState() {
    for (const player of this.players.values()) {
      if (!player.currentAttempt) {
        player.currentAttempt = {
          audioUrl: null,
          evaluation: {
            totalScore: 0,
            pitchScore: 0,
            rhythmScore: 0,
            energyScore: 0,
            grade: 'F',
            remark: '😴 Không kịp thu âm nhại lại!'
          }
        };
      }
    }

    const attemptsList = Array.from(this.players.values()).map(p => ({
      socketId: p.socketId,
      userName: p.userName,
      avatar: p.avatar,
      roundScore: p.roundScore,
      totalScore: p.totalScore,
      audioUrl: p.currentAttempt.audioUrl,
      audioStreamUrl: p.currentAttempt.audioStreamUrl || null,
      evaluation: p.currentAttempt.evaluation
    })).sort((a, b) => b.roundScore - a.roundScore);

    this.showdownSkipVotes.clear();

    this.transitionToState(
      GAME_STATES.SHOWDOWN_REVEAL,
      25,
      {
        pack: this.selectedPack,
        targetSound: this.targetSound,
        attempts: attemptsList,
        roundWinner: attemptsList[0] || null,
        skipCount: 0,
        totalCount: this.players.size,
        votedSockets: []
      },
      () => this.startRoundResultState()
    );
  }

  confirmShowdownSkip(socketId) {
    if (this.state !== GAME_STATES.SHOWDOWN_REVEAL) {
      return { success: false, message: 'Chưa tới giai đoạn Showdown Reveal' };
    }

    const player = this.players.get(socketId);
    if (!player) return { success: false, message: 'Người chơi không tồn tại' };

    let isVoted = false;
    if (this.showdownSkipVotes.has(socketId)) {
      this.showdownSkipVotes.delete(socketId);
      isVoted = false;
    } else {
      this.showdownSkipVotes.add(socketId);
      isVoted = true;
    }

    const totalCount = this.players.size;
    const skipCount = this.showdownSkipVotes.size;
    const allSkipConfirmed = (totalCount > 0 && skipCount === totalCount);

    console.log(`[MimicGame:${this.roomId}] ⏩ [${player.userName}] ${isVoted ? 'đồng ý' : 'hủy'} xem bảng điểm sớm (${skipCount}/${totalCount})`);

    this.io.to(this.roomId).emit('showdown_skip_updated', {
      socketId,
      userName: player.userName,
      isVoted,
      skipCount,
      totalCount,
      allSkipConfirmed,
      votedSockets: Array.from(this.showdownSkipVotes)
    });

    if (allSkipConfirmed) {
      console.log(`[MimicGame:${this.roomId}] 🚀 Tất cả người chơi (${totalCount}/${totalCount}) đã đồng ý xem bảng điểm sớm! Chuyển ngay...`);
      this.io.to(this.roomId).emit('all_players_ready', {
        message: '🚀 Tất cả đã đồng ý! Đang mở Bảng Điểm Vòng...'
      });
      this.startRoundResultState();
    }

    return {
      success: true,
      isVoted,
      skipCount,
      totalCount,
      allSkipConfirmed
    };
  }

  skipToShowdownResult(socketId) {
    if (socketId) {
      return this.confirmShowdownSkip(socketId);
    }
    if (this.state === GAME_STATES.SHOWDOWN_REVEAL) {
      this.startRoundResultState();
      return { success: true };
    }
    return { success: false };
  }

  startRoundResultState() {
    this.clearRoundAudioData();

    for (const player of this.players.values()) {
      player.isReady = false;
    }

    const leaderboard = Array.from(this.players.values())
      .map(p => ({
        socketId: p.socketId,
        userName: p.userName,
        avatar: p.avatar,
        role: p.role,
        roundScore: p.roundScore,
        totalScore: p.totalScore,
        isReady: false
      }))
      .sort((a, b) => b.totalScore - a.totalScore);

    const isLastRound = this.currentRound >= this.totalRounds;

    this.transitionToState(
      GAME_STATES.ROUND_RESULT,
      0,
      {
        leaderboard,
        isLastRound,
        nextRound: isLastRound ? null : this.currentRound + 1,
        readyCount: 0,
        totalCount: this.players.size,
        players: leaderboard
      },
      null
    );
  }

  finishGame() {
    this.clearRoundAudioData();

    for (const player of this.players.values()) {
      player.isReady = false;
    }

    const finalRanking = Array.from(this.players.values())
      .map(p => ({
        socketId: p.socketId,
        userName: p.userName,
        avatar: p.avatar,
        role: p.role,
        totalScore: p.totalScore,
        isReady: false
      }))
      .sort((a, b) => b.totalScore - a.totalScore);

    const champion = finalRanking[0] || null;

    this.transitionToState(
      GAME_STATES.GAME_OVER,
      0,
      {
        finalRanking,
        champion,
        readyCount: 0,
        totalCount: this.players.size,
        players: finalRanking,
        message: champion ? `🏆 Chúc mừng ${champion.userName} đã trở thành Vua Nhại Giọng!` : 'Trận đấu kết thúc!'
      },
      null
    );
  }

  confirmRoundReady(socketId) {
    if (this.state !== GAME_STATES.ROUND_RESULT && this.state !== GAME_STATES.GAME_OVER) {
      return { success: false, message: 'Chưa tới giai đoạn xác nhận sẵn sàng' };
    }

    const player = this.players.get(socketId);
    if (!player) return { success: false, message: 'Người chơi không tồn tại' };

    player.isReady = true;

    const readyPlayers = Array.from(this.players.values()).filter(p => p.isReady);
    const totalCount = this.players.size;
    const readyCount = readyPlayers.length;
    const allReady = (totalCount > 0 && readyCount === totalCount);

    console.log(`[MimicGame:${this.roomId}] 🎯 [${player.userName}] xác nhận SẴN SÀNG (${readyCount}/${totalCount})`);

    this.io.to(this.roomId).emit('round_ready_updated', {
      socketId,
      userName: player.userName,
      readyCount,
      totalCount,
      allReady,
      players: Array.from(this.players.values()).map(p => ({
        socketId: p.socketId,
        userName: p.userName,
        avatar: p.avatar,
        role: p.role,
        isReady: p.isReady
      }))
    });

    if (allReady) {
      this.triggerNextStageAfterAllReady();
    }

    return { success: true, readyCount, totalCount, allReady };
  }

  triggerNextStageAfterAllReady() {
    if (this.nextStageTimer) return;

    console.log(`[MimicGame:${this.roomId}] 🎉 TẤT CẢ NGƯỜI CHƠI ĐÃ SẴN SÀNG! Đang đếm ngược 3s...`);
    this.io.to(this.roomId).emit('all_players_ready', {
      message: '🎉 Tất cả người chơi đã SẴN SÀNG! Bắt đầu trong 3 giây...',
      countdown: 3
    });

    this.nextStageTimer = setTimeout(() => {
      this.nextStageTimer = null;
      if (this.players.size === 0) return;

      if (this.state === GAME_STATES.ROUND_RESULT) {
        const isLastRound = this.currentRound >= this.totalRounds;
        if (isLastRound) {
          this.finishGame();
        } else {
          this.startNextRound();
        }
      } else if (this.state === GAME_STATES.GAME_OVER) {
        this.startGame();
      }
    }, 3000);
  }

  evaluateMimicAttempt(audioBase64, clientMetrics = null) {
    if (!audioBase64 || typeof audioBase64 !== 'string' || audioBase64.length < 500) {
      return {
        totalScore: 0,
        pitchScore: 0,
        rhythmScore: 0,
        energyScore: 0,
        grade: 'F',
        remark: AI_REMARKS.terrible[Math.floor(Math.random() * AI_REMARKS.terrible.length)]
      };
    }

    let pitchScore = 0;
    let rhythmScore = 0;
    let energyScore = 0;

    if (clientMetrics && typeof clientMetrics === 'object' && typeof clientMetrics.matchPct === 'number') {
      if (typeof clientMetrics.activeRatio === 'number' && clientMetrics.activeRatio < 0.05) {
        return {
          totalScore: 15,
          pitchScore: 18,
          rhythmScore: 12,
          energyScore: 10,
          grade: 'F',
          remark: AI_REMARKS.terrible[Math.floor(Math.random() * AI_REMARKS.terrible.length)]
        };
      }
      pitchScore = Math.min(99, Math.max(35, Math.round(clientMetrics.matchPct)));
      rhythmScore = Math.min(98, Math.max(35, Math.round((clientMetrics.rhythmScore || clientMetrics.matchPct * 0.95))));
      energyScore = Math.min(100, Math.max(35, Math.round((clientMetrics.energyScore || clientMetrics.matchPct * 1.02))));
    } else {
      const commaIdx = audioBase64.indexOf(',');
      const rawB64 = commaIdx !== -1 ? audioBase64.slice(commaIdx + 1) : audioBase64;
      const buf = Buffer.from(rawB64, 'base64');

      const uniqueBytes = new Set();
      let deltaSum = 0;
      const step = Math.max(1, Math.floor(buf.length / 256));
      let samples = 0;
      for (let i = step; i < buf.length; i += step) {
        uniqueBytes.add(buf[i]);
        deltaSum += Math.abs(buf[i] - buf[i - step]);
        samples++;
      }

      const avgDelta = samples > 0 ? deltaSum / samples : 0;
      const diversity = uniqueBytes.size / 256;

      if (uniqueBytes.size < 4) {
        return {
          totalScore: 10,
          pitchScore: 10,
          rhythmScore: 10,
          energyScore: 10,
          grade: 'F',
          remark: AI_REMARKS.terrible[Math.floor(Math.random() * AI_REMARKS.terrible.length)]
        };
      }

      const seed = buf.length + Math.round(avgDelta * 10) + uniqueBytes.size;
      pitchScore = Math.min(99, Math.max(48, Math.round(68 + diversity * 12 + (seed % 20) - 4)));
      rhythmScore = Math.min(98, Math.max(52, Math.round(70 + diversity * 10 + ((seed * 7) % 20) - 4)));
      energyScore = Math.min(100, Math.max(45, Math.round(69 + Math.min(15, avgDelta / 6) + ((seed * 13) % 18) - 3)));
    }

    const totalScore = Math.round(pitchScore * 0.4 + rhythmScore * 0.35 + energyScore * 0.25);

    let grade = 'B';
    let remark = '';

    if (totalScore >= 90) {
      grade = 'S';
      remark = AI_REMARKS.legendary[Math.floor(Math.random() * AI_REMARKS.legendary.length)];
    } else if (totalScore >= 75) {
      grade = 'A';
      remark = AI_REMARKS.good[Math.floor(Math.random() * AI_REMARKS.good.length)];
    } else if (totalScore >= 55) {
      grade = 'B';
      remark = AI_REMARKS.funny[Math.floor(Math.random() * AI_REMARKS.funny.length)];
    } else {
      grade = 'C';
      remark = AI_REMARKS.funny[Math.floor(Math.random() * AI_REMARKS.funny.length)];
    }

    return {
      totalScore,
      pitchScore,
      rhythmScore,
      energyScore,
      grade,
      remark
    };
  }

  clearRoundAudioData() {
    this.audioStore.clear();
    for (const player of this.players.values()) {
      if (player.currentAttempt) {
        player.currentAttempt.audioUrl = null;
      }
    }
    if (this.currentPayload && Array.isArray(this.currentPayload.attempts)) {
      for (const att of this.currentPayload.attempts) {
        att.audioUrl = null;
      }
    }
  }

  destroy() {
    this.stopTimer();
    this.clearRoundAudioData();
    this.players.clear();
    this.disconnectedPlayers.clear();
    this.usedSoundIds.clear();
    this.showdownSkipVotes.clear();
    this.sampleDoneSockets.clear();
    this.currentPayload = {};
    this.selectedPack = null;
    this.targetSound = null;
    this.state = GAME_STATES.IDLE;
  }

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.nextStageTimer) {
      clearTimeout(this.nextStageTimer);
      this.nextStageTimer = null;
    }
  }
}

module.exports = {
  MimicGameSession
};
