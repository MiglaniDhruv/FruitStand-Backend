import express, { type Request, Response, NextFunction } from "express";
import "dotenv/config";
import { closeDatabase } from "./db";
import { extractTenantSlug } from "./src/middleware/tenant-slug";
import { SYSTEM_ROUTES } from "./src/constants/routes";
import { ERROR_CODES } from "./src/constants/error-codes";
import { logError } from "./src/utils/error-logger";
import { AppError, ValidationError, InternalServerError } from "./src/types/index";
import { handleDatabaseError } from "./src/utils/database-errors";
import { ZodError } from 'zod';
import { asyncHandler } from "./src/utils/async-handler";
import { attachRequestId } from './src/middleware/request-id';
import { requestTimeout } from './src/middleware/timeout';
import { sanitizeInputs, sanitizeParam } from './src/middleware/sanitization';
import { databaseHealthMiddleware, databaseErrorHandler } from './src/middleware/database-health';
import { startDatabaseHealthMonitoring, getDatabaseHealthEndpoint } from './src/utils/database-health';

// Import all modular routers
import { authRouter } from "./src/modules/auth";
import { bankAccountRouter } from "./src/modules/bank-accounts";
import { userRouter } from "./src/modules/users";
import { vendorRouter } from "./src/modules/vendors";
import { itemRouter } from "./src/modules/items";
import { stockRouter } from "./src/modules/stock";
import { purchaseInvoiceRouter } from "./src/modules/purchase-invoices";
import { paymentRouter } from "./src/modules/payments";
import { retailerRouter } from "./src/modules/retailers";
import { salesInvoiceRouter } from "./src/modules/sales-invoices";
import { salesPaymentRouter } from "./src/modules/sales-payments";
import { crateRouter } from "./src/modules/crates";
import { expenseRouter } from "./src/modules/expenses";
import { ledgerRouter } from "./src/modules/ledgers";
import { dashboardRouter } from "./src/modules/dashboard";
import { tenantRouter } from "./src/modules/tenants";
import { whatsappRouter } from "./src/modules/whatsapp";
import { publicRouter } from "./src/modules/public/router";
import { reportRouter } from "./src/modules/reports";
import cors from 'cors';
import session from 'express-session';


// Simple logging function
const log = (message: string) => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

// Server reference for graceful shutdown
let server: any = null;
let isShuttingDown = false;

// Helper function to check if error is a recoverable database connection error
function isDatabaseConnectionError(error: Error): boolean {
  const message = error.message || '';
  const stack = error.stack || '';
  
  return (
    // Neon database termination (recoverable)
    message.includes('{:shutdown, :db_termination}') ||
    message.includes('db_termination') ||
    // WebSocket connection errors (recoverable)
    message.includes('WebSocket connection') ||
    // Check stack trace for Neon serverless package
    stack.includes('@neondatabase/serverless')
  );
}

// Shared shutdown function with idempotent guard
const initiateShutdown = async (exitCode: number) => {
  if (isShuttingDown) {
    return; // Prevent multiple shutdown attempts
  }
  isShuttingDown = true;

  console.log(`Initiating graceful shutdown with exit code ${exitCode}...`);
  
  // Close database connections first
  try {
    await closeDatabase();
  } catch (error) {
    console.error('Error during database shutdown:', error);
  }
  
  if (server) {
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(exitCode);
    });
    
    // Force exit after 10 seconds if graceful shutdown fails
    setTimeout(() => {
      console.error('Forced exit after graceful shutdown timeout');
      process.exit(exitCode);
    }, 10000);
  } else {
    process.exit(exitCode);
  }
};

// Process-level error handlers
process.on('uncaughtException', (error: Error) => {
  logError(error, { path: 'uncaughtException' });
  
  // Check if it's a database connection error that can be recovered from
  if (isDatabaseConnectionError(error)) {
    console.error('Database connection error detected. Attempting to continue...');
    // Don't shut down for recoverable database errors
    return;
  }
  
  console.error('CRITICAL: Uncaught Exception occurred. Performing graceful shutdown...');
  initiateShutdown(1);
});

process.on('unhandledRejection', (reason: any) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logError(error, { path: 'unhandledRejection' });
  
  // Check if it's a database connection error that can be recovered from
  if (isDatabaseConnectionError(error)) {
    console.error('Database connection promise rejection detected. Attempting to continue...');
    // Don't shut down for recoverable database errors
    return;
  }
  
  console.error('CRITICAL: Unhandled Promise Rejection occurred. Performing graceful shutdown...');
  initiateShutdown(1);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Performing graceful shutdown...');
  initiateShutdown(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Performing graceful shutdown...');
  initiateShutdown(0);
});

const app = express();
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,   // true if HTTPS
    httpOnly: true,
    sameSite: 'lax', // works for localhost cross-origin
  },
}));


// Allow frontend requests
app.use(cors({
  origin: 'http://localhost:5173', // frontend URL
  credentials: true,               // allow cookies/sessions
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Apply request ID tracking first for tracing
app.use(attachRequestId);

// Apply timeout protection
app.use(requestTimeout());

// Apply input sanitization (after body parsing, before business logic)
app.use(sanitizeInputs);

// Apply database health middleware
app.use(asyncHandler(databaseHealthMiddleware));

// Sanitize common param names
app.param('id', (req, _res, next, val) => { (req as any).params.id = sanitizeParam(val); next(); });
app.param('slug', (req, _res, next, val) => { (req as any).params.slug = sanitizeParam(val); next(); });

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const contentLength = res.get('content-length') || '0';
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms [${contentLength}b]`;

      // Only log response bodies in development and for small payloads
      if (process.env.NODE_ENV === 'development' && parseInt(contentLength) < 1000) {
        // In development, we might want to see the response for debugging
        // But we don't override res.json for this - keeping it lightweight
      }

      if (logLine.length > 100) {
        logLine = logLine.slice(0, 99) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// URL normalization middleware - strip /:slug from paths matching /:slug/api/*
// Runs before all app.use('/api', ...) calls to ensure proper routing
app.use((req, res, next) => {
  const path = req.path;
  
  // System routes that shouldn't be processed - skip normalization
  const firstSegment = path.split('/')[1];
  
  if (SYSTEM_ROUTES.has(firstSegment)) {
    return next();
  }
  
  // Check if path matches /:slug/api/* pattern
  const slugApiMatch = path.match(/^\/([^\/]+)\/api(\/.*)?$/);
  
  if (slugApiMatch) {
    // Strip the slug prefix, keeping the /api part
    const normalizedPath = '/api' + (slugApiMatch[2] || '');
    req.url = normalizedPath + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
    // Use Object.defineProperty to update the read-only path
    Object.defineProperty(req, 'path', {
      value: normalizedPath,
      writable: false,
      enumerable: true,
      configurable: true
    });
  }
  
  next();
});

// Apply tenant slug middleware before route handlers
app.use(asyncHandler(extractTenantSlug));

(async () => {
  // Initialize database with default data
  try {
    const { initializeDatabase } = await import("./initializeDatabase");
    await initializeDatabase();
  } catch (error) {
    // Critical failure - database initialization must succeed for server to function
    console.error("Failed to initialize database:", error);
    initiateShutdown(1);
    return; // Prevent further startup steps
  }

  // Initialize WhatsApp payment reminder scheduler
  try {
    const { initializePaymentReminderScheduler } = await import("./src/services/whatsapp");
    await initializePaymentReminderScheduler();
    console.log("WhatsApp payment reminder scheduler initialized");
  } catch (error) {
    // Non-critical service - server can continue without WhatsApp scheduler
    console.warn("Failed to initialize WhatsApp scheduler:", error);
  }

  // Add health check endpoint (no authentication required)
  app.get("/api/health", asyncHandler(async (req: Request, res: Response) => {
    const health = await getDatabaseHealthEndpoint();
    
    // Add additional system health information
    const systemHealth = {
      ...health,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version,
    };
    
    res.status(health.status === 'healthy' ? 200 : 503).json(systemHealth);
  }));

  // Mount public router first (no authentication required)
  app.use("/api/public", publicRouter);

  // Mount all modular routers (routes already include /api prefix)
  app.use("/api", authRouter.getRouter());
  app.use("/api", bankAccountRouter.getRouter());
  app.use("/api", userRouter.getRouter());
  app.use("/api", vendorRouter.getRouter());
  app.use("/api", itemRouter.getRouter());
  app.use("/api", stockRouter.getRouter());
  app.use("/api", purchaseInvoiceRouter.getRouter());
  app.use("/api", paymentRouter.getRouter());
  app.use("/api", retailerRouter.getRouter());
  app.use("/api", salesInvoiceRouter.getRouter());
  app.use("/api", salesPaymentRouter.getRouter());
  app.use("/api", crateRouter.getRouter());
  app.use("/api", expenseRouter.getRouter());
  app.use("/api", ledgerRouter.getRouter());
  app.use("/api", dashboardRouter.getRouter());
  app.use("/api", reportRouter.getRouter());
  app.use("/api", tenantRouter.getRouter());
  app.use("/api", whatsappRouter.getRouter());

  // Handle 404 for API routes
  app.use("/api/*", (req: Request, res: Response) => {
    log(`404 - API route not found: ${req.method} ${req.path}`);
    res.status(404).json({ 
      success: false,
      error: {
        message: "API route not found",
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        statusCode: 404
      },
      requestId: (req as any).requestId
    });
  });

  // Database error handling middleware (before general error handler)
  app.use(databaseErrorHandler);

  // Global error handling middleware (must be last)
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    let error = err;

    // Handle Zod validation errors - map to 400 status with structured payload
    if (error instanceof ZodError) {
      error = new ValidationError('Validation failed', error);
    }

    // Handle database errors
    if (error && error.code && typeof error.code === 'string') {
      try {
        handleDatabaseError(error);
      } catch (dbError) {
        error = dbError;
      }
    }

    // Handle custom AppError instances
    if (error instanceof AppError) {
      // Extract context information from request
      const context = {
        requestId: (req as any).requestId,
        userId: (req as any).user?.id,
        tenantId: (req as any).tenantId,
        method: req.method,
        path: req.path,
        body: req.body,
        query: req.query,
        params: req.params,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      };

      // Log error with context
      logError(error, context);

      // Return structured error response
      const response: any = {
        success: false,
        error: {
          message: error.message,
          code: error.code,
          statusCode: error.statusCode,
        },
        requestId: (req as any).requestId,
      };

      // Include details for validation errors
      if (error.details) {
        response.error.details = error.details;
      }

      // Include stack trace only in development
      if (process.env.NODE_ENV === 'development') {
        response.error.stack = error.stack;
      }

      return res.status(error.statusCode).json(response);
    }

    // Handle unknown errors
    const internalError = new InternalServerError('An unexpected error occurred');
    const context = {
      requestId: (req as any).requestId,
      userId: (req as any).user?.id,
      tenantId: (req as any).tenantId,
      method: req.method,
      path: req.path,
      body: req.body,
      query: req.query,
      params: req.params,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    };

    logError(internalError, context);

    const response: any = {
      success: false,
      error: {
        message: internalError.message,
        code: internalError.code,
        statusCode: internalError.statusCode,
      },
      requestId: (req as any).requestId,
    };

    // Include original error details in development
    if (process.env.NODE_ENV === 'development') {
      response.error.originalError = err.message;
      response.error.stack = err.stack;
    }

    return res.status(500).json(response);
  });

  // Setup HTTP server
  const { createServer } = await import("http");
  server = createServer(app);

  // Start server
  const port = parseInt(process.env.PORT || '5000', 10);
  const host = process.platform === "win32" ? "127.0.0.1" : "0.0.0.0";

  server.listen({
    port,
    host,
  }, () => {
    log(`Backend API server running on http://${host}:${port}`);
    log(`Health check available at http://${host}:${port}/api/health`);

    // Start database health monitoring after server is up
    startDatabaseHealthMonitoring(30000); // Check every 30 seconds
  });
})();