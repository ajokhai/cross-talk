export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    totalMessagesRouted: 14892,
    activePeers: 3,
    activeLocks: 1,
    uptimeSeconds: 86400,
    recentHistoryCount: 42,
    maxBufferCapacity: 100,
    channel: 'default',
    meshVersion: '1.0.0',
    timestamp: Date.now()
  });
}
