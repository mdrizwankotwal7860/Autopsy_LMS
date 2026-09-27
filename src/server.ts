import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import prisma from './utils/prisma';
import redisClient from './utils/redis';
import { Server } from 'http';

const PORT = process.env.PORT || 3000;
let server: Server;
let isShuttingDown = false;

const startServer = async () => {
  try {
    server = app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

const gracefulShutdown = async (signal: string, exitCode: number) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  app.locals.isShuttingDown = true;
  
  console.log(`\n[${signal}] Shutdown initiated...`);
  
  const timeout = setTimeout(() => {
    console.error('[Timeout] Graceful shutdown took too long. Forcing exit.');
    process.exit(1);
  }, 15000);
  
  let cleanupFailed = false;

  if (server) {
    try {
      console.log('Closing HTTP server...');
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      console.log('HTTP server drained.');
    } catch (err) {
      console.error('Error during HTTP server drain:', err);
      cleanupFailed = true;
    }
  }
  
  try {
    console.log('Disconnecting Prisma...');
    await prisma.$disconnect();
    console.log('Prisma disconnected.');
  } catch (err) {
    console.error('Error disconnecting Prisma:', err);
    cleanupFailed = true;
  }
  
  if (redisClient) {
    try {
      console.log('Closing Redis...');
      await redisClient.quit();
      console.log('Redis disconnected.');
    } catch (err) {
      console.error('Error closing Redis:', err);
      cleanupFailed = true;
    }
  }
  
  clearTimeout(timeout);
  console.log('Graceful shutdown completed.');
  process.exit(cleanupFailed ? 1 : exitCode);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 0));
process.on('SIGINT', () => gracefulShutdown('SIGINT', 0));

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection', 1);
});
