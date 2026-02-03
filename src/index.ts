import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import { BattleRoom } from "./rooms/BattleRoom";
import { ChessRoom } from "./rooms/ChessRoom";
import { TradeRoom } from "./rooms/TradeRoom";

// ============================================
// Garden Wars Colyseus Server
// ============================================

const port = Number(process.env.PORT) || 2567;

// HTTP サーバー作成（REST API用）
const httpServer = createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 部屋一覧API
  if (req.method === 'GET' && req.url === '/rooms') {
    matchMaker.query({ name: 'battle' })
      .then((rooms) => {
        // waiting状態で1人待機中の部屋のみ返す
        const waitingRooms = rooms
          .filter(room => room.metadata?.status === 'waiting' && room.clients === 1)
          .map(room => ({
            roomId: room.roomId,
            hostName: room.metadata?.hostName || 'Unknown',
            hostDeckPreview: room.metadata?.hostDeckPreview || [],
            createdAt: room.metadata?.createdAt || Date.now()
          }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rooms: waitingRooms }));
      })
      .catch((err) => {
        console.error('[API] Error querying rooms:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to query rooms' }));
      });
    return;
  }


  // チェス部屋一覧API
  if (req.method === 'GET' && req.url === '/chess/rooms') {
    matchMaker.query({ name: 'chess' })
      .then((rooms) => {
        const waitingRooms = rooms
          .filter(room => room.metadata?.status === 'waiting' && room.clients === 1)
          .map(room => ({
            roomId: room.roomId,
            hostName: room.metadata?.hostName || 'Unknown',
            createdAt: room.metadata?.createdAt || Date.now()
          }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rooms: waitingRooms }));
      })
      .catch((err) => {
        console.error('[API] Error querying chess rooms:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to query rooms' }));
      });
    return;
  }

  // Trade rooms API
  if (req.method === 'GET' && req.url === '/trade/rooms') {
    matchMaker.query({ name: 'trade' })
      .then((rooms) => {
        const waitingRooms = rooms
          .filter(room => room.metadata?.status === 'waiting' && room.clients === 1)
          .map(room => ({
            roomId: room.roomId,
            hostName: room.metadata?.hostName || 'Unknown',
            createdAt: room.metadata?.createdAt || Date.now()
          }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rooms: waitingRooms }));
      })
      .catch((err) => {
        console.error('[API] Error querying trade rooms:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to query rooms' }));
      });
    return;
  }

  // ヘルスチェック
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,  // 既存のHTTPサーバーを使用
    pingInterval: 5000,
    pingMaxRetries: 3,
  })
});

// ルーム登録
gameServer.define("battle", BattleRoom)
  .enableRealtimeListing();  // リアルタイムでルーム一覧を取得可能に

// チェスルーム登録
gameServer.define("chess", ChessRoom)
  .enableRealtimeListing();

// Trade room registration
gameServer.define("trade", TradeRoom)
  .enableRealtimeListing();

// サーバー起動
// IMPORTANT: Renderでは 0.0.0.0 にバインドする必要がある
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`🎮 Garden Wars Colyseus Server`);
  console.log(`   Listening on ws://0.0.0.0:${port}`);
  console.log(`   REST API: http://0.0.0.0:${port}/rooms`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  gameServer.gracefullyShutdown().then(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  gameServer.gracefullyShutdown().then(() => {
    process.exit(0);
  });
});
