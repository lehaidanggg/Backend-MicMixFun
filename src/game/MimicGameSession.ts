import { Server } from 'socket.io';
import {
  DEFAULT_RECORD_DURATION_SEC,
  DEFAULT_TOTAL_ROUNDS,
  GAME_STEP_DURATIONS,
  MAX_BOTS_PER_CLIENT_PER_ROUND,
  MAX_BOT_AUDIO_UPLOAD_BYTES,
  MAX_USER_AUDIO_UPLOAD_BYTES
} from '../config/constants';
import {
  getSoundDuration,
  resolveSoundFile,
  getSoundUrl,
  normalizeBotDifficulty,
  transformTargetSoundForBot,
  decodeBoundedBase64Audio
} from '../services/audio.service';
import { AiRemarkCode, ErrorCode, GameMessageCode } from '../config/messages';
import { GAME_STATES, STATE_LABELS, SOUND_PACKS, AI_REMARKS } from './soundPacks';
import {
  AudioStoreRecord,
  BotDifficulty,
  BotGenerationMode,
  ClientMetrics,
  DisconnectedPlayerRecord,
  EvaluationResult,
  GameModeType,
  GamePlayer,
  GameStateType,
  SoundPack,
  SoundPackSound,
  UserRole
} from '../types';

export interface GameConfig {
  totalRounds?: number | string;
  recordDuration?: number | string;
  useCustomRecordDuration?: boolean;
  gameMode?: GameModeType;
  targetPlayers?: number;
}

export class MimicGameSession {
  public roomId: string;
  public io: Server;
  public hostId: string | null = null;
  public gameMode: GameModeType = 'CUSTOM_ROOM';
  public targetPlayers = 4;
  public onGameOverRematchReady: ((roomId: string, game: MimicGameSession) => void) | null = null;
  public totalRounds: number;
  public recordDuration: number;
  public customRecordDuration: number | null = null;
  public useCustomRecordDuration = false;
  public currentRound = 0;
  public state: GameStateType = GAME_STATES.IDLE;
  public players = new Map<string, GamePlayer>();
  public disconnectedPlayers = new Map<string, DisconnectedPlayerRecord>();
  public selectedPack: SoundPack | null = null;
  public targetSound: SoundPackSound | null = null;
  public usedSoundIds = new Set<string>();
  public timer: ReturnType<typeof setInterval> | null = null;
  public nextStageTimer: ReturnType<typeof setTimeout> | null = null;
  public timeRemaining = 0;
  public currentDuration = 0;
  public stateStartedAt = 0;
  public stateEndsAt = 0;
  public currentPayload: Record<string, any> = {};
  public showdownSkipVotes = new Set<string>();
  public sampleDoneSockets = new Set<string>();
  public sampleStartTime = 0;
  public sampleFinishedHandled = false;
  public audioStore = new Map<string, AudioStoreRecord>();

  constructor(roomId: string, io: Server, config: GameConfig = {}) {
    this.roomId = roomId;
    this.io = io;
    this.totalRounds = Number(config.totalRounds) || DEFAULT_TOTAL_ROUNDS;
    this.recordDuration = Number(config.recordDuration) || DEFAULT_RECORD_DURATION_SEC;
    if (config.gameMode) {
      this.gameMode = config.gameMode;
    }
    if (typeof config.targetPlayers === 'number' && config.targetPlayers >= 2) {
      this.targetPlayers = config.targetPlayers;
    } else if (this.gameMode === 'RACE_1V1') {
      this.targetPlayers = 2;
    }
  }

  addPlayer(
    socketId: string,
    userName: string,
    avatar: string,
    role: UserRole = 'PLAYER',
    userId: string | null = null,
    _isAuthenticated = false,
    isBot = false,
    botDifficulty: BotDifficulty | string | null = null
  ): { restored: boolean; totalScore: number } {
    if (!this.players.has(socketId)) {
      const isMidRound = !isBot && (
        this.state === GAME_STATES.USER_RECORDING ||
        this.state === GAME_STATES.UPLOADING_SOUND ||
        this.state === GAME_STATES.LISTENING_NOW_PLAYING ||
        this.state === GAME_STATES.SHOWDOWN_REVEAL ||
        this.state === GAME_STATES.AI_SCORING
      );
      this.players.set(socketId, {
        socketId,
        userId,
        userName,
        avatar: avatar || (isBot ? '🤖' : '🎧'),
        role,
        isBot: Boolean(isBot),
        botDifficulty: isBot ? normalizeBotDifficulty(botDifficulty) : null,
        totalScore: 0,
        isReady: isBot
          ? true
          : ((
            this.state === GAME_STATES.ROUND_RESULT ||
            this.state === GAME_STATES.BREAK_TIME ||
            this.state === GAME_STATES.GAME_OVER
          )
            ? false
            : (role === 'HOST')),
        roundScore: 0,
        currentAttempt: null,
        joinedMidRound: isMidRound
      });
    }
    return { restored: false, totalScore: 0 };
  }

  setHost(newHostSocketId: string): void {
    this.hostId = newHostSocketId;
    for (const [sId, p] of this.players.entries()) {
      p.role = (sId === newHostSocketId) ? 'HOST' : 'PLAYER';
      if ((p.role === 'HOST' || p.isBot) && this.state === GAME_STATES.IDLE) {
        p.isReady = true;
      }
    }
  }

  setPlayerReady(socketId: string, isReady: boolean): void {
    const p = this.players.get(socketId);
    if (p) {
      p.isReady = p.isBot ? true : isReady;
    }
  }

  updateConfig({ totalRounds, recordDuration, useCustomRecordDuration }: GameConfig): boolean {
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

  removePlayer(socketId: string): void {
    const leavingPlayer = this.players.get(socketId);
    if (leavingPlayer && leavingPlayer.userId) {
      this.disconnectedPlayers.delete(leavingPlayer.userId);
    }

    this.players.delete(socketId);
    this.showdownSkipVotes.delete(socketId);
    this.sampleDoneSockets.delete(socketId);

    if (
      this.state !== GAME_STATES.LISTENING_NOW_PLAYING &&
      this.state !== GAME_STATES.SHOWDOWN_REVEAL
    ) {
      this.audioStore.delete(socketId);
    }

    const humanPlayers = Array.from(this.players.values()).filter(p => !p.isBot);
    if (this.players.size === 0 || humanPlayers.length === 0) {
      this.stopTimer();
      this.clearRoundAudioData();
      this.state = GAME_STATES.IDLE;
      return;
    }

    // Cập nhật lại phân công gen Bot nếu người vừa thoát là người thật
    if (leavingPlayer && !leavingPlayer.isBot) {
      const updatedAssignments = this.getBotGenerationAssignments();
      if (this.currentPayload && Array.isArray(this.currentPayload.botAssignments)) {
        this.currentPayload.botAssignments = updatedAssignments;
      }
    }

    // Với chế độ 1vs1 Race: nếu 1 người chơi thoát giữa chừng khi trận đấu đang diễn ra -> Báo kết quả thắng cuộc (GAME_OVER) ngay lập tức!
    if (
      this.gameMode === 'RACE_1V1' &&
      this.state !== GAME_STATES.IDLE &&
      this.state !== GAME_STATES.GAME_OVER &&
      leavingPlayer &&
      !leavingPlayer.isBot
    ) {
      console.log(
        `[MimicGame:${this.roomId}] 🏁 Đối thủ ${leavingPlayer.userName} (${socketId}) đã thoát giữa trận 1vs1 Race ➔ Kết thúc trận & báo kết quả ngay!`
      );
      this.finishGame({
        reason: 'OPPONENT_LEFT_FORFEIT',
        forfeitedBySocketId: socketId,
        forfeitedByUserName: leavingPlayer.userName
      });
      return;
    }

    // Với Quick Match và Custom Room: nếu có người rời đi ngay lúc đang chờ 100% bấm Done ở SHOWDOWN_REVEAL / BREAK_TIME / GAME_OVER
    // thì kiểm tra lại: nếu những người còn lại đều đã bấm Done thì chuyển bước ngay để không bị kẹt phòng!
    if (this.state === GAME_STATES.SHOWDOWN_REVEAL || this.state === GAME_STATES.LISTENING_NOW_PLAYING) {
      for (const p of this.players.values()) {
        if (p.isBot) this.showdownSkipVotes.add(p.socketId);
      }
      if (this.players.size > 0 && this.showdownSkipVotes.size === this.players.size) {
        this.startAiScoringState();
      }
    } else if (this.state === GAME_STATES.BREAK_TIME) {
      const allRemainingReady = Array.from(this.players.values()).every(p => p.isBot || p.isReady);
      if (allRemainingReady) {
        this.startNextRound();
      }
    } else if (this.state === GAME_STATES.GAME_OVER && this.gameMode === 'CUSTOM_ROOM') {
      const allRemainingReady = Array.from(this.players.values()).every(p => p.isBot || p.isReady);
      if (allRemainingReady) {
        this.triggerNextStageAfterAllReady();
      }
    }
  }

  getStepMeta(state: GameStateType = this.state): {
    phaseStep: string;
    stepIndex: number;
    totalStepsInRound: number;
    nextState: GameStateType | null;
  } {
    const isLastRound = this.currentRound >= this.totalRounds;
    switch (state) {
      case GAME_STATES.THEME_SELECTION:
        return { phaseStep: '5.0', stepIndex: 1, totalStepsInRound: 9, nextState: GAME_STATES.PLAYING_SAMPLE };
      case GAME_STATES.PLAYING_SAMPLE:
        return { phaseStep: '5.1', stepIndex: 2, totalStepsInRound: 9, nextState: GAME_STATES.PREPARE_RECORDING };
      case GAME_STATES.PREPARE_RECORDING:
        return { phaseStep: '5.1b', stepIndex: 3, totalStepsInRound: 9, nextState: GAME_STATES.USER_RECORDING };
      case GAME_STATES.USER_RECORDING:
        return { phaseStep: '5.2', stepIndex: 4, totalStepsInRound: 9, nextState: GAME_STATES.UPLOADING_SOUND };
      case GAME_STATES.UPLOADING_SOUND:
        return { phaseStep: '5.3', stepIndex: 5, totalStepsInRound: 9, nextState: GAME_STATES.SHOWDOWN_REVEAL };
      case GAME_STATES.LISTENING_NOW_PLAYING:
        return { phaseStep: '5.4', stepIndex: 6, totalStepsInRound: 9, nextState: GAME_STATES.SHOWDOWN_REVEAL };
      case GAME_STATES.SHOWDOWN_REVEAL:
        return { phaseStep: '5.5', stepIndex: 6, totalStepsInRound: 9, nextState: GAME_STATES.AI_SCORING };
      case GAME_STATES.AI_SCORING:
        return { phaseStep: '5.6', stepIndex: 7, totalStepsInRound: 9, nextState: GAME_STATES.ROUND_RESULT };
      case GAME_STATES.ROUND_RESULT:
        return {
          phaseStep: '5.7',
          stepIndex: 8,
          totalStepsInRound: 9,
          nextState: isLastRound ? GAME_STATES.GAME_OVER : GAME_STATES.BREAK_TIME
        };
      case GAME_STATES.BREAK_TIME:
        return { phaseStep: '5.9', stepIndex: 9, totalStepsInRound: 9, nextState: GAME_STATES.THEME_SELECTION };
      case GAME_STATES.GAME_OVER:
        return { phaseStep: '5.10', stepIndex: 9, totalStepsInRound: 9, nextState: GAME_STATES.IDLE };
      default:
        return { phaseStep: '0.0', stepIndex: 0, totalStepsInRound: 9, nextState: GAME_STATES.THEME_SELECTION };
    }
  }

  getStepDurationsSnapshot(): Record<string, number> {
    const soundRef = this.targetSound ? (this.targetSound.relativePath || this.targetSound.fileName) : null;
    const rawSoundDur = soundRef ? getSoundDuration(soundRef) : this.recordDuration;
    const sampleDur = Math.max(2, Math.ceil(rawSoundDur));
    const recDur = (this.useCustomRecordDuration && this.customRecordDuration)
      ? this.customRecordDuration
      : Math.max(2, Math.ceil(rawSoundDur));
    return {
      themeSelection: GAME_STEP_DURATIONS.THEME_SELECTION,
      playingSample: sampleDur,
      prepareRecording: GAME_STEP_DURATIONS.PREPARE_RECORDING,
      userRecording: recDur,
      uploadingSound: GAME_STEP_DURATIONS.UPLOADING_SOUND,
      listeningNowPlaying: GAME_STEP_DURATIONS.LISTENING_NOW_PLAYING,
      showdownReveal: GAME_STEP_DURATIONS.SHOWDOWN_REVEAL,
      aiScoring: GAME_STEP_DURATIONS.AI_SCORING,
      roundResult: GAME_STEP_DURATIONS.ROUND_RESULT,
      breakTime: GAME_STEP_DURATIONS.BREAK_TIME,
      readyCountdown: GAME_STEP_DURATIONS.READY_COUNTDOWN
    };
  }

  transitionToState(
    nextState: GameStateType,
    durationSeconds: number,
    payload: Record<string, any> = {},
    onComplete: (() => void) | null = null
  ): void {
    this.stopTimer();
    this.state = nextState;
    this.currentDuration = durationSeconds;
    const totalTicks = Math.max(0, Math.ceil(durationSeconds));
    this.timeRemaining = totalTicks;
    this.stateStartedAt = Date.now();
    this.stateEndsAt = this.stateStartedAt + totalTicks * 1000;
    this.currentPayload = payload;

    const meta = this.getStepMeta(this.state);
    const isLastRound = this.currentRound >= this.totalRounds;
    const nextRound = isLastRound ? null : this.currentRound + 1;
    const stepDurations = this.getStepDurationsSnapshot();

    console.log(`[GameSession:${this.roomId}] 🔄 State => ${nextState} (${durationSeconds}s) - Vòng ${this.currentRound}/${this.totalRounds}`);

    this.io.to(this.roomId).emit('game_state_changed', {
      roomId: this.roomId,
      state: this.state,
      stateLabel: STATE_LABELS[this.state] || this.state,
      phaseStep: meta.phaseStep,
      stepIndex: meta.stepIndex,
      totalStepsInRound: meta.totalStepsInRound,
      nextState: meta.nextState,
      round: this.currentRound,
      totalRounds: this.totalRounds,
      isLastRound,
      nextRound,
      duration: this.currentDuration,
      totalDuration: totalTicks,
      timeRemaining: this.timeRemaining,
      elapsedSeconds: 0,
      remainingMs: this.timeRemaining * 1000,
      progressPercent: 0,
      stateStartedAt: this.stateStartedAt,
      stateEndsAt: this.stateEndsAt,
      stepDurations,
      timestamp: this.stateStartedAt,
      payload: this.currentPayload
    });

    if (durationSeconds > 0 && totalTicks > 0) {
      this.timer = setInterval(() => {
        this.timeRemaining = Math.max(0, this.timeRemaining - 1);
        const elapsedSeconds = Math.max(0, totalTicks - this.timeRemaining);
        const progressPercent = Math.max(
          0,
          Math.min(100, Math.round((elapsedSeconds / totalTicks) * 100))
        );

        let spotlightIndex: number | undefined;
        let spotlightPlayer: Record<string, any> | null | undefined;
        if (
          (this.state === GAME_STATES.LISTENING_NOW_PLAYING || this.state === GAME_STATES.SHOWDOWN_REVEAL) &&
          Array.isArray(this.currentPayload?.attempts) &&
          this.currentPayload.attempts.length > 0
        ) {
          const attempts = this.currentPayload.attempts;
          spotlightIndex = Math.min(
            attempts.length - 1,
            Math.floor((elapsedSeconds / Math.max(1, totalTicks)) * attempts.length)
          );
          spotlightPlayer = attempts[spotlightIndex] || attempts[0] || null;
        }

        this.io.to(this.roomId).emit('game_state_tick', {
          roomId: this.roomId,
          state: this.state,
          stateLabel: STATE_LABELS[this.state] || this.state,
          phaseStep: meta.phaseStep,
          stepIndex: meta.stepIndex,
          totalStepsInRound: meta.totalStepsInRound,
          nextState: meta.nextState,
          round: this.currentRound,
          totalRounds: this.totalRounds,
          isLastRound,
          nextRound,
          timeRemaining: this.timeRemaining,
          elapsedSeconds,
          totalDuration: totalTicks,
          remainingMs: this.timeRemaining * 1000,
          progressPercent,
          stateStartedAt: this.stateStartedAt,
          stateEndsAt: this.stateEndsAt,
          ...(typeof spotlightIndex === 'number' ? { spotlightIndex, spotlightPlayer } : {}),
          timestamp: Date.now()
        });

        if (this.timeRemaining <= 0) {
          this.stopTimer();
          if (onComplete) onComplete();
        }
      }, 1000);
    }
  }

  getStateSnapshot(): Record<string, unknown> {
    const meta = this.getStepMeta(this.state);
    const totalTicks = Math.max(0, Math.ceil(this.currentDuration));
    const elapsedSeconds = Math.max(0, totalTicks - this.timeRemaining);
    const progressPercent = totalTicks > 0
      ? Math.max(0, Math.min(100, Math.round((elapsedSeconds / totalTicks) * 100)))
      : 0;
    const isLastRound = this.currentRound >= this.totalRounds;

    return {
      roomId: this.roomId,
      hostId: this.hostId,
      state: this.state,
      stateLabel: STATE_LABELS[this.state] || this.state,
      phaseStep: meta.phaseStep,
      stepIndex: meta.stepIndex,
      totalStepsInRound: meta.totalStepsInRound,
      nextState: meta.nextState,
      round: this.currentRound,
      totalRounds: this.totalRounds,
      isLastRound,
      nextRound: isLastRound ? null : this.currentRound + 1,
      recordDuration: this.recordDuration,
      duration: this.currentDuration,
      totalDuration: totalTicks,
      timeRemaining: this.timeRemaining,
      elapsedSeconds,
      remainingMs: this.timeRemaining * 1000,
      progressPercent,
      stateStartedAt: this.stateStartedAt,
      stateEndsAt: this.stateEndsAt,
      stepDurations: this.getStepDurationsSnapshot(),
      selectedPack: this.selectedPack,
      targetSound: this.targetSound,
      payload: this.currentPayload,
      players: Array.from(this.players.values()).map(p => ({
        socketId: p.socketId,
        userName: p.userName,
        avatar: p.avatar,
        role: p.role || (p.socketId === this.hostId ? 'HOST' : 'PLAYER'),
        isBot: Boolean(p.isBot),
        botDifficulty: p.botDifficulty || null,
        isReady: p.isBot || p.isReady || (this.state === GAME_STATES.IDLE && p.role === 'HOST'),
        totalScore: p.totalScore,
        roundScore: p.roundScore
      }))
    };
  }

  startGame(options: { requireAllReady?: boolean } = {}): boolean {
    if (this.state !== GAME_STATES.IDLE && this.state !== GAME_STATES.GAME_OVER) return false;
    if (this.players.size === 0) return false;

    if (options.requireAllReady) {
      const unready = Array.from(this.players.values()).filter(
        p => !p.isBot && p.role !== 'HOST' && !p.isReady
      );
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

  startNextRound(): void {
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

    const chosenPack = candidatePacks[Math.floor(Math.random() * candidatePacks.length)] || {
      ...SOUND_PACKS[0],
      existingSounds: SOUND_PACKS[0].sounds,
      unusedSounds: SOUND_PACKS[0].sounds
    };
    this.selectedPack = SOUND_PACKS.find(p => p.id === chosenPack.id) || SOUND_PACKS[0];

    const pool = chosenPack.unusedSounds || chosenPack.sounds;
    this.targetSound = pool[Math.floor(Math.random() * pool.length)] || this.selectedPack.sounds[0];
    if (this.targetSound && this.targetSound.id) {
      this.usedSoundIds.add(this.targetSound.id);
    }

    const sound = this.targetSound || SOUND_PACKS[0].sounds[0];
    const soundRef = sound.relativePath || sound.fileName;
    const rawDuration = getSoundDuration(soundRef);
    const playDuration = Math.max(2, Math.ceil(rawDuration));
    const audioUrl = this.getTargetSoundUrl(sound);

    // Pre-Recording Staggered Queue: Khởi tạo sẵn công thức DSP & phân công Quota 1:1 ngay từ bước 5.0 THEME_SELECTION
    // giúp Client có trọn vẹn ~10s rảnh rỗi (5.0 + 5.1 + 5.1b) để chuẩn bị/gen 1 Bot trong background trước khi mở Mic
    this.simulateAllBotsAttempts();
    const botAssignments = this.getBotGenerationAssignments();

    this.transitionToState(
      GAME_STATES.THEME_SELECTION,
      GAME_STEP_DURATIONS.THEME_SELECTION,
      {
        phaseStep: '5.0',
        selectedPack: {
          id: this.selectedPack.id,
          name: this.selectedPack.name,
          emoji: this.selectedPack.emoji,
          description: this.selectedPack.description
        },
        targetSound: {
          id: sound.id,
          name: sound.name,
          emoji: sound.emoji,
          hint: sound.hint,
          audioUrl,
          rawDuration,
          exactDuration: rawDuration,
          duration: playDuration
        },
        botAssignments,
        maxBotsPerClient: MAX_BOTS_PER_CLIENT_PER_ROUND,
        allPacks: SOUND_PACKS.map(p => ({ id: p.id, name: p.name, emoji: p.emoji }))
      },
      () => this.startPlaySampleState()
    );
  }

  getTargetSoundUrl(sound: SoundPackSound | null): string {
    if (!sound) return '';
    const resolved = resolveSoundFile(sound.relativePath || sound.fileName);
    if (resolved) return resolved.url;
    return getSoundUrl(sound.relativePath || sound.fileName);
  }

  startPlaySampleState(): void {
    const sound = this.targetSound || SOUND_PACKS[0].sounds[0];
    const pack = this.selectedPack || SOUND_PACKS[0];
    const soundRef = sound.relativePath || sound.fileName;
    const rawDuration = getSoundDuration(soundRef);
    const playDuration = Math.max(2, Math.ceil(rawDuration));
    const audioUrl = this.getTargetSoundUrl(sound);

    this.sampleFinishedHandled = false;
    this.sampleDoneSockets.clear();
    for (const p of this.players.values()) {
      if (p.isBot) {
        this.sampleDoneSockets.add(p.socketId);
      }
    }
    this.sampleStartTime = Date.now();

    this.simulateAllBotsAttempts();
    const botAssignments = this.getBotGenerationAssignments();

    console.log(`[MimicGame:${this.roomId}] 🔊 Phát âm thanh mẫu: ${sound.name} (Độ dài: ${rawDuration}s | Timer: ${playDuration}s)`);

    this.transitionToState(
      GAME_STATES.PLAYING_SAMPLE,
      playDuration,
      {
        phaseStep: '5.1',
        pack: {
          id: pack.id,
          name: pack.name,
          emoji: pack.emoji
        },
        targetSound: {
          id: sound.id,
          name: sound.name,
          emoji: sound.emoji,
          hint: sound.hint,
          audioUrl,
          rawDuration,
          exactDuration: rawDuration,
          duration: playDuration
        },
        botAssignments,
        maxBotsPerClient: MAX_BOTS_PER_CLIENT_PER_ROUND
      },
      () => {
        if (!this.sampleFinishedHandled) {
          this.sampleFinishedHandled = true;
          this.startPrepareRecordingState(rawDuration);
        }
      }
    );
  }

  handleSamplePlaybackDone(socketId: string): void {
    if (this.state !== GAME_STATES.PLAYING_SAMPLE || this.sampleFinishedHandled) return;
    if (!this.players.has(socketId)) return;

    for (const p of this.players.values()) {
      if (p.isBot) {
        this.sampleDoneSockets.add(p.socketId);
      }
    }
    this.sampleDoneSockets.add(socketId);
    // Không nhảy sớm — giữ đúng 100% thời lượng PLAYING_SAMPLE do Server quyết định
  }

  startPrepareRecordingState(recordingDuration?: number): void {
    const sound = this.targetSound || SOUND_PACKS[0].sounds[0];
    const soundRef = sound.relativePath || sound.fileName;
    const rawDuration = getSoundDuration(soundRef);
    const exactDuration = (this.useCustomRecordDuration && this.customRecordDuration)
      ? this.customRecordDuration
      : ((typeof recordingDuration === 'number' && recordingDuration > 0) ? recordingDuration : rawDuration);
    const roundedDuration = Math.max(2, Math.ceil(exactDuration));
    const audioUrl = this.getTargetSoundUrl(sound);
    const prepDuration = GAME_STEP_DURATIONS.PREPARE_RECORDING;

    this.simulateAllBotsAttempts();
    const botAssignments = this.getBotGenerationAssignments();

    console.log(`[MimicGame:${this.roomId}] 🧘 Chuẩn bị lấy hơi & bật micro (${prepDuration}s đệm) -> Thời gian nhại: ${exactDuration}s`);

    this.transitionToState(
      GAME_STATES.PREPARE_RECORDING,
      prepDuration,
      {
        phaseStep: '5.1b',
        targetSound: {
          id: sound.id,
          name: sound.name,
          emoji: sound.emoji,
          hint: sound.hint,
          audioUrl,
          rawDuration: exactDuration,
          exactDuration,
          duration: roundedDuration
        },
        botAssignments,
        maxBotsPerClient: MAX_BOTS_PER_CLIENT_PER_ROUND,
        exactDuration,
        recordingDuration: roundedDuration,
        message: GameMessageCode.GAME_MSG_PREPARE_RECORDING,
        messageCode: GameMessageCode.GAME_MSG_PREPARE_RECORDING,
        messageParams: { countdown: prepDuration }
      },
      () => this.startUserRecordingState(exactDuration)
    );
  }

  /**
   * Lấy danh sách người chơi thật (Human) đang hoạt động trong phòng để chia đều (Round-Robin) việc tạo âm thanh cho Bot
   */
  getActiveHumanPlayers(): GamePlayer[] {
    const allHumans = Array.from(this.players.values()).filter(p => !p.isBot);
    const activeInRound = allHumans.filter(p => !p.joinedMidRound);
    return activeInRound.length > 0 ? activeInRound : allHumans;
  }

  /**
   * Lấy danh sách phân công máy người thật nào chịu trách nhiệm render âm thanh cho Bot nào trong vòng hiện tại
   * Áp dụng giới hạn cứng Quota 1:1 (`MAX_BOTS_PER_CLIENT_PER_ROUND = 1`):
   * - Mỗi Client người thật chỉ phải render & upload tối đa 1 Bot/vòng (`generationMode = 'CLIENT_UPLOAD'`).
   * - Nếu phòng có nhiều Bot hơn số người thật (VD: 1 người + 3 Bot), các Bot vượt hạn mức tự động chuyển sang
   *   `generationMode = 'LIVE_PLAYBACK_DSP'` (`assignedGeneratorSocketId = null`, `requiresClientUpload = false`)
   *   để Client chỉ áp pitch/speed trực tiếp lúc phát ở màn 5.5 mà không bị quá tải render/upload.
   */
  getBotGenerationAssignments(): Array<{
    botSocketId: string;
    botName: string;
    botDifficulty: BotDifficulty | null;
    assignedGeneratorSocketId: string | null;
    assignedGeneratorUserName: string | null;
    generationMode: BotGenerationMode;
    requiresClientUpload: boolean;
    botAudioEffects: Record<string, any> | null;
  }> {
    const humans = this.getActiveHumanPlayers();
    const humanIds = new Set(humans.map(h => h.socketId));
    const bots = Array.from(this.players.values()).filter(p => p.isBot);
    const roundOffset = Math.max(0, this.currentRound - 1);

    const assignedCountByHuman = new Map<string, number>();

    // Pass 1: Giữ nguyên phân công hợp lệ hiện tại nếu người chơi thật đó vẫn còn trong phòng và chưa vượt quá trần Quota 1:1
    for (const bot of bots) {
      const att = bot.currentAttempt;
      if (!att) continue;
      const existingId = att.assignedGeneratorSocketId;
      if (existingId && humanIds.has(existingId)) {
        const currentCount = assignedCountByHuman.get(existingId) || 0;
        if (currentCount < MAX_BOTS_PER_CLIENT_PER_ROUND) {
          assignedCountByHuman.set(existingId, currentCount + 1);
          att.generationMode = 'CLIENT_UPLOAD';
          att.requiresClientUpload = true;
          if (att.botAudioEffects) {
            att.botAudioEffects.assignedGeneratorSocketId = existingId;
            att.botAudioEffects.generationMode = 'CLIENT_UPLOAD';
            att.botAudioEffects.requiresClientUpload = true;
          }
          continue;
        }
      }
      // Nếu người được phân công đã thoát hoặc vượt quá hạn mức 1:1 -> Reset để Pass 2 phân bổ lại
      att.assignedGeneratorSocketId = null;
    }

    // Pass 2: Phân bổ các Bot chưa có người nhận theo thứ tự xoay vòng Round-Robin (tối đa MAX_BOTS_PER_CLIENT_PER_ROUND mỗi người thật)
    if (bots.length > 0) {
      for (let step = 0; step < bots.length; step++) {
        const botIdx = (step + roundOffset) % bots.length;
        const bot = bots[botIdx];
        const att = bot.currentAttempt;
        if (!att || att.assignedGeneratorSocketId) continue;

        let chosenHuman: GamePlayer | null = null;
        if (humans.length > 0) {
          for (let hStep = 0; hStep < humans.length; hStep++) {
            const candidate = humans[(botIdx + roundOffset + hStep) % humans.length];
            const count = assignedCountByHuman.get(candidate.socketId) || 0;
            if (count < MAX_BOTS_PER_CLIENT_PER_ROUND) {
              chosenHuman = candidate;
              break;
            }
          }
        }

        if (chosenHuman) {
          const assignedId = chosenHuman.socketId;
          assignedCountByHuman.set(assignedId, (assignedCountByHuman.get(assignedId) || 0) + 1);
          att.assignedGeneratorSocketId = assignedId;
          att.generationMode = 'CLIENT_UPLOAD';
          att.requiresClientUpload = true;
          if (att.botAudioEffects) {
            att.botAudioEffects.assignedGeneratorSocketId = assignedId;
            att.botAudioEffects.generationMode = 'CLIENT_UPLOAD';
            att.botAudioEffects.requiresClientUpload = true;
          }
        } else {
          // Vượt quá hạn mức Quota 1:1 -> Chuyển sang chế độ Live Playback DSP (0 upload, phát trực tiếp tại màn 5.5)
          att.assignedGeneratorSocketId = null;
          att.generationMode = 'LIVE_PLAYBACK_DSP';
          att.requiresClientUpload = false;
          if (att.botAudioEffects) {
            att.botAudioEffects.assignedGeneratorSocketId = null;
            att.botAudioEffects.generationMode = 'LIVE_PLAYBACK_DSP';
            att.botAudioEffects.requiresClientUpload = false;
          }
        }
      }
    }

    return bots.map(p => {
      const assignedId = p.currentAttempt?.assignedGeneratorSocketId || null;
      const assignedPlayer = assignedId ? this.players.get(assignedId) : null;
      const generationMode: BotGenerationMode =
        p.currentAttempt?.generationMode || (assignedId ? 'CLIENT_UPLOAD' : 'LIVE_PLAYBACK_DSP');
      const requiresClientUpload = Boolean(assignedId && generationMode === 'CLIENT_UPLOAD');

      return {
        botSocketId: p.socketId,
        botName: p.userName,
        botDifficulty: p.botDifficulty || null,
        assignedGeneratorSocketId: assignedId,
        assignedGeneratorUserName: assignedPlayer ? assignedPlayer.userName : null,
        generationMode,
        requiresClientUpload,
        botAudioEffects: (p.currentAttempt?.botAudioEffects as Record<string, any>) || null
      };
    });
  }

  /**
   * Mô phỏng bài dự thi nhại âm cho AI Bot dựa trên 3 mode độ khó (EASY: Yếu / NORMAL: Thông thường / HARD: Khó)
   * Theo Kiến trúc Client-Side Bot DSP + Quota 1:1 Hybrid Fallback:
   * - Server tính toán tức thì bộ thông số `botAudioEffects` từ `targetSound` gốc và chấm điểm qua `evaluateMimicAttempt`.
   * - Mỗi máy người thật chỉ phải phụ trách tối đa `MAX_BOTS_PER_CLIENT_PER_ROUND` (1 Bot/vòng).
   * - Các Bot dư ra vượt quá số người thật sẽ tự động đánh dấu `LIVE_PLAYBACK_DSP` (`requiresClientUpload = false`).
   */
  simulateBotAttempt(
    bot: GamePlayer,
    _excludeRelativePaths: Set<string> = new Set(),
    botIndex = 0
  ): EvaluationResult {
    const difficulty = normalizeBotDifficulty(bot.botDifficulty);
    bot.botDifficulty = difficulty;

    const baseSound = this.targetSound || SOUND_PACKS[0].sounds[0];
    const basePackId = (this.selectedPack && this.selectedPack.id) || SOUND_PACKS[0].id;
    const soundRef = baseSound.relativePath || baseSound.fileName;
    const seed =
      (botIndex + 1) * 37 +
      this.currentRound * 53 +
      Array.from(bot.socketId).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

    const transformed = transformTargetSoundForBot(
      soundRef,
      basePackId,
      difficulty,
      seed
    );

    // Chấm điểm bằng chính hàm evaluateMimicAttempt như 1 user thông thường (0 byte cấp phát RAM)
    const evaluation = this.evaluateMimicAttempt('__BOT_CLIENT_DSP__', transformed.metrics);

    bot.roundScore = evaluation.totalScore;
    bot.totalScore += evaluation.totalScore;
    bot.currentAttempt = {
      audioUrl: transformed.clientPlaybackUrl,
      audioStreamUrl: transformed.effects.baseSoundUrl,
      mimeType: transformed.mimeType,
      botSoundId: transformed.sound.id,
      botSoundFileName: transformed.sound.fileName,
      botPitch: transformed.pitch,
      botSpeed: transformed.speed,
      botAudioEffects: transformed.effects,
      assignedGeneratorSocketId: null,
      generationMode: 'LIVE_PLAYBACK_DSP',
      requiresClientUpload: false,
      evaluation,
      submittedAt: Date.now()
    };

    return evaluation;
  }

  simulateAllBotsAttempts(): void {
    let idx = 0;
    let newlySimulated = false;
    for (const player of this.players.values()) {
      if (player.isBot) {
        if (player.currentAttempt === null) {
          this.simulateBotAttempt(player, new Set(), idx);
          newlySimulated = true;
        }
        idx++;
      }
    }
    if (idx > 0) {
      const assignments = this.getBotGenerationAssignments();
      if (newlySimulated) {
        for (const a of assignments) {
          const b = this.players.get(a.botSocketId);
          console.log(
            `[MimicGame:${this.roomId}] 🤖 ${a.botName} (${a.botDifficulty}) recipe ready [mode=${a.generationMode}, assignedTo=${a.assignedGeneratorSocketId || 'none (live DSP)'}]: ${b?.roundScore ?? 0}đ`
          );
        }
      }
    }
  }

  startUserRecordingState(customDuration: number | null = null): void {
    const sound = this.targetSound || SOUND_PACKS[0].sounds[0];
    const soundRef = sound.relativePath || sound.fileName;
    const rawDuration = getSoundDuration(soundRef);
    const exactDuration = (typeof customDuration === 'number' && customDuration > 0) ? customDuration : rawDuration;
    const duration = Math.max(2, Math.ceil(exactDuration));
    const audioUrl = this.getTargetSoundUrl(sound);

    console.log(`[MimicGame:${this.roomId}] 🎙️ Tới lượt user nhại lại - Thời gian nhại: ${exactDuration}s (Timer: ${duration}s)`);

    // Tự động sinh công thức DSP & chia Quota 1:1 người phụ trách cho AI Bots trong phòng
    this.simulateAllBotsAttempts();
    const botAssignments = this.getBotGenerationAssignments();

    this.transitionToState(
      GAME_STATES.USER_RECORDING,
      duration,
      {
        phaseStep: '5.2',
        targetSound: {
          id: sound.id,
          name: sound.name,
          emoji: sound.emoji,
          hint: sound.hint,
          audioUrl,
          rawDuration: exactDuration,
          exactDuration,
          duration
        },
        botAssignments,
        maxBotsPerClient: MAX_BOTS_PER_CLIENT_PER_ROUND,
        exactDuration,
        duration,
        message: GameMessageCode.GAME_MSG_USER_RECORDING,
        messageCode: GameMessageCode.GAME_MSG_USER_RECORDING,
        messageParams: { duration }
      },
      () => this.startUploadingSoundState()
    );
  }

  /**
   * Cho phép máy Client được phân công (`assignedGeneratorSocketId` hoặc Host) nộp bản audio đã render của Bot
   * (hoặc chỉ gửi `metrics` nhẹ < 200 bytes) ngay từ các bước chuẩn bị 5.0 / 5.1 / 5.1b / 5.2 / 5.3
   * và CHẤM ĐIỂM THỰC TẾ TRÊN SERVER (cập nhật lại điểm của Bot trong vòng hiện tại).
   */
  submitBotAudio(
    requesterSocketId: string,
    botSocketId: string,
    audioBase64?: string | null,
    mimeType = 'audio/wav',
    clientMetrics: ClientMetrics | null = null
  ): {
    success: boolean;
    code?: ErrorCode;
    message?: ErrorCode;
    botSocketId?: string;
    uploadedBy?: string;
    assignedGeneratorSocketId?: string | null;
    generationMode?: BotGenerationMode;
    audioUrl?: string;
    evaluation?: EvaluationResult;
  } {
    if (
      this.state !== GAME_STATES.THEME_SELECTION &&
      this.state !== GAME_STATES.PLAYING_SAMPLE &&
      this.state !== GAME_STATES.PREPARE_RECORDING &&
      this.state !== GAME_STATES.USER_RECORDING &&
      this.state !== GAME_STATES.UPLOADING_SOUND &&
      this.state !== GAME_STATES.LISTENING_NOW_PLAYING &&
      this.state !== GAME_STATES.SHOWDOWN_REVEAL &&
      this.state !== GAME_STATES.AI_SCORING
    ) {
      return {
        success: false,
        code: ErrorCode.GAME_NOT_IN_RECORDING_PHASE,
        message: ErrorCode.GAME_NOT_IN_RECORDING_PHASE
      };
    }

    const requester = this.players.get(requesterSocketId);
    const bot = this.players.get(botSocketId);
    if (!requester || !bot || !bot.isBot) {
      return {
        success: false,
        code: ErrorCode.PLAYER_NOT_IN_ROOM,
        message: ErrorCode.PLAYER_NOT_IN_ROOM
      };
    }

    if (!bot.currentAttempt) {
      this.simulateAllBotsAttempts();
    }

    const assignedId = bot.currentAttempt?.assignedGeneratorSocketId;
    if (assignedId) {
      // Nếu người được phân công vẫn còn trong phòng thì chỉ nhận từ đúng người đó hoặc Host
      if (assignedId !== requesterSocketId && requesterSocketId !== this.hostId && this.players.has(assignedId)) {
        return {
          success: false,
          code: ErrorCode.GAME_HOST_ONLY_CONFIG,
          message: ErrorCode.GAME_HOST_ONLY_CONFIG
        };
      }
    } else if (requesterSocketId !== this.hostId) {
      // Nếu Bot đang ở chế độ LIVE_PLAYBACK_DSP (không phân công cho ai), chỉ Host mới được phép ghi đè nếu cần
      return {
        success: false,
        code: ErrorCode.GAME_HOST_ONLY_CONFIG,
        message: ErrorCode.GAME_HOST_ONLY_CONFIG
      };
    }

    if (audioBase64 && typeof audioBase64 === 'string') {
      // Bảo vệ RAM Server & băng thông: kiểm tra kích thước ước tính TRƯỚC khi cấp phát Buffer C++
      const { buffer: buf, estimatedBytes, exceededMaxBytes } = decodeBoundedBase64Audio(
        audioBase64,
        MAX_BOT_AUDIO_UPLOAD_BYTES
      );
      if (buf && buf.length > 0) {
        this.audioStore.set(botSocketId, {
          buffer: buf,
          mimeType: mimeType || 'audio/wav',
          updatedAt: Date.now()
        });
        const streamUrl = `/api/attempts/${encodeURIComponent(this.roomId)}/${encodeURIComponent(botSocketId)}?r=${this.currentRound}`;
        const resolvedUrl = `${streamUrl}&t=${Date.now()}`;

        // Chấm điểm thực tế trên Server cho bản sound của Bot vừa được Client gen và upload lên (tái sử dụng trực tiếp buf đã decode)!
        const evaluation = this.evaluateMimicAttempt(audioBase64, clientMetrics, buf);
        const oldRoundScore = bot.roundScore || 0;
        bot.roundScore = evaluation.totalScore;
        bot.totalScore = Math.max(0, bot.totalScore - oldRoundScore) + evaluation.totalScore;

        if (bot.currentAttempt) {
          bot.currentAttempt.audioUrl = resolvedUrl;
          bot.currentAttempt.audioStreamUrl = streamUrl;
          bot.currentAttempt.mimeType = mimeType || 'audio/wav';
          bot.currentAttempt.botAudioUploaded = true;
          bot.currentAttempt.generationMode = 'CLIENT_UPLOAD';
          bot.currentAttempt.requiresClientUpload = true;
          if (bot.currentAttempt.botAudioEffects) {
            bot.currentAttempt.botAudioEffects.generationMode = 'CLIENT_UPLOAD';
            bot.currentAttempt.botAudioEffects.requiresClientUpload = true;
          }
          bot.currentAttempt.evaluation = evaluation;
          bot.currentAttempt.submittedAt = Date.now();
        }

        console.log(
          `[MimicGame:${this.roomId}] 🤖🎯 Bot ${bot.userName} (${botSocketId}) đã nhận audio từ Client ${requester.userName} & chấm điểm trên Server: ${evaluation.totalScore}đ (${evaluation.grade})`
        );

        // Nếu đang ở pha nghe lại (SHOWDOWN_REVEAL / LISTENING_NOW_PLAYING), cập nhật lại danh sách attempts cho cả phòng
        if (
          this.state === GAME_STATES.SHOWDOWN_REVEAL ||
          this.state === GAME_STATES.LISTENING_NOW_PLAYING
        ) {
          const updatedAttempts = this.ensureAllPlayerAttempts();
          if (this.currentPayload) {
            this.currentPayload.attempts = updatedAttempts;
            this.currentPayload.roundWinner = updatedAttempts[0] || null;
          }
          this.io.to(this.roomId).emit('bot_audio_synced', {
            roomId: this.roomId,
            botSocketId,
            botName: bot.userName,
            uploadedBy: requesterSocketId,
            audioUrl: resolvedUrl,
            audioStreamUrl: streamUrl,
            evaluation,
            attempts: updatedAttempts
          });
        }

        return {
          success: true,
          botSocketId,
          uploadedBy: requesterSocketId,
          assignedGeneratorSocketId: assignedId || requesterSocketId,
          generationMode: bot.currentAttempt?.generationMode || 'CLIENT_UPLOAD',
          audioUrl: resolvedUrl,
          evaluation
        };
      } else if (exceededMaxBytes) {
        console.warn(
          `[MimicGame:${this.roomId}] ⚠️ Audio upload cho Bot ${bot.userName} (${botSocketId}) vượt giới hạn (~${estimatedBytes} > ${MAX_BOT_AUDIO_UPLOAD_BYTES} bytes) -> Hạ xuống LIVE_PLAYBACK_DSP`
        );
      }
    }

    // Nếu không có audio hợp lệ được lưu vào audioStore -> Đảm bảo Bot chuyển sang LIVE_PLAYBACK_DSP để bước 5.5 phát trực tiếp từ sound gốc
    if (bot.currentAttempt && !bot.currentAttempt.botAudioUploaded) {
      bot.currentAttempt.generationMode = 'LIVE_PLAYBACK_DSP';
      bot.currentAttempt.requiresClientUpload = false;
      if (bot.currentAttempt.botAudioEffects) {
        bot.currentAttempt.botAudioEffects.generationMode = 'LIVE_PLAYBACK_DSP';
        bot.currentAttempt.botAudioEffects.requiresClientUpload = false;
      }
    }

    // Trường hợp Client máy yếu / mạng chậm chỉ gửi metrics nhẹ (< 200 bytes) mà không gửi kèm audioBase64
    if (clientMetrics && typeof clientMetrics === 'object') {
      const evaluation = this.evaluateMimicAttempt('__BOT_CLIENT_DSP__', clientMetrics);
      const oldRoundScore = bot.roundScore || 0;
      bot.roundScore = evaluation.totalScore;
      bot.totalScore = Math.max(0, bot.totalScore - oldRoundScore) + evaluation.totalScore;
      if (bot.currentAttempt) {
        bot.currentAttempt.evaluation = evaluation;
      }
    }

    return {
      success: true,
      botSocketId,
      uploadedBy: requesterSocketId,
      assignedGeneratorSocketId: assignedId || requesterSocketId,
      generationMode: bot.currentAttempt?.generationMode || 'LIVE_PLAYBACK_DSP',
      audioUrl: bot.currentAttempt?.audioUrl || undefined,
      evaluation: bot.currentAttempt?.evaluation
    };
  }

  submitMimicAudio(
    socketId: string,
    audioBase64?: string | null,
    mimeType = 'audio/webm',
    clientMetrics: ClientMetrics | null = null
  ): { success: boolean; code?: ErrorCode; message?: ErrorCode; evaluation?: EvaluationResult } {
    if (
      this.state !== GAME_STATES.USER_RECORDING &&
      this.state !== GAME_STATES.UPLOADING_SOUND &&
      this.state !== GAME_STATES.LISTENING_NOW_PLAYING &&
      this.state !== GAME_STATES.SHOWDOWN_REVEAL &&
      this.state !== GAME_STATES.AI_SCORING
    ) {
      return {
        success: false,
        code: ErrorCode.GAME_NOT_IN_RECORDING_PHASE,
        message: ErrorCode.GAME_NOT_IN_RECORDING_PHASE
      };
    }

    const player = this.players.get(socketId);
    if (!player) {
      return {
        success: false,
        code: ErrorCode.PLAYER_NOT_IN_ROOM,
        message: ErrorCode.PLAYER_NOT_IN_ROOM
      };
    }

    // Chặn nộp trùng lặp nếu người chơi đã nộp bài thực sự trong vòng này
    // (Nếu currentAttempt chỉ là bản ghi khuyết audioUrl === null do gói tin upload tới trễ vào đầu SHOWDOWN_REVEAL thì vẫn cho phép cập nhật!)
    if (player.currentAttempt !== null && player.currentAttempt.audioUrl !== null) {
      console.warn(`[MimicGame:${this.roomId}] ⚠️ Chặn ${player.userName} nộp bài trùng lặp trong vòng ${this.currentRound}`);
      return {
        success: false,
        code: ErrorCode.GAME_ALREADY_SUBMITTED_THIS_ROUND,
        message: ErrorCode.GAME_ALREADY_SUBMITTED_THIS_ROUND
      };
    }

    let resolvedAudioUrl: string | null = audioBase64 || null;
    let decodedBuf: Buffer | null = null;
    const streamUrl = `/api/attempts/${encodeURIComponent(this.roomId)}/${encodeURIComponent(socketId)}?r=${this.currentRound}`;
    if (audioBase64 && typeof audioBase64 === 'string') {
      const { buffer: buf, estimatedBytes, exceededMaxBytes } = decodeBoundedBase64Audio(
        audioBase64,
        MAX_USER_AUDIO_UPLOAD_BYTES
      );
      if (buf && buf.length > 0) {
        decodedBuf = buf;
        this.audioStore.set(socketId, {
          buffer: buf,
          mimeType: mimeType || 'audio/webm',
          updatedAt: Date.now()
        });
        if (audioBase64.length > 4096) {
          resolvedAudioUrl = `${streamUrl}&t=${Date.now()}`;
        }
      } else if (exceededMaxBytes) {
        console.warn(
          `[MimicGame:${this.roomId}] ⚠️ Audio người chơi ${player.userName} vượt trần (~${estimatedBytes} bytes > ${MAX_USER_AUDIO_UPLOAD_BYTES} bytes) -> Bỏ lưu audioStore để bảo vệ RAM`
        );
        resolvedAudioUrl = null;
      }
    }

    const evaluation = this.evaluateMimicAttempt(audioBase64, clientMetrics, decodedBuf);

    const oldRoundScore = player.roundScore || 0;
    player.roundScore = evaluation.totalScore;
    player.totalScore = Math.max(0, player.totalScore - oldRoundScore) + evaluation.totalScore;
    player.currentAttempt = {
      audioUrl: resolvedAudioUrl,
      audioStreamUrl: streamUrl,
      mimeType,
      evaluation,
      submittedAt: Date.now()
    };

    console.log(`[MimicGame:${this.roomId}] 🎯 ${player.userName} nộp bài nhại: ${evaluation.totalScore}đ (${evaluation.grade})`);

    // Đảm bảo mọi AI Bot đều đã có bài nộp trong vòng hiện tại
    this.simulateAllBotsAttempts();

    // Nếu gói upload của User tới trễ đúng lúc vừa vào SHOWDOWN_REVEAL, cập nhật ngay danh sách attempts cho cả phòng
    if (
      this.state === GAME_STATES.SHOWDOWN_REVEAL ||
      this.state === GAME_STATES.LISTENING_NOW_PLAYING
    ) {
      const updatedAttempts = this.ensureAllPlayerAttempts();
      if (this.currentPayload) {
        this.currentPayload.attempts = updatedAttempts;
        this.currentPayload.roundWinner = updatedAttempts[0] || null;
      }
      this.io.to(this.roomId).emit('attempts_updated', {
        roomId: this.roomId,
        socketId,
        userName: player.userName,
        audioUrl: resolvedAudioUrl,
        audioStreamUrl: streamUrl,
        evaluation,
        attempts: updatedAttempts
      });
    }

    // Không tự động nhảy sớm khi nộp đủ — giữ 100% thời lượng USER_RECORDING theo đúng Timer của Server
    return { success: true, evaluation };
  }

  getAttemptAudio(socketId: string): AudioStoreRecord | null {
    return this.audioStore.get(socketId) || null;
  }

  private ensureAllPlayerAttempts(): Array<Record<string, any>> {
    this.simulateAllBotsAttempts();
    // Cập nhật lại phân công nếu có người chơi thật vừa thoát giữa chừng
    this.getBotGenerationAssignments();

    for (const player of this.players.values()) {
      if (!player.currentAttempt) {
        player.currentAttempt = {
          audioUrl: null,
          evaluation: {
            totalScore: 0,
            pitchScore: 0,
            melodyScore: 0,
            rhythmScore: 0,
            energyScore: 0,
            attackScore: 0,
            grade: 'F',
            remark: AiRemarkCode.AI_REMARK_MISSED_RECORDING
          }
        };
      }
    }

    return Array.from(this.players.values()).map(p => ({
      socketId: p.socketId,
      userName: p.userName,
      avatar: p.avatar,
      isBot: Boolean(p.isBot),
      botDifficulty: p.botDifficulty || null,
      botAudioUploaded: Boolean(p.currentAttempt && p.currentAttempt.botAudioUploaded),
      hasRecording: Boolean((p.currentAttempt && p.currentAttempt.audioUrl) || p.isBot),
      roundScore: p.roundScore,
      totalScore: p.totalScore,
      audioUrl: p.currentAttempt ? p.currentAttempt.audioUrl : null,
      audioStreamUrl: (p.currentAttempt && p.currentAttempt.audioStreamUrl) || null,
      botSoundId: (p.currentAttempt && p.currentAttempt.botSoundId) || null,
      botSoundFileName: (p.currentAttempt && p.currentAttempt.botSoundFileName) || null,
      botPitch: (p.currentAttempt && p.currentAttempt.botPitch) || null,
      botSpeed: (p.currentAttempt && p.currentAttempt.botSpeed) || null,
      botAudioEffects: (p.currentAttempt && p.currentAttempt.botAudioEffects) || null,
      assignedGeneratorSocketId: (p.currentAttempt && p.currentAttempt.assignedGeneratorSocketId) || null,
      generationMode:
        (p.currentAttempt && p.currentAttempt.generationMode) ||
        (p.isBot ? 'LIVE_PLAYBACK_DSP' : undefined),
      requiresClientUpload: Boolean(p.currentAttempt && p.currentAttempt.requiresClientUpload),
      evaluation: p.currentAttempt ? p.currentAttempt.evaluation : null
    })).sort((a, b) => b.roundScore - a.roundScore);
  }

  startUploadingSoundState(uploadDuration: number = GAME_STEP_DURATIONS.UPLOADING_SOUND): void {
    this.simulateAllBotsAttempts();
    const botAssignments = this.getBotGenerationAssignments();
    console.log(`[MimicGame:${this.roomId}] 📨 Step 5.3 Uploading Sound (${uploadDuration}s)...`);

    this.transitionToState(
      GAME_STATES.UPLOADING_SOUND,
      uploadDuration,
      {
        phaseStep: '5.3',
        duration: uploadDuration,
        botAssignments,
        maxBotsPerClient: MAX_BOTS_PER_CLIENT_PER_ROUND,
        message: GameMessageCode.GAME_MSG_UPLOADING_SOUND,
        messageCode: GameMessageCode.GAME_MSG_UPLOADING_SOUND,
        messageParams: { duration: uploadDuration }
      },
      // Gộp chung 5.4 + 5.5 vào màn SHOWDOWN_REVEAL ("Players' Recordings" + nút "FINISH ROUND ▶")
      () => this.startShowdownRevealState()
    );
  }

  startListeningNowPlayingState(listenDuration: number = GAME_STEP_DURATIONS.LISTENING_NOW_PLAYING): void {
    const attemptsList = this.ensureAllPlayerAttempts();
    console.log(`[MimicGame:${this.roomId}] 🔊 Step 5.4 Listening Now Playing (${listenDuration}s)...`);

    this.transitionToState(
      GAME_STATES.LISTENING_NOW_PLAYING,
      listenDuration,
      {
        phaseStep: '5.4',
        duration: listenDuration,
        pack: this.selectedPack,
        targetSound: this.targetSound,
        attempts: attemptsList,
        spotlightIndex: 0,
        spotlightPlayer: attemptsList[0] || null,
        message: GameMessageCode.GAME_MSG_LISTENING_NOW_PLAYING,
        messageCode: GameMessageCode.GAME_MSG_LISTENING_NOW_PLAYING,
        messageParams: { duration: listenDuration }
      },
      () => this.startShowdownRevealState()
    );
  }

  startShowdownRevealState(reviewDuration: number = GAME_STEP_DURATIONS.SHOWDOWN_REVEAL): void {
    const attemptsList = this.ensureAllPlayerAttempts();

    this.showdownSkipVotes.clear();
    for (const player of this.players.values()) {
      player.isReady = Boolean(player.isBot);
      if (player.isBot) {
        this.showdownSkipVotes.add(player.socketId);
      }
    }

    console.log(
      `[MimicGame:${this.roomId}] 🎧 Step 5.4/5.5 Players' Recordings & Playback Review (chờ 100% FINISH ROUND hoặc auto sau ${reviewDuration}s)...`
    );

    this.transitionToState(
      GAME_STATES.SHOWDOWN_REVEAL,
      reviewDuration,
      {
        phaseStep: '5.5',
        duration: reviewDuration,
        pack: this.selectedPack,
        targetSound: this.targetSound,
        attempts: attemptsList,
        spotlightIndex: 0,
        spotlightPlayer: attemptsList[0] || null,
        roundWinner: attemptsList[0] || null,
        skipCount: this.showdownSkipVotes.size,
        readyCount: this.showdownSkipVotes.size,
        totalCount: this.players.size,
        votedSockets: Array.from(this.showdownSkipVotes)
      },
      () => this.startAiScoringState()
    );
  }

  startAiScoringState(suspenseDuration: number = GAME_STEP_DURATIONS.AI_SCORING): void {
    this.ensureAllPlayerAttempts();
    console.log(`[MimicGame:${this.roomId}] 🤖 Step 5.6 AI Voice Detector đang phân tích & chấm điểm (${suspenseDuration}s)...`);

    this.transitionToState(
      GAME_STATES.AI_SCORING,
      suspenseDuration,
      {
        phaseStep: '5.6',
        duration: suspenseDuration,
        suspenseDuration,
        aiWeights: {
          melody: 50,
          rhythm: 30,
          attack: 20
        },
        message: GameMessageCode.GAME_MSG_AI_SCORING,
        messageCode: GameMessageCode.GAME_MSG_AI_SCORING
      },
      () => this.startRoundResultState()
    );
  }

  confirmShowdownSkip(socketId: string): {
    success: boolean;
    code?: ErrorCode;
    message?: ErrorCode;
    isVoted?: boolean;
    skipCount?: number;
    totalCount?: number;
    allSkipConfirmed?: boolean;
  } {
    if (
      this.state !== GAME_STATES.SHOWDOWN_REVEAL &&
      this.state !== GAME_STATES.LISTENING_NOW_PLAYING
    ) {
      return {
        success: false,
        code: ErrorCode.GAME_NOT_IN_SHOWDOWN_PHASE,
        message: ErrorCode.GAME_NOT_IN_SHOWDOWN_PHASE
      };
    }

    const player = this.players.get(socketId);
    if (!player) {
      return {
        success: false,
        code: ErrorCode.PLAYER_NOT_IN_ROOM,
        message: ErrorCode.PLAYER_NOT_IN_ROOM
      };
    }

    for (const p of this.players.values()) {
      if (p.isBot) {
        p.isReady = true;
        this.showdownSkipVotes.add(p.socketId);
      }
    }

    let isVoted = false;
    if (this.showdownSkipVotes.has(socketId)) {
      this.showdownSkipVotes.delete(socketId);
      isVoted = false;
    } else {
      this.showdownSkipVotes.add(socketId);
      isVoted = true;
    }
    player.isReady = isVoted;

    const totalCount = this.players.size;
    const skipCount = this.showdownSkipVotes.size;
    const allSkipConfirmed = (totalCount > 0 && skipCount === totalCount);

    console.log(
      `[MimicGame:${this.roomId}] ⏩ [${player.userName}] ${isVoted ? 'bấm FINISH ROUND (Done)' : 'hủy FINISH ROUND'} (${skipCount}/${totalCount})`
    );

    this.io.to(this.roomId).emit('showdown_skip_updated', {
      socketId,
      userName: player.userName,
      isVoted,
      skipCount,
      readyCount: skipCount,
      totalCount,
      allSkipConfirmed,
      allReady: allSkipConfirmed,
      votedSockets: Array.from(this.showdownSkipVotes)
    });

    this.io.to(this.roomId).emit('round_ready_updated', {
      socketId,
      userName: player.userName,
      readyCount: skipCount,
      totalCount,
      allReady: allSkipConfirmed,
      players: Array.from(this.players.values()).map(p => ({
        socketId: p.socketId,
        userName: p.userName,
        avatar: p.avatar,
        role: p.role,
        isBot: Boolean(p.isBot),
        isReady: this.showdownSkipVotes.has(p.socketId)
      }))
    });

    // Khi 100% người chơi trong phòng đã bấm "FINISH ROUND ▶" (Done) -> Chuyển ngay sang Step 5.6 AI_SCORING ("Locking in this round...")!
    if (allSkipConfirmed) {
      this.io.to(this.roomId).emit('all_players_ready', {
        roomId: this.roomId,
        state: this.state,
        message: GameMessageCode.GAME_MSG_ALL_SKIP_CONFIRMED,
        messageCode: GameMessageCode.GAME_MSG_ALL_SKIP_CONFIRMED,
        countdown: 0,
        timeRemaining: 0,
        totalDuration: 0
      });
      this.startAiScoringState();
    }

    return {
      success: true,
      isVoted,
      skipCount,
      totalCount,
      allSkipConfirmed
    };
  }

  skipToShowdownResult(socketId?: string): { success: boolean } {
    if (socketId) {
      return this.confirmShowdownSkip(socketId);
    }
    return { success: false };
  }

  startRoundResultState(resultDuration: number = GAME_STEP_DURATIONS.ROUND_RESULT): void {
    // Giữ nguyên audioStore trong suốt ROUND_RESULT (chỉ xóa khi bước sang startNextRound hoặc finishGame)
    const attemptsList = this.ensureAllPlayerAttempts();

    for (const player of this.players.values()) {
      player.isReady = Boolean(player.isBot);
    }

    const leaderboard = Array.from(this.players.values())
      .map(p => ({
        socketId: p.socketId,
        userName: p.userName,
        avatar: p.avatar,
        role: p.role,
        isBot: Boolean(p.isBot),
        hasRecording: Boolean((p.currentAttempt && p.currentAttempt.audioUrl) || p.isBot),
        roundScore: p.roundScore,
        totalScore: p.totalScore,
        audioUrl: p.currentAttempt ? p.currentAttempt.audioUrl : null,
        audioStreamUrl: (p.currentAttempt && p.currentAttempt.audioStreamUrl) || null,
        evaluation: p.currentAttempt ? p.currentAttempt.evaluation : null,
        isReady: Boolean(p.isBot)
      }))
      .sort((a, b) => b.totalScore - a.totalScore);

    const readyCount = leaderboard.filter(p => p.isReady).length;
    const isLastRound = this.currentRound >= this.totalRounds;

    console.log(`[MimicGame:${this.roomId}] 🏆 Step 5.7 Round Results Podium (${resultDuration}s)...`);

    this.transitionToState(
      GAME_STATES.ROUND_RESULT,
      resultDuration,
      {
        phaseStep: '5.7',
        duration: resultDuration,
        leaderboard,
        attempts: attemptsList,
        roundWinner: attemptsList[0] || null,
        isLastRound,
        nextRound: isLastRound ? null : this.currentRound + 1,
        readyCount,
        totalCount: this.players.size,
        players: leaderboard
      },
      () => {
        if (isLastRound) {
          this.finishGame();
        } else {
          this.startBreakTimeState();
        }
      }
    );
  }

  startBreakTimeState(breakDuration: number = GAME_STEP_DURATIONS.BREAK_TIME): void {
    for (const player of this.players.values()) {
      player.isReady = Boolean(player.isBot);
    }

    const leaderboard = Array.from(this.players.values())
      .map(p => ({
        socketId: p.socketId,
        userName: p.userName,
        avatar: p.avatar,
        role: p.role,
        isBot: Boolean(p.isBot),
        roundScore: p.roundScore,
        totalScore: p.totalScore,
        isReady: Boolean(p.isBot)
      }))
      .sort((a, b) => b.totalScore - a.totalScore);

    const nextRound = Math.min(this.totalRounds, this.currentRound + 1);
    const readyCount = leaderboard.filter(p => p.isReady).length;

    console.log(`[MimicGame:${this.roomId}] ☕ Step 5.9 Break Time (${breakDuration}s) -> Chuẩn bị vào Vòng ${nextRound}/${this.totalRounds}...`);

    this.transitionToState(
      GAME_STATES.BREAK_TIME,
      breakDuration,
      {
        phaseStep: '5.9',
        duration: breakDuration,
        nextRound,
        totalRounds: this.totalRounds,
        readyCount,
        totalCount: this.players.size,
        players: leaderboard,
        leaderboard,
        message: GameMessageCode.GAME_MSG_BREAK_TIME,
        messageCode: GameMessageCode.GAME_MSG_BREAK_TIME,
        messageParams: {
          nextRound,
          countdown: breakDuration
        }
      },
      () => this.startNextRound()
    );
  }

  finishGame(extraMeta: Record<string, unknown> = {}): void {
    this.clearRoundAudioData();

    for (const player of this.players.values()) {
      player.isReady = Boolean(player.isBot);
    }

    const finalRanking = Array.from(this.players.values())
      .map(p => ({
        socketId: p.socketId,
        userName: p.userName,
        avatar: p.avatar,
        role: p.role,
        isBot: Boolean(p.isBot),
        totalScore: p.totalScore,
        isReady: Boolean(p.isBot)
      }))
      .sort((a, b) => b.totalScore - a.totalScore);

    const readyCount = finalRanking.filter(p => p.isReady).length;
    const champion = finalRanking[0] || null;
    const msgCode = champion
      ? GameMessageCode.GAME_MSG_GAME_OVER_CHAMPION
      : GameMessageCode.GAME_MSG_GAME_OVER_FINISHED;

    const isAutoMatchmakingMode = this.gameMode === 'QUICK_MATCH' || this.gameMode === 'RACE_1V1';

    this.transitionToState(
      GAME_STATES.GAME_OVER,
      0,
      {
        phaseStep: '5.10',
        gameMode: this.gameMode,
        roomDisbanded: isAutoMatchmakingMode,
        autoRestart: false,
        finalRanking,
        champion,
        readyCount,
        totalCount: this.players.size,
        players: finalRanking,
        message: msgCode,
        messageCode: msgCode,
        messageParams: champion ? { championName: champion.userName, totalScore: champion.totalScore } : {},
        ...extraMeta
      },
      null
    );

    // Với QUICK_MATCH và RACE_1V1: ngay sau khi gửi màn kết quả GAME_OVER cho tất cả người chơi,
    // hủy phòng luôn và trả user về mode Online (không giữ ở sảnh chờ và không tự restart game mới)
    if (isAutoMatchmakingMode && this.onGameOverRematchReady) {
      this.onGameOverRematchReady(this.roomId, this);
    }
  }

  confirmRoundReady(socketId: string): {
    success: boolean;
    code?: ErrorCode;
    message?: ErrorCode;
    readyCount?: number;
    totalCount?: number;
    allReady?: boolean;
  } {
    // Nếu Client gọi confirm_next_round_ready ngay tại màn "Players' Recordings" (SHOWDOWN_REVEAL / LISTENING_NOW_PLAYING),
    // xử lý tương đương nút "FINISH ROUND ▶" (confirmShowdownSkip)!
    if (
      this.state === GAME_STATES.SHOWDOWN_REVEAL ||
      this.state === GAME_STATES.LISTENING_NOW_PLAYING
    ) {
      const skipRes = this.confirmShowdownSkip(socketId);
      if (!skipRes.success) {
        return {
          success: false,
          code: skipRes.code,
          message: skipRes.message
        };
      }
      return {
        success: true,
        readyCount: skipRes.skipCount,
        totalCount: skipRes.totalCount,
        allReady: skipRes.allSkipConfirmed
      };
    }

    if (
      this.state !== GAME_STATES.ROUND_RESULT &&
      this.state !== GAME_STATES.BREAK_TIME &&
      this.state !== GAME_STATES.GAME_OVER
    ) {
      return {
        success: false,
        code: ErrorCode.GAME_NOT_IN_READY_PHASE,
        message: ErrorCode.GAME_NOT_IN_READY_PHASE
      };
    }

    // Với QUICK_MATCH và RACE_1V1: không hỗ trợ bấm Ready chơi lại trong phòng sau khi đã GAME_OVER
    if (this.state === GAME_STATES.GAME_OVER && this.gameMode !== 'CUSTOM_ROOM') {
      return {
        success: false,
        code: ErrorCode.GAME_NOT_IN_READY_PHASE,
        message: ErrorCode.GAME_NOT_IN_READY_PHASE
      };
    }

    const player = this.players.get(socketId);
    if (!player) {
      return {
        success: false,
        code: ErrorCode.PLAYER_NOT_IN_ROOM,
        message: ErrorCode.PLAYER_NOT_IN_ROOM
      };
    }

    for (const p of this.players.values()) {
      if (p.isBot) {
        p.isReady = true;
      }
    }
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
        isBot: Boolean(p.isBot),
        isReady: p.isReady
      }))
    });

    if (allReady) {
      if (this.state === GAME_STATES.BREAK_TIME) {
        // Màn 5.9 BREAK_TIME: Khi 100% người chơi bấm "NEW ROUND NOW" -> Bắt đầu ngay vòng đấu tiếp theo!
        this.io.to(this.roomId).emit('all_players_ready', {
          roomId: this.roomId,
          state: this.state,
          message: GameMessageCode.GAME_MSG_ALL_PLAYERS_READY_COUNTDOWN,
          messageCode: GameMessageCode.GAME_MSG_ALL_PLAYERS_READY_COUNTDOWN,
          countdown: 0,
          timeRemaining: 0,
          totalDuration: 0,
          messageParams: { countdown: 0 }
        });
        this.startNextRound();
      } else if (this.state === GAME_STATES.ROUND_RESULT) {
        const isLastRound = this.currentRound >= this.totalRounds;
        if (isLastRound) {
          this.finishGame();
        } else {
          this.startBreakTimeState();
        }
      } else if (this.state === GAME_STATES.GAME_OVER && this.gameMode === 'CUSTOM_ROOM') {
        this.triggerNextStageAfterAllReady();
      }
    }

    return { success: true, readyCount, totalCount, allReady };
  }

  triggerNextStageAfterAllReady(): void {
    if (this.nextStageTimer) return;
    if (this.state !== GAME_STATES.GAME_OVER) return;
    if (this.gameMode !== 'CUSTOM_ROOM') return;

    const countdownSec = GAME_STEP_DURATIONS.READY_COUNTDOWN;
    console.log(`[MimicGame:${this.roomId}] 🎉 TẤT CẢ NGƯỜI CHƠI ĐÃ SẴN SÀNG CHƠI LẠI! Đang đếm ngược ${countdownSec}s...`);
    this.io.to(this.roomId).emit('all_players_ready', {
      roomId: this.roomId,
      state: this.state,
      message: GameMessageCode.GAME_MSG_ALL_PLAYERS_READY_COUNTDOWN,
      messageCode: GameMessageCode.GAME_MSG_ALL_PLAYERS_READY_COUNTDOWN,
      countdown: countdownSec,
      timeRemaining: countdownSec,
      totalDuration: countdownSec,
      messageParams: { countdown: countdownSec }
    });

    this.nextStageTimer = setTimeout(() => {
      this.nextStageTimer = null;
      if (this.players.size === 0) return;
      if (this.state === GAME_STATES.GAME_OVER && this.gameMode === 'CUSTOM_ROOM') {
        this.startGame();
      }
    }, countdownSec * 1000);
  }

  evaluateMimicAttempt(
    audioBase64?: string | null,
    clientMetrics: ClientMetrics | null = null,
    preDecodedBuffer: Buffer | null = null
  ): EvaluationResult {
    const isBotClientDsp = audioBase64 === '__BOT_CLIENT_DSP__';
    if (!isBotClientDsp && (!audioBase64 || typeof audioBase64 !== 'string' || audioBase64.length < 500)) {
      return {
        totalScore: 0,
        pitchScore: 0,
        melodyScore: 0,
        rhythmScore: 0,
        energyScore: 0,
        attackScore: 0,
        grade: 'F',
        remark: AI_REMARKS.terrible[Math.floor(Math.random() * AI_REMARKS.terrible.length)]
      };
    }

    let pitchScore = 0;
    let rhythmScore = 0;
    let energyScore = 0;

    const rawMelody =
      clientMetrics && typeof clientMetrics === 'object'
        ? (typeof clientMetrics.matchPct === 'number'
            ? clientMetrics.matchPct
            : typeof clientMetrics.melodyScore === 'number'
              ? clientMetrics.melodyScore
              : typeof clientMetrics.pitchScore === 'number'
                ? clientMetrics.pitchScore
                : undefined)
        : undefined;

    if (clientMetrics && typeof clientMetrics === 'object' && typeof rawMelody === 'number') {
      if (typeof clientMetrics.activeRatio === 'number' && clientMetrics.activeRatio < 0.05) {
        return {
          totalScore: 15,
          pitchScore: 18,
          melodyScore: 18,
          rhythmScore: 12,
          energyScore: 10,
          attackScore: 10,
          grade: 'F',
          remark: AI_REMARKS.terrible[Math.floor(Math.random() * AI_REMARKS.terrible.length)]
        };
      }
      const rawRhythm =
        typeof clientMetrics.rhythmScore === 'number' ? clientMetrics.rhythmScore : rawMelody * 0.95;
      const rawAttack =
        typeof clientMetrics.energyScore === 'number'
          ? clientMetrics.energyScore
          : typeof clientMetrics.attackScore === 'number'
            ? clientMetrics.attackScore
            : rawMelody * 1.02;

      pitchScore = Math.min(99, Math.max(35, Math.round(rawMelody)));
      rhythmScore = Math.min(98, Math.max(35, Math.round(rawRhythm)));
      energyScore = Math.min(100, Math.max(35, Math.round(rawAttack)));
    } else {
      let buf = preDecodedBuffer;
      if (!buf) {
        const safeAudio = audioBase64 || '';
        const commaIdx = safeAudio.indexOf(',');
        const rawB64 = commaIdx !== -1 ? safeAudio.slice(commaIdx + 1) : safeAudio;
        buf = Buffer.from(rawB64, 'base64');
      }

      // Nếu là file RIFF WAV (16-bit PCM) được upload từ Client (User hoặc Bot): phân tích trực tiếp sóng âm PCM!
      const isWavPcm =
        buf.length > 128 &&
        buf.toString('ascii', 0, 4) === 'RIFF' &&
        buf.toString('ascii', 8, 12) === 'WAVE';

      if (isWavPcm) {
        let dataOffset = 44;
        for (let i = 12; i < Math.min(buf.length - 8, 256); i++) {
          if (
            buf[i] === 0x64 && // 'd'
            buf[i + 1] === 0x61 && // 'a'
            buf[i + 2] === 0x74 && // 't'
            buf[i + 3] === 0x61 // 'a'
          ) {
            dataOffset = i + 8;
            break;
          }
        }
        const totalSamples = Math.floor((buf.length - dataOffset) / 2);
        const stride = Math.max(1, Math.floor(totalSamples / 1024));
        let sumSq = 0;
        let activeCount = 0;
        let zeroCrossings = 0;
        let attackPeaks = 0;
        let prevSample = 0;
        let inspected = 0;

        for (let s = 0; s < totalSamples; s += stride) {
          const bytePos = dataOffset + s * 2;
          if (bytePos + 1 >= buf.length) break;
          const sample = buf.readInt16LE(bytePos) / 32768;
          const abs = Math.abs(sample);
          sumSq += sample * sample;
          if (abs > 0.025) activeCount++;
          if ((sample >= 0 && prevSample < 0) || (sample < 0 && prevSample >= 0)) {
            zeroCrossings++;
          }
          if (abs - Math.abs(prevSample) > 0.12) {
            attackPeaks++;
          }
          prevSample = sample;
          inspected++;
        }

        const rms = inspected > 0 ? Math.sqrt(sumSq / inspected) : 0;
        const activeRatio = inspected > 0 ? activeCount / inspected : 0;

        if (activeRatio < 0.04 || rms < 0.008) {
          return {
            totalScore: 15,
            pitchScore: 18,
            melodyScore: 18,
            rhythmScore: 12,
            energyScore: 10,
            attackScore: 10,
            grade: 'F',
            remark: AI_REMARKS.terrible[Math.floor(Math.random() * AI_REMARKS.terrible.length)]
          };
        }

        const zcrRatio = inspected > 0 ? zeroCrossings / inspected : 0;
        const attackRatio = inspected > 0 ? attackPeaks / inspected : 0;
        const seed = buf.length + Math.round(rms * 1000) + zeroCrossings + attackPeaks;

        pitchScore = Math.min(99, Math.max(45, Math.round(58 + Math.min(28, activeRatio * 34) + Math.min(12, zcrRatio * 40) + (seed % 9) - 4)));
        rhythmScore = Math.min(98, Math.max(45, Math.round(56 + Math.min(28, activeRatio * 32) + Math.min(14, attackRatio * 55) + ((seed * 7) % 9) - 4)));
        energyScore = Math.min(100, Math.max(45, Math.round(55 + Math.min(35, rms * 140) + ((seed * 13) % 9) - 4)));
      } else {
        const uniqueBytes = new Set<number>();
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
            melodyScore: 10,
            rhythmScore: 10,
            energyScore: 10,
            attackScore: 10,
            grade: 'F',
            remark: AI_REMARKS.terrible[Math.floor(Math.random() * AI_REMARKS.terrible.length)]
          };
        }

        const seed = buf.length + Math.round(avgDelta * 10) + uniqueBytes.size;
        pitchScore = Math.min(99, Math.max(48, Math.round(68 + diversity * 12 + (seed % 20) - 4)));
        rhythmScore = Math.min(98, Math.max(52, Math.round(70 + diversity * 10 + ((seed * 7) % 20) - 4)));
        energyScore = Math.min(100, Math.max(45, Math.round(69 + Math.min(15, avgDelta / 6) + ((seed * 13) % 18) - 3)));
      }
    }

    // Đồng bộ trọng số với UI Figma 5.6 AI_SCORING: Melody (Pitch) 50% · Rhythm 30% · Attack (Energy) 20%
    const totalScore = Math.round(pitchScore * 0.5 + rhythmScore * 0.3 + energyScore * 0.2);

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
      melodyScore: pitchScore,
      rhythmScore,
      energyScore,
      attackScore: energyScore,
      grade,
      remark
    };
  }

  clearRoundAudioData(): void {
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

  destroy(): void {
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

  stopTimer(): void {
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
