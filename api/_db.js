/**
 * Serverless MongoDB connection helper for Vercel deployment.
 * Keeps zero external dependencies for local CLI/installers:
 * Dynamically loads 'mongodb' ONLY if MONGODB_URI is provided in process.env.
 */

let cachedClient = null;
let cachedDb = null;

export async function getMongoDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.trim() === '') {
    return null;
  }

  if (cachedDb) {
    return cachedDb;
  }

  try {
    const { MongoClient } = await import('mongodb');
    if (!cachedClient) {
      cachedClient = new MongoClient(uri.trim(), {
        connectTimeoutMS: 4000,
        serverSelectionTimeoutMS: 4000
      });
      await cachedClient.connect();
    }
    const dbName = process.env.MONGODB_DB_NAME || 'crosstalk';
    cachedDb = cachedClient.db(dbName);
    return cachedDb;
  } catch (err) {
    console.warn('[Vercel DB] MongoDB connection failed or module absent:', err.message);
    return null;
  }
}
