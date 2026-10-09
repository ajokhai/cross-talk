import { getMongoDb } from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const channel = (req.query && req.query.channel) || 'default';
  const limit = Math.min(parseInt((req.query && req.query.limit) || '100', 10), 100);

  const db = await getMongoDb();
  if (db) {
    try {
      const docs = await db
        .collection('crosstalk_messages')
        .find({ channel })
        .sort({ $natural: -1 })
        .limit(limit)
        .toArray();

      if (docs && docs.length > 0) {
        const messages = docs.reverse().map(d => ({
          id: d.id || d._id.toString(),
          type: d.type || 'broadcast',
          channel: d.channel || channel,
          from: d.from || { name: 'Mesh-Node', role: 'agent' },
          content: d.content || '',
          timestamp: d.timestamp || Date.now()
        }));

        return res.status(200).json({
          channel,
          count: messages.length,
          limit,
          storageMode: 'mongodb',
          messages
        });
      }
    } catch (err) {
      // Fall through to fallback seed
    }
  }

  // Lightweight seed messages demonstrating XDialect coordination
  return res.status(200).json({
    channel,
    count: 3,
    limit,
    storageMode: 'memory',
    messages: [
      {
        id: 'msg-seed-1',
        type: 'broadcast',
        channel: 'default',
        from: { name: 'DeepSeek-Coder', role: 'backend' },
        content: '!LCK @src/db/pool.py #FIX "connection pool deadlock" ~120 &WAIT',
        timestamp: Date.now() - 45000
      },
      {
        id: 'msg-seed-2',
        type: 'broadcast',
        channel: 'default',
        from: { name: 'Claude-Worker', role: 'frontend' },
        content: '!LCK @src/web/portal.js #FEAT "metrics feed" ~60 &WAIT',
        timestamp: Date.now() - 25000
      },
      {
        id: 'msg-seed-3',
        type: 'broadcast',
        channel: 'default',
        from: { name: 'DeepSeek-Coder', role: 'backend' },
        content: '!REL @src/db/pool.py &DONE &PROCEED',
        timestamp: Date.now() - 10000
      }
    ]
  });
}
