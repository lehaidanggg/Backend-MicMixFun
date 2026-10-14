const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const ROOM_ID = 'TEST99';

console.log('--- BẮT ĐẦU TEST SOCKET 2 CLIENTS: ALICE & BOB ---');

const socketA = io(SERVER_URL);
const socketB = io(SERVER_URL);

let testPassed = {
  aliceJoined: false,
  bobJoined: false,
  bobGotChat: false,
  bobGotSound: false
};

function checkFinish() {
  if (testPassed.aliceJoined && testPassed.bobJoined && testPassed.bobGotChat && testPassed.bobGotSound) {
    console.log('\n✅ TẤT CẢ TEST ĐÃ VƯỢT QUA XUẤT SẮC:');
    console.log('  1. Tạo phòng & Join Room: THÀNH CÔNG');
    console.log('  2. Chat thời gian thực: THÀNH CÔNG');
    console.log('  3. Share audio (Soundboard sync): THÀNH CÔNG');
    socketA.disconnect();
    socketB.disconnect();
    process.exit(0);
  }
}

// Client A (Alice)
socketA.on('connect', () => {
  console.log('[Alice] Kết nối Socket thành công:', socketA.id);
  socketA.emit('join_room', {
    roomId: ROOM_ID,
    userName: 'Alice',
    avatar: '🎧'
  }, (res) => {
    if (res.success) {
      console.log('[Alice] Vào phòng thành công:', ROOM_ID);
      testPassed.aliceJoined = true;
      
      // Khởi tạo Bob vào phòng sau khi Alice đã vào
      joinBob();
    }
  });
});

function joinBob() {
  socketB.emit('join_room', {
    roomId: ROOM_ID,
    userName: 'Bob',
    avatar: '🎤'
  }, (res) => {
    if (res.success) {
      console.log('[Bob] Vào phòng thành công:', ROOM_ID);
      testPassed.bobJoined = true;

      // Alice gửi tin nhắn chat
      setTimeout(() => {
        console.log('[Alice] Gửi tin nhắn chat: "Chào Bob, nghe thử âm thanh này nhé!"');
        socketA.emit('send_message', {
          message: 'Chào Bob, nghe thử âm thanh này nhé!'
        });
      }, 500);

      // Alice trigger share audio
      setTimeout(() => {
        console.log('[Alice] Bấm phát âm thanh "airhorn-triple"');
        socketA.emit('trigger_sound', {
          soundId: 'airhorn-triple',
          soundName: 'Airhorn Triple',
          soundUrl: '/downloaded_sounds/airhorn-triple.mp3',
          volume: 1.0
        });
      }, 1000);
    }
  });
}

// Client B (Bob) lắng nghe
socketB.on('new_message', (msg) => {
  console.log(`[Bob] Nhận được tin nhắn từ ${msg.senderName}: "${msg.message}"`);
  if (msg.senderName === 'Alice' && msg.message.includes('Chào Bob')) {
    testPassed.bobGotChat = true;
    checkFinish();
  }
});

socketB.on('sync_play_sound', (data) => {
  console.log(`[Bob] 🔊 Nhận sự kiện SOUND SYNC từ ${data.senderName}: "${data.soundName}" (${data.soundUrl})`);
  if (data.soundId === 'airhorn-triple') {
    testPassed.bobGotSound = true;
    checkFinish();
  }
});

// Timeout fail-safe
setTimeout(() => {
  console.error('❌ Hết thời gian chờ test (Timeout)');
  socketA.disconnect();
  socketB.disconnect();
  process.exit(1);
}, 8000);
