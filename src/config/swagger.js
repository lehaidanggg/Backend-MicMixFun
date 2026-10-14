/**
 * Cấu hình OpenAPI 3.0.3 (Swagger) cho MicMixFun & Mimic Party Backend
 */

const PACK_ENUM = [
  'animals',
  'anime',
  'everyday',
  'funny',
  'melody',
  'meme',
  'robots',
  'signals',
  'space',
  'vehicles',
  'voice1',
  'voices',
  'yankee'
];

function buildOpenApiSpec(serverUrl = 'https://backend-micmixfun-production.up.railway.app') {
  return {
    openapi: '3.0.3',
    info: {
      title: 'MicMixFun & Mimic Party API',
      version: '1.0.0',
      description:
        'Tài liệu REST API chính thức cho **MicMixFun & Mimic Party Server** (Express 5 + Socket.IO + Cloudflare R2 CDN).\n\n' +
        '### 🔗 Hệ thống liên kết\n' +
        '- **Cloudflare R2 Audio CDN:** `https://pub-2ec3726948d14e47babdc7ea12268a78.r2.dev`\n' +
        '- **Web Demo Phòng Chat:** [/room](/room)\n' +
        '- **Web Demo Mimic Party:** [/mimic](/mimic)\n' +
        '- **OpenAPI JSON Spec:** [/api-docs.json](/api-docs.json)',
      contact: {
        name: 'MicMixFun Backend Team'
      }
    },
    servers: [
      {
        url: serverUrl,
        description: 'Current Server'
      },
      {
        url: 'https://backend-micmixfun-production.up.railway.app',
        description: 'Railway Production Server (Singapore)'
      },
      {
        url: 'http://localhost:3000',
        description: 'Local Development Server'
      }
    ],
    tags: [
      {
        name: 'System',
        description: 'Kiểm tra trạng thái vận hành (Healthcheck) của Server & Socket.IO'
      },
      {
        name: 'Authentication',
        description: 'Xác thực người chơi (Guest Token, Firebase Anonymous Auth, Challenge-Response HMAC)'
      },
      {
        name: 'Mimic Game & Sounds',
        description: 'Danh mục 251 âm thanh trên R2 CDN, các gói chủ đề (Sound Packs) và trạng thái Game State Machine'
      },
      {
        name: 'Rooms & Attempts',
        description: 'Quản lý danh sách phòng chơi trực tuyến và stream bản thu âm của người chơi'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'HMAC-Session-Token / Firebase-JWT',
          description: 'Nhập `authToken` nhận được từ `/api/auth/guest` hoặc `/api/auth/firebase`'
        }
      },
      schemas: {
        UserProfile: {
          type: 'object',
          properties: {
            userId: { type: 'string', example: 'u_9f8e7d6c5b4a' },
            firebaseUid: { type: 'string', nullable: true, example: null },
            userName: { type: 'string', example: 'CaoThuNhaiGiong' },
            avatar: { type: 'string', example: '🎧' }
          }
        },
        AuthResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            userId: { type: 'string', example: 'u_9f8e7d6c5b4a' },
            firebaseUid: { type: 'string', nullable: true, example: null },
            provider: { type: 'string', enum: ['guest', 'firebase_anonymous'], example: 'guest' },
            authToken: { type: 'string', example: 'eyJ1aWQiOiJ1XzlmOGU3ZDZjNWI0YSIsIm5hbWUiOiJDYW9UaHV...' },
            expiresAt: { type: 'integer', example: 1792047000000 },
            user: { $ref: '#/components/schemas/UserProfile' }
          }
        },
        SoundItem: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'cat-two' },
            pack: { type: 'string', enum: PACK_ENUM, example: 'animals' },
            fileName: { type: 'string', example: 'cat-two.mp3' },
            relativePath: { type: 'string', example: 'animals/cat-two.mp3' },
            name: { type: 'string', example: 'Cat Two' },
            url: {
              type: 'string',
              example: 'https://pub-2ec3726948d14e47babdc7ea12268a78.r2.dev/animals/cat-two.mp3'
            }
          }
        },
        RoomItem: {
          type: 'object',
          properties: {
            roomId: { type: 'string', example: 'K9P2' },
            roomName: { type: 'string', example: 'Phòng Đại Chiến Nhại Giọng' },
            memberCount: { type: 'integer', example: 3 },
            maxMembers: { type: 'integer', example: 10 },
            gameState: { type: 'string', example: 'IDLE' },
            createdAt: { type: 'integer', example: 1791960669996 }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Token không hợp lệ hoặc đã hết hạn!' }
          }
        }
      }
    },
    paths: {
      '/api/health': {
        get: {
          tags: ['System'],
          summary: 'Health Check & Thống kê kết nối thời gian thực',
          description: 'Trả về trạng thái hoạt động của Server, tổng số phòng đang mở và tổng số kết nối Socket.IO hiện tại.',
          responses: {
            200: {
              description: 'Server đang hoạt động bình thường',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'online' },
                      timestamp: { type: 'integer', example: 1791960669996 },
                      totalActiveRooms: { type: 'integer', example: 2 },
                      totalConnectedSockets: { type: 'integer', example: 8 }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/auth/challenge': {
        get: {
          tags: ['Authentication'],
          summary: 'Phát hành One-Time Challenge Nonce (Chống Replay Attack)',
          description: 'Tạo mã `nonce` dùng một lần (hiệu lực 60 giây) gắn với IP của Client để ký HMAC trước khi gọi `/api/auth/firebase`.',
          responses: {
            200: {
              description: 'Phát hành Nonce thành công',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      nonce: { type: 'string', example: '4f9c2e8a1b7d6e3f9a0c1d2e3f4a5b6c' },
                      timestamp: { type: 'integer', example: 1791960669996 },
                      expiresInMs: { type: 'integer', example: 60000 }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/auth/guest': {
        post: {
          tags: ['Authentication'],
          summary: 'Cấp mới hoặc làm mới Guest Session Token',
          description:
            'Tạo phiên đăng nhập nhanh cho người chơi Guest (hoặc làm mới `authToken` cũ để giữ nguyên `userId` khi kết nối lại phòng đấu).',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    userName: { type: 'string', example: 'CaoThuNhaiGiong', description: 'Tên hiển thị của người chơi' },
                    avatar: { type: 'string', example: '🦊', description: 'Emoji hoặc avatar của người chơi' },
                    deviceId: { type: 'string', example: 'android-pixel-8', description: 'Mã định danh thiết bị (dùng tạo Fingerprint)' },
                    authToken: { type: 'string', description: 'Token cũ (nếu muốn gia hạn phiên và giữ nguyên userId)' },
                    firebaseIdToken: { type: 'string', description: 'Firebase ID Token (tùy chọn)' }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Cấp Session Token thành công',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AuthResponse' }
                }
              }
            }
          }
        }
      },
      '/api/auth/firebase': {
        post: {
          tags: ['Authentication'],
          summary: 'Xác thực bằng Firebase ID Token (Anonymous / Google / Apple)',
          description:
            'Đổi `firebaseIdToken` từ Firebase SDK trên Android/iOS lấy `authToken` của MicMixFun. Hỗ trợ kiểm tra chữ ký `appSignature` (Challenge-Response HMAC).',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['firebaseIdToken'],
                  properties: {
                    firebaseIdToken: { type: 'string', example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6...' },
                    userName: { type: 'string', example: 'PlayerOne' },
                    avatar: { type: 'string', example: '🐯' },
                    deviceId: { type: 'string', example: 'android-device-id-01' },
                    nonce: { type: 'string', description: 'Nonce nhận từ GET /api/auth/challenge (tùy chọn)' },
                    timestamp: { type: 'integer', description: 'Timestamp lúc ký challenge (tùy chọn)' },
                    appSignature: {
                      type: 'string',
                      description: 'HMAC-SHA256(firebaseUid:nonce:timestamp, APP_HMAC_SECRET) (tùy chọn)'
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Xác thực Firebase thành công',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AuthResponse' }
                }
              }
            },
            401: {
              description: 'Firebase ID Token không hợp lệ hoặc hết hạn',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            403: {
              description: 'Chữ ký Challenge-Response không hợp lệ',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        }
      },
      '/api/auth/verify': {
        get: {
          tags: ['Authentication'],
          summary: 'Kiểm tra tính hợp lệ của Session Token hiện tại',
          description: 'Kiểm tra `authToken` truyền qua Header `Authorization: Bearer <token>` hoặc query `?token=...`.',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'token',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Session Token (nếu không truyền qua Header Authorization)'
            },
            {
              name: 'x-device-id',
              in: 'header',
              required: false,
              schema: { type: 'string' },
              description: 'Device ID để đối chiếu Fingerprint (nếu có)'
            }
          ],
          responses: {
            200: {
              description: 'Token hợp lệ',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      valid: { type: 'boolean', example: true },
                      user: {
                        type: 'object',
                        properties: {
                          userId: { type: 'string', example: 'u_9f8e7d6c5b4a' },
                          firebaseUid: { type: 'string', nullable: true, example: null },
                          provider: { type: 'string', example: 'guest' },
                          userName: { type: 'string', example: 'CaoThuNhaiGiong' },
                          avatar: { type: 'string', example: '🎧' },
                          expiresAt: { type: 'integer', example: 1792047000000 }
                        }
                      }
                    }
                  }
                }
              }
            },
            401: {
              description: 'Token không hợp lệ hoặc đã hết hạn',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        }
      },
      '/api/sounds': {
        get: {
          tags: ['Mimic Game & Sounds'],
          summary: 'Lấy danh sách 251 file âm thanh từ Cloudflare R2 CDN',
          description:
            'Trả về danh sách toàn bộ các file `.mp3` đã tối ưu và phân loại vào 13 thư mục chủ đề (`animals`, `anime`, `meme`, `voices`, v.v.). Có thể lọc theo từng chủ đề bằng query `?pack=`.',
          parameters: [
            {
              name: 'pack',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: PACK_ENUM
              },
              description: 'Lọc danh sách âm thanh theo tên thư mục chủ đề (VD: `animals`, `anime`, `meme`)'
            }
          ],
          responses: {
            200: {
              description: 'Danh sách âm thanh kèm URL trực tiếp tới Cloudflare R2 CDN',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      count: { type: 'integer', example: 251 },
                      packCounts: {
                        type: 'object',
                        additionalProperties: { type: 'integer' },
                        example: {
                          animals: 44,
                          anime: 39,
                          everyday: 6,
                          funny: 11,
                          melody: 10,
                          meme: 23,
                          robots: 16,
                          signals: 9,
                          space: 4,
                          vehicles: 5,
                          voice1: 30,
                          voices: 45,
                          yankee: 9
                        }
                      },
                      sounds: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/SoundItem' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/mimic-packs': {
        get: {
          tags: ['Mimic Game & Sounds'],
          summary: 'Lấy danh sách các bộ chủ đề âm thanh (Curated Sound Packs)',
          description: 'Trả về danh sách các chủ đề trong chế độ chơi **Mimic Party** cùng gợi ý cách nhại giọng (`hint`, `emoji`, `relativePath`).',
          responses: {
            200: {
              description: 'Danh sách Sound Packs',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      packs: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', example: 'animals' },
                            folder: { type: 'string', example: 'animals' },
                            name: { type: 'string', example: '🐾 Thế Giới Động Vật' },
                            emoji: { type: 'string', example: '🐾' },
                            description: { type: 'string', example: 'Tiếng kêu đặc trưng của các loài muôn thú và thú cưng!' },
                            sounds: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  id: { type: 'string', example: 'cat-meow' },
                                  name: { type: 'string', example: 'Mèo con kêu Meo Meo' },
                                  fileName: { type: 'string', example: 'cat-two.mp3' },
                                  relativePath: { type: 'string', example: 'animals/cat-two.mp3' },
                                  emoji: { type: 'string', example: '🐱' },
                                  hint: { type: 'string', example: 'Kêu "Meo meo" điệu đà, vuốt cao giọng ở cuối!' }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/game-states': {
        get: {
          tags: ['Mimic Game & Sounds'],
          summary: 'Lấy danh sách các trạng thái của Game State Machine',
          description: 'Trả về các mã trạng thái (`IDLE`, `THEME_SELECTION`, `PLAYING_SAMPLE`, `PREPARE_RECORDING`, `USER_RECORDING`, `AI_SCORING`, `SHOWDOWN_REVEAL`, `ROUND_RESULT`, `GAME_OVER`) và nhãn hiển thị tiếng Việt.',
          responses: {
            200: {
              description: 'Danh sách Game States và Labels',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      states: {
                        type: 'object',
                        additionalProperties: { type: 'string' },
                        example: {
                          IDLE: 'IDLE',
                          THEME_SELECTION: 'THEME_SELECTION',
                          PLAYING_SAMPLE: 'PLAYING_SAMPLE',
                          PREPARE_RECORDING: 'PREPARE_RECORDING',
                          USER_RECORDING: 'USER_RECORDING',
                          AI_SCORING: 'AI_SCORING',
                          SHOWDOWN_REVEAL: 'SHOWDOWN_REVEAL',
                          ROUND_RESULT: 'ROUND_RESULT',
                          GAME_OVER: 'GAME_OVER'
                        }
                      },
                      labels: {
                        type: 'object',
                        additionalProperties: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/rooms': {
        get: {
          tags: ['Rooms & Attempts'],
          summary: 'Lấy danh sách các phòng chơi đang hoạt động',
          description: 'Trả về danh sách toàn bộ các phòng đang mở trên Server kèm số lượng thành viên và trạng thái trận đấu.',
          responses: {
            200: {
              description: 'Danh sách phòng đang mở',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      rooms: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/RoomItem' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/attempts/{roomId}/{socketId}': {
        get: {
          tags: ['Rooms & Attempts'],
          summary: 'Stream trực tiếp bản thu âm nhại giọng của người chơi',
          description: 'Phát trực tiếp dữ liệu nhị phân (`audio/webm` hoặc `audio/mp4`) bản thu âm của một người chơi trong vòng hiện tại để giảm tải kích thước gói tin Socket.IO.',
          parameters: [
            {
              name: 'roomId',
              in: 'path',
              required: true,
              schema: { type: 'string', example: 'K9P2' },
              description: 'Mã phòng (không phân biệt hoa thường)'
            },
            {
              name: 'socketId',
              in: 'path',
              required: true,
              schema: { type: 'string', example: 'abc123xyzSocketId' },
              description: 'Socket ID của người chơi vừa thu âm'
            }
          ],
          responses: {
            200: {
              description: 'Binary Audio Stream',
              content: {
                'audio/webm': {
                  schema: { type: 'string', format: 'binary' }
                }
              }
            },
            404: {
              description: 'Không tìm thấy phòng hoặc bản thu âm đã được giải phóng sau vòng đấu',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: { type: 'string', example: 'Không tìm thấy bản thu âm' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

function renderSwaggerHtml(specUrl = '/api-docs.json') {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MicMixFun API Documentation - Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar-custom {
      background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);
      color: #fff;
      padding: 12px 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 2px 8px rgba(0,0,0,0.18);
    }
    .topbar-custom .brand {
      font-size: 18px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .topbar-custom .links a {
      color: #c7d2fe;
      text-decoration: none;
      margin-left: 16px;
      font-size: 14px;
      font-weight: 500;
    }
    .topbar-custom .links a:hover {
      color: #ffffff;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="topbar-custom">
    <div class="brand">🎙️ MicMixFun & Mimic Party — Swagger API Docs</div>
    <div class="links">
      <a href="/api-docs.json" target="_blank">📄 OpenAPI JSON</a>
      <a href="/api/health" target="_blank">🩺 Health Check</a>
      <a href="/room" target="_blank">💬 Room Demo</a>
      <a href="/mimic" target="_blank">🎮 Mimic Party</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
}

module.exports = {
  buildOpenApiSpec,
  renderSwaggerHtml
};
