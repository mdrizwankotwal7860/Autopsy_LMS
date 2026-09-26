import Redis from 'ioredis';

// Allow disabling Redis for test environments or local dev without Redis
export const redisEnabled = !!process.env.REDIS_URL;

let redisClient: Redis | null = null;

if (redisEnabled) {
  redisClient = new Redis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: 1, // Don't hang forever if Redis is down
    enableOfflineQueue: false // Fail fast if offline
  });

  redisClient.on('error', (err) => {
    // Only log the error message, do not leak credentials or full URL
    console.error(`[Redis Error] ${err.message}`);
  });
}

export default redisClient;
