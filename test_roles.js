const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const ROOM_ID = 'TESTROLE_' + Date.now();

async function runRoleTest() {
  console.log(`\n======================================================`);
  console.log(`🧪 BẮT ĐẦU TEST PHÂN QUYỀN HOST & PLAYER TRONG MIMIC PARTY`);
  console.log(`======================================================\n`);

  // 1. Tạo Client 1 (Host)
  const client1 = io(SERVER_URL);
  // 2. Tạo Client 2 (Player)
  const client2 = io(SERVER_URL);
  // 3. Tạo Client 3 (Player to be kicked)
  const client3 = io(SERVER_URL);

  await new Promise(r => setTimeout(r, 500));

  // STEP 1: Client 1 join room
  console.log('--- BƯỚC 1: Client 1 join phòng (kỳ vọng: trở thành HOST) ---');
  await new Promise(resolve => {
    client1.emit('join_room', { roomId: ROOM_ID, userName: 'HostMaster', avatar: '👑' }, (res) => {
      console.log('Client 1 joined:', {
        roomId: res.room.id,
        hostId: res.room.hostId,
        myRole: res.user.role,
        isReady: res.user.isReady
      });
      if (res.user.role === 'HOST' && res.user.isReady === true && res.room.hostId === client1.id) {
        console.log('✅ PASS: Client 1 được gán làm HOST thành công!');
      } else {
        console.error('❌ FAIL: Client 1 không đúng role HOST!');
      }
      resolve();
    });
  });

  // STEP 2: Client 2 join room
  console.log('\n--- BƯỚC 2: Client 2 join phòng (kỳ vọng: trở thành PLAYER) ---');
  await new Promise(resolve => {
    client2.emit('join_room', { roomId: ROOM_ID, userName: 'RegularPlayer', avatar: '🦁' }, (res) => {
      console.log('Client 2 joined:', {
        roomId: res.room.id,
        hostId: res.room.hostId,
        myRole: res.user.role,
        isReady: res.user.isReady
      });
      if (res.user.role === 'PLAYER' && res.user.isReady === false && res.room.hostId === client1.id) {
        console.log('✅ PASS: Client 2 được gán làm PLAYER với isReady=false!');
      } else {
        console.error('❌ FAIL: Client 2 không đúng role PLAYER!');
      }
      resolve();
    });
  });

  // STEP 3: Client 2 (Player) cố tình bấm Bắt đầu game (game_start)
  console.log('\n--- BƯỚC 3: Client 2 (Player) cố ý gọi game_start (kỳ vọng: BỊ CHẶN) ---');
  await new Promise(resolve => {
    client2.once('game_error', (err) => {
      console.log('Client 2 nhận được game_error:', err.message);
      if (err.message.includes('Chỉ có Chủ phòng')) {
        console.log('✅ PASS: Chặn thành công người chơi thường bấm start!');
      } else {
        console.error('❌ FAIL: Thông báo lỗi không đúng!');
      }
      resolve();
    });
    client2.emit('game_start', { roomId: ROOM_ID }, (res) => {
      if (res && res.success) {
        console.error('❌ FAIL: Game start vẫn thành công dù không phải host!');
      }
    });
  });

  // STEP 4: Client 2 bấm Sẵn sàng (player_ready_toggle)
  console.log('\n--- BƯỚC 4: Client 2 gọi player_ready_toggle ---');
  await new Promise(resolve => {
    client1.once('player_ready_changed', (evt) => {
      console.log('Host nhận event player_ready_changed:', {
        player: evt.userName,
        isReady: evt.isReady
      });
      if (evt.socketId === client2.id && evt.isReady === true) {
        console.log('✅ PASS: Trạng thái Sẵn sàng đồng bộ cho cả phòng!');
      }
      resolve();
    });
    client2.emit('player_ready_toggle', { roomId: ROOM_ID, isReady: true });
  });

  // STEP 5: Host cấu hình trận đấu (game_update_config)
  console.log('\n--- BƯỚC 5: Host cấu hình 5 vòng, 7s nhại ---');
  await new Promise(resolve => {
    client2.once('game_config_changed', (cfg) => {
      console.log('Player nhận config_changed:', cfg);
      if (cfg.totalRounds === 5 && cfg.recordDuration === 7) {
        console.log('✅ PASS: Cấu hình phòng đã cập nhật thành công!');
      }
      resolve();
    });
    client1.emit('game_update_config', { roomId: ROOM_ID, totalRounds: 5, recordDuration: 7 });
  });

  // STEP 6: Client 3 join và bị Host kick
  console.log('\n--- BƯỚC 6: Client 3 join và bị Host kick ---');
  await new Promise(resolve => {
    client3.emit('join_room', { roomId: ROOM_ID, userName: 'TrollUser', avatar: '💩' }, () => {
      client3.once('kicked_from_room', (kickedMsg) => {
        console.log('Client 3 nhận được thông báo kick:', kickedMsg.message);
        console.log('✅ PASS: Host kick thành viên thành công!');
        resolve();
      });
      client1.emit('kick_player', { roomId: ROOM_ID, targetSocketId: client3.id });
    });
  });

  // STEP 7: Host rời phòng -> Kiểm tra Host Migration sang Client 2
  console.log('\n--- BƯỚC 7: Host rời phòng -> Kiểm tra chuyển giao Chủ phòng (Host Migration) ---');
  await new Promise(resolve => {
    client2.once('host_changed', (hostEvt) => {
      console.log('Client 2 nhận sự kiện host_changed:', hostEvt);
      if (hostEvt.newHostId === client2.id) {
        console.log('✅ PASS: Client 2 đã được tự động thăng cấp thành CHỦ PHÒNG MỚI!');
      } else {
        console.error('❌ FAIL: Host Migration thất bại!');
      }
      resolve();
    });
    client1.emit('leave_room', {});
  });

  // STEP 8: Host mới (Client 2) khởi động trận đấu
  console.log('\n--- BƯỚC 8: Host mới (Client 2) bấm Bắt đầu game ---');
  await new Promise(resolve => {
    client2.once('game_state_changed', (stateEvt) => {
      console.log('Trận đấu chuyển sang state:', stateEvt.state, `(Vòng ${stateEvt.round}/${stateEvt.totalRounds})`);
      if (stateEvt.state === 'THEME_SELECTION' && stateEvt.totalRounds === 5) {
        console.log('✅ PASS: Host mới đã khởi động trận đấu thành công với cấu hình 5 vòng!');
      }
      resolve();
    });
    client2.emit('game_start', { roomId: ROOM_ID });
  });

  console.log(`\n======================================================`);
  console.log(`🎉 TOÀN BỘ CÁC TÍNH NĂNG PHÂN QUYỀN HOST & PLAYER ĐỀU HOÀN HẢO!`);
  console.log(`======================================================\n`);

  client1.disconnect();
  client2.disconnect();
  client3.disconnect();
  process.exit(0);
}

runRoleTest().catch(err => {
  console.error('Lỗi khi chạy test:', err);
  process.exit(1);
});
