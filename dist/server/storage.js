/**
 * Ultra-Lightweight In-Memory Ring Buffer Storage
 * Used by default across local CLI, micro devices, and offline nodes.
 * Zero external dependencies. Zero garbage collection pressure.
 */
export class InMemoryStorage {
    history = new Map();
    totalMessages = 0;
    maxCapacity;
    constructor(maxCapacity = 100) {
        this.maxCapacity = maxCapacity;
    }
    async recordMessage(channel, msg) {
        this.totalMessages++;
        if (!this.history.has(channel)) {
            this.history.set(channel, []);
        }
        const list = this.history.get(channel);
        list.push(msg);
        if (list.length > this.maxCapacity) {
            list.shift(); // O(1) bounded FIFO ejection
        }
    }
    async getTotalMessageCount() {
        return this.totalMessages;
    }
    async getRecentMessages(channel, limit = 100) {
        const list = this.history.get(channel) || [];
        return list.slice(-limit);
    }
    async close() { }
}
/**
 * MongoDB Capped Ring Buffer Storage
 * Automatically connects when MONGODB_URI is provided (e.g. on hosted websites or Vercel).
 * Falls back to InMemoryStorage if mongodb package or connection is not present.
 */
export class MongoStorage {
    inMemoryFallback = new InMemoryStorage(100);
    client = null;
    db = null;
    isConnected = false;
    uri;
    dbName;
    constructor(uri, dbName = 'crosstalk') {
        this.uri = uri;
        this.dbName = dbName;
    }
    async connect() {
        try {
            // Dynamic import so packages and installers without mongodb run without errors
            const { MongoClient } = await import('mongodb');
            this.client = new MongoClient(this.uri, {
                connectTimeoutMS: 5000,
                serverSelectionTimeoutMS: 5000
            });
            await this.client.connect();
            this.db = this.client.db(this.dbName);
            // Ensure capped collection for ring buffer (max: 100 documents, 1MB max size)
            const collections = await this.db.listCollections({ name: 'crosstalk_messages' }).toArray();
            if (collections.length === 0) {
                try {
                    await this.db.createCollection('crosstalk_messages', {
                        capped: true,
                        size: 1048576,
                        max: 100
                    });
                }
                catch (_) {
                    // May have been created concurrently
                }
            }
            this.isConnected = true;
            console.log(`[MeshStorage] Connected to MongoDB (${this.dbName}). Ring buffer capped at 100 documents.`);
            return true;
        }
        catch (err) {
            console.warn(`[MeshStorage] MongoDB connection skipped or failed (${err.message}). Using ultra-light in-memory ring buffer.`);
            this.isConnected = false;
            return false;
        }
    }
    async recordMessage(channel, msg) {
        await this.inMemoryFallback.recordMessage(channel, msg);
        if (this.isConnected && this.db) {
            try {
                // Increment persistent total message counter in stats collection
                await this.db.collection('crosstalk_stats').updateOne({ _id: 'global_metrics' }, { $inc: { totalMessages: 1 }, $set: { lastActive: Date.now() } }, { upsert: true });
                // Insert into capped ring buffer
                await this.db.collection('crosstalk_messages').insertOne({
                    id: msg.id,
                    type: msg.type,
                    channel,
                    from: msg.from,
                    content: msg.content,
                    timestamp: msg.timestamp
                });
            }
            catch (err) {
                // Non-blocking fallback
            }
        }
    }
    async getTotalMessageCount() {
        if (this.isConnected && this.db) {
            try {
                const doc = await this.db.collection('crosstalk_stats').findOne({ _id: 'global_metrics' });
                if (doc && typeof doc.totalMessages === 'number') {
                    return doc.totalMessages;
                }
            }
            catch (_) { }
        }
        return this.inMemoryFallback.getTotalMessageCount();
    }
    async getRecentMessages(channel, limit = 100) {
        if (this.isConnected && this.db) {
            try {
                const docs = await this.db
                    .collection('crosstalk_messages')
                    .find({ channel })
                    .sort({ $natural: -1 })
                    .limit(limit)
                    .toArray();
                if (docs.length > 0) {
                    return docs.reverse().map((d) => ({
                        id: d.id,
                        type: d.type,
                        channel: d.channel,
                        from: d.from,
                        content: d.content,
                        timestamp: d.timestamp
                    }));
                }
            }
            catch (_) { }
        }
        return this.inMemoryFallback.getRecentMessages(channel, limit);
    }
    async close() {
        if (this.client) {
            try {
                await this.client.close();
            }
            catch (_) { }
        }
    }
}
/**
 * Storage factory:
 * If MONGODB_URI is provided, initializes MongoStorage.
 * Otherwise returns zero-dependency InMemoryStorage.
 */
export async function createMeshStorage() {
    const uri = process.env.MONGODB_URI;
    if (uri && uri.trim() !== '') {
        const mongo = new MongoStorage(uri.trim());
        const ok = await mongo.connect();
        if (ok)
            return mongo;
    }
    return new InMemoryStorage(100);
}
