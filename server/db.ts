import dotenv from 'dotenv';
dotenv.config();

import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "./shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Configure connection pool with better error handling and recovery
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  // Connection pool configuration for better reliability
  max: 10, // Maximum number of connections in the pool
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: 10000, // Connection timeout 10 seconds
  allowExitOnIdle: true, // Allow process to exit when all connections are idle
};

export const pool = new Pool(poolConfig);

// Add error handling for the pool
pool.on('error', (err: Error) => {
  console.error('Database pool error:', err);
  // Don't crash the process, just log the error
  // The pool will attempt to recover automatically
});

// Handle connection errors at the pool level
pool.on('connect', (client: any) => {
  console.log('Database connection established');
  
  // Add error handler for individual client connections
  client.on('error', (err: Error) => {
    console.error('Database client error:', err);
    // Don't crash the process for individual client errors
  });
});

export const db = drizzle({ client: pool, schema });

// Graceful database shutdown function
export async function closeDatabase(): Promise<void> {
  try {
    console.log('Closing database connections...');
    await pool.end();
    console.log('Database connections closed successfully');
  } catch (error) {
    console.error('Error closing database connections:', error);
  }
}