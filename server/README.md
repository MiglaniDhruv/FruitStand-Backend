# Error Handling Architecture

## Overview

The FruitStand server implements a multi-layered error handling approach that ensures zero server crashes, consistent error responses, and comprehensive error logging. This architecture provides:

- Process-level handlers (uncaughtException, unhandledRejection)
- Graceful shutdown (SIGTERM, SIGINT)
- Global error middleware
- asyncHandler wrapper for route handlers
- Custom error classes hierarchy

## Custom Error Classes

All custom error classes are defined in `server/src/types/index.ts` and extend the base `AppError` class:

### AppError (Base Class)
- **statusCode**: HTTP status code
- **code**: Error code constant from `ERROR_CODES`
- **isOperational**: Whether error is expected/operational
- **details**: Optional additional context

### Error Classes

| Class | Status | Description |
|-------|--------|-------------|
| **ValidationError** | 400 | For validation failures, supports Zod errors |
| **BadRequestError** | 400 | For malformed requests |
| **UnauthorizedError** | 401 | For authentication failures |
| **ForbiddenError** | 403 | For authorization failures |
| **NotFoundError** | 404 | For missing resources |
| **TimeoutError** | 408 | For request timeouts |
| **ConflictError** | 409 | For resource conflicts |
| **InternalServerError** | 500 | For unexpected errors |
| **DatabaseError** | 500 | For database operation failures |

## Error Codes

Reference `server/src/constants/error-codes.ts` for standardized error codes organized by category:

- **VALIDATION_*** - validation errors
- **AUTH_*** - authentication/authorization errors
- **RESOURCE_*** - resource errors
- **DB_*** - database errors
- **BUSINESS_*** - business logic errors
- **TENANT_*** - tenant errors
- **SYSTEM_*** - system errors

## Usage Patterns

### In Route Handlers

```typescript
import { asyncHandler } from '../../utils/async-handler';

// Wrap all async route handlers
router.get('/items', 
  authenticateToken,
  asyncHandler(validateTenant),
  attachTenantContext,
  asyncHandler(controller.getAll.bind(controller))
);

// Or use BaseRouter's ah() helper
this.ah(this.controller, 'getAll')
```

### In Controllers

```typescript
import { NotFoundError, ValidationError, ForbiddenError } from '../../types';
import { BaseController } from '../../utils/base';

class MyController extends BaseController {
  async getById(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context');
    
    const item = await this.model.getItem(req.tenantId, req.params.id);
    this.ensureResourceExists(item, 'Item'); // Throws NotFoundError if null
    
    res.json(item);
  }
  
  async create(req: AuthenticatedRequest, res: Response) {
    // Validate with Zod - throws ValidationError on failure
    const data = this.validateZodSchema(schema, req.body);
    
    const item = await this.model.createItem(req.tenantId, data);
    res.status(201).json(item);
  }
}
```

### In Models

```typescript
import { ValidationError, ConflictError, AppError } from '../../types';
import { handleDatabaseError } from '../../utils/database-errors';

class MyModel {
  async createItem(tenantId: string, data: InsertItem): Promise<Item> {
    // Business logic validation
    if (!data.name || data.name.trim().length === 0) {
      throw new ValidationError('Item name is required', {
        name: 'Name cannot be empty'
      });
    }
    
    try {
      return await db.transaction(async (tx) => {
        const [item] = await tx.insert(items).values(data).returning();
        return item;
      });
    } catch (error) {
      // Re-throw AppError instances
      if (error instanceof AppError) throw error;
      // Transform database errors to user-friendly errors
      handleDatabaseError(error);
    }
  }
  
  async deleteItem(tenantId: string, id: string): Promise<boolean> {
    // Check business constraints
    const hasStock = await this.checkStock(tenantId, id);
    if (hasStock) {
      throw new ConflictError('Cannot delete item with existing stock');
    }
    
    // Use wrapDatabaseOperation for automatic error handling
    return await this.wrapDatabaseOperation(() => 
      db.delete(items).where(eq(items.id, id))
    );
  }
}
```

### In Middleware

```typescript
import { UnauthorizedError, ForbiddenError } from '../types';

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    throw new UnauthorizedError('Access token required');
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    throw new UnauthorizedError('Invalid token');
  }
};
```

## Error Response Format

All errors return a consistent JSON structure:

```json
{
  "success": false,
  "error": {
    "message": "Vendor not found",
    "code": "RESOURCE_NOT_FOUND",
    "statusCode": 404,
    "details": { /* optional additional context */ }
  },
  "requestId": "abc123xyz"
}
```

Validation errors include field-level details:

```json
{
  "success": false,
  "error": {
    "message": "Validation failed",
    "code": "VALIDATION_FAILED",
    "statusCode": 400,
    "details": {
      "fields": {
        "email": "Invalid email format",
        "name": "Name is required"
      }
    }
  },
  "requestId": "abc123xyz"
}
```

## Error Logging

Errors are logged with structured context from `server/src/utils/error-logger.ts`:

- **ERROR level**: 5xx errors, non-operational errors
- **WARN level**: Operational errors
- **INFO level**: 4xx client errors

Logged context includes:
- requestId, userId, tenantId
- HTTP method, path, query, params
- IP address, user agent
- Sanitized request body (sensitive fields redacted)
- Stack trace (in development or for ERROR level)

## Database Error Handling

The `handleDatabaseError` utility in `server/src/utils/database-errors.ts` transforms database-specific errors:

- **23505** (unique_violation) → ConflictError
- **23503** (foreign_key_violation) → BadRequestError
- **23502** (not_null_violation) → ValidationError
- **22P02** (invalid_text_representation) → BadRequestError
- **42P01** (undefined_table) → DatabaseError
- Connection/timeout errors → DatabaseError

## Safety Middleware

Applied globally in `server/index.ts`:

1. **Request ID Tracking** (`attachRequestId`): Adds unique ID to each request for tracing
2. **Request Timeout** (`requestTimeout`): Prevents hanging requests (default 30s, configurable via REQUEST_TIMEOUT_MS)
3. **Input Sanitization** (`sanitizeInputs`): Prevents injection attacks by sanitizing body, query, and params

## Process-Level Protection

The server handles critical failures gracefully:

```typescript
process.on('uncaughtException', (error) => {
  logError(error, { path: 'uncaughtException' });
  initiateShutdown(1); // Graceful shutdown with 10s timeout
});

process.on('unhandledRejection', (reason) => {
  logError(error, { path: 'unhandledRejection' });
  initiateShutdown(1);
});

process.on('SIGTERM', () => initiateShutdown(0));
process.on('SIGINT', () => initiateShutdown(0));
```

## Best Practices

1. **Always use asyncHandler**: Wrap all async route handlers and middleware
2. **Throw, don't return**: Throw custom errors instead of returning error responses
3. **Use specific error classes**: Choose the most appropriate error class for the situation
4. **Include context**: Provide helpful error messages and details
5. **Validate early**: Check business constraints before database operations
6. **Use transactions**: Wrap related operations in transactions for atomicity
7. **Re-throw AppError**: In try-catch blocks, re-throw AppError instances
8. **Handle database errors**: Use handleDatabaseError for database-specific errors
9. **Sanitize logs**: Never log sensitive data (passwords, tokens, etc.)
10. **Test error paths**: Verify error handling works as expected

## Testing Error Handling

Refer to `ERROR_HANDLING_VERIFICATION.md` for comprehensive test scenarios and verification checklist.

## Modules with Error Handling

All 18 modules implement robust error handling:
- auth, bank-accounts, crates, dashboard, expenses
- items, ledgers, payments, purchase-invoices, retailers
- sales-invoices, sales-payments, stock, tenants, users
- vendors, whatsapp, public

## Related Files

- `server/src/utils/async-handler.ts` - Async error wrapper
- `server/src/types/index.ts` - Custom error classes
- `server/src/constants/error-codes.ts` - Error code constants
- `server/src/utils/error-logger.ts` - Structured error logging
- `server/src/utils/database-errors.ts` - Database error transformation
- `server/src/middleware/auth.ts` - Authentication/authorization middleware
- `server/src/middleware/timeout.ts` - Request timeout middleware
- `server/src/middleware/sanitization.ts` - Input sanitization middleware
- `server/src/middleware/request-id.ts` - Request ID tracking middleware
- `server/index.ts` - Global error handler and process-level handlers#   F r u i t S t a n d - B a c k e n d  
 #   F r u i t S t a n d - B a c k e n d  
 