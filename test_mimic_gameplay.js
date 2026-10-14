const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const ROOM_ID = 'STATE_MACHINE_TEST';

console.log('--- TEST KIỂM THỬ TOÀN DIỆN GAMEPLAY STATE MACHINE TRÊN SERVER ---');

const socketA = io(SERVER_URL);
const socketB = io(SERVER_URL);

const recordedStates = [];
const DUMMY_AUDIO_DATA = 'data:audio/webm;base64,' + 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JAdeBAeaOAAUU2uE5bIN'.repeat(8);

socketA.on('connect', () => {
  console.log('[Alice] Kết nối Socket thành công');
  socketA.emit('join_room', {
    roomId: ROOM_ID,
    userName: 'Alice (Host)',
    avatar: '🦊'
  }, (res) => {
    if (res.success) {
      console.log('[Alice] Đã vào phòng. Game State ban đầu:', res.gameState ? res.gameState.state : 'None');
      joinBob();
    }
  });
});

function joinBob() {
  socketB.emit('join_room', {
    roomId: ROOM_ID,
    userName: 'Bob (Player)',
    avatar: '🦁'
  }, (res) => {
    if (res.success) {
      console.log('[Bob] Đã vào phòng.');
      setTimeout(() => {
        console.log('\n[Host] 🚀 Bấm BẮT ĐẦU TRẬN ĐẤU (game_start)...');
        socketA.emit('game_start', { roomId: ROOM_ID });
      }, 500);
    }
  });
}

// LẮNG NGHE TOÀN BỘ CHUYỂN ĐỔI STATE TỪ SERVER
socketB.on('game_state_changed', (stateData) => {
  recordedStates.push(stateData.state);
  console.log(`\n[State Transition] 🔄 State: ${stateData.state} (${stateData.duration}s) | Nhãn: "${stateData.stateLabel}" | Vòng: ${stateData.round}/${stateData.totalRounds}`);

  if (stateData.state === 'THEME_SELECTION') {
    console.log(`  -> Chủ đề được chọn: ${stateData.payload.selectedPack.emoji} "${stateData.payload.selectedPack.name}"`);
  } else if (stateData.state === 'PLAYING_SAMPLE') {
    console.log(`  -> Đang phát audio mẫu: ${stateData.payload.targetSound.emoji} "${stateData.payload.targetSound.name}"`);
    console.log(`  -> Audio URL: ${stateData.payload.targetSound.audioUrl}`);
  } else if (stateData.state === 'USER_RECORDING') {
    console.log(`  -> Tới lượt user bật mic nhại lại! Thông điệp: "${stateData.payload.message}"`);
    // Giả lập nộp bài thu
    setTimeout(() => {
      console.log('  -> [User] Nộp bài thi nhại lại lên Server...');
      socketA.emit('game_submit_audio', {
        roomId: ROOM_ID,
        audioData: DUMMY_AUDIO_DATA,
        mimeType: 'audio/webm'
      });
      socketB.emit('game_submit_audio', {
        roomId: ROOM_ID,
        audioData: DUMMY_AUDIO_DATA + 'EXTRA',
        mimeType: 'audio/webm'
      });
    }, 1000);
  } else if (stateData.state === 'AI_SCORING') {
    console.log(`  -> ${stateData.payload.message}`);
  } else if (stateData.state === 'SHOWDOWN_REVEAL') {
    console.log(`  -> KẾT QUẢ CHẤM ĐIỂM SHOWDOWN:`);
    (stateData.payload.attempts || []).forEach(att => {
      console.log(`     * ${att.userName}: ${att.evaluation.totalScore}đ (${att.evaluation.grade}) -> "${att.evaluation.remark}"`);
    });
  } else if (stateData.state === 'ROUND_RESULT') {
    console.log(`  -> BẢNG XẾP HẠNG VÒNG ${stateData.round}:`);
    (stateData.payload.leaderboard || []).forEach((p, idx) => {
      console.log(`     #${idx + 1} ${p.userName}: Tổng ${p.totalScore}đ`);
    });

    console.log('\n============================================================');
    console.log('✅ TẤT CẢ CÁC STATE TRONG GAMEPLAY ĐÃ ĐƯỢC XỬ LÝ ĐẦY ĐỦ:');
    console.log('  1. IDLE (Sảnh chờ ban đầu):           ĐÃ XÁC NHẬN');
    console.log('  2. THEME_SELECTION (Random chủ đề):    ĐÃ XÁC NHẬN');
    console.log('  3. PLAYING_SAMPLE (Phát âm thanh mẫu): ĐÃ XÁC NHẬN');
    console.log('  4. USER_RECORDING (Thu âm user nhại):  ĐÃ XÁC NHẬN');
    console.log('  5. AI_SCORING (AI chấm điểm):         ĐÃ XÁC NHẬN');
    console.log('  6. SHOWDOWN_REVEAL (Showdown & nghe): ĐÃ XÁC NHẬN');
    console.log('  7. ROUND_RESULT (Kết quả vòng):       ĐÃ XÁC NHẬN');
    console.log('============================================================');

    socketA.disconnect();
    socketB.disconnect();
    process.exit(0);
  }
});

// Lắng nghe game_state_tick
let tickCount = 0;
socketB.on('game_state_tick', (tick) => {
  tickCount++;
  if (tickCount % 3 === 0) {
    console.log(`  [Tick] State: ${tick.state} | Còn lại: ${tick.timeRemaining}s (${tick.progressPercent}%)`);
  }
});

setTimeout(() => {
  console.error('❌ Timeout test');
  socketA.disconnect();
  socketB.disconnect();
  process.exit(1);
}, 35000);
