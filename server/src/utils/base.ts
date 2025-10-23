import { Request, Response, NextFunction, Router } from "express";
import schema from '../../shared/schema.js';

type PaginationOptions = typeof schema.PaginationOptions;
type PaginationMetadata = typeof schema.PaginationMetadata;
type PaginatedResult<T> = typeof schema.PaginatedResult<T>;
import { ValidationError, NotFoundError, BadRequestError } from "../types";
import { handleDatabaseError } from "./database-errors";
import { asyncHandler } from "./async-handler";
import { z } from "zod";

// Base Controller class for common CRUD operations
export class BaseController {
  
  // Success response formatting
  protected sendSuccess(res: Response, data: any, message?: string, statusCode: number = 200) {
    const response: any = { data };
    if (message) response.message = message;
    return res.status(statusCode).json(response);
  }

  // Paginated response formatting
  protected sendPaginatedResponse(res: Response, data: any[], pagination: PaginationMetadata) {
    const response: PaginatedResult<any> = {
      data,
      pagination
    };
    return res.json(response);
  }

  // Extract pagination options from query parameters
  protected getPaginationOptions(query: any): PaginationOptions {
    return {
      page: parseInt(query.page) || 1,
      limit: parseInt(query.limit) || 10,
      search: query.search || "",
      sortBy: query.sortBy || "createdAt",
      sortOrder: (query.sortOrder === "desc" ? "desc" : "asc") as "asc" | "desc"
    };
  }

  // Calculate pagination metadata
  protected calculatePagination(total: number, page: number, limit: number): PaginationMetadata {
    const totalPages = Math.ceil(total / limit);
    return {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1
    };
  }

  // Sanitize UUID fields in request data
  protected sanitizeUUIDs(data: any, uuidFields: string[]): any {
    const sanitizedData = { ...data };
    
    for (const field of uuidFields) {
      if (sanitizedData[field]) {
        try {
          sanitizedData[field] = this.sanitizeAndValidateUUID(sanitizedData[field], field);
        } catch (error) {
          // Re-throw with better context
          if (error instanceof ValidationError) {
            throw new ValidationError(`Validation failed for field '${field}'`, error.fields);
          }
          throw error;
        }
      }
    }
    
    return sanitizedData;
  }

  // Validate data with Zod schema and throw ValidationError if fails
  protected validateZodSchema<T>(schema: z.ZodSchema<T>, data: any): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      // Create detailed error message with field-specific errors
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach(error => {
        const path = error.path.join('.');
        fieldErrors[path] = error.message;
      });
      
      throw new ValidationError("Validation failed", fieldErrors);
    }
    return result.data;
  }

  // Ensure resource exists, throw NotFoundError if not
  protected ensureResourceExists(resource: any, resourceName: string): void {
    if (!resource) {
      throw new NotFoundError(resourceName);
    }
  }

  // Sanitize and validate UUID format
  protected sanitizeAndValidateUUID(id: string, fieldName: string = 'ID'): string {
    if (!id) {
      throw new ValidationError(`${fieldName} is required`, {
        [fieldName.toLowerCase().replace(/\s+/g, '_')]: `${fieldName} is required`
      });
    }

    // Sanitize common UUID corruption patterns
    let sanitizedId = id.toString().trim();
    
    // Remove duplicate segments (like 'c7e2'c7e2' -> 'c7e2')
    const uuidPattern = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;
    const match = sanitizedId.match(uuidPattern);
    if (match) {
      sanitizedId = match[1];
    }
    
    // Validate the sanitized UUID
    const uuidSchema = z.string().uuid();
    const result = uuidSchema.safeParse(sanitizedId);
    if (!result.success) {
      const fieldKey = fieldName.toLowerCase().replace(/\s+/g, '_');
      throw new ValidationError(`Invalid ${fieldName} format`, {
        [fieldKey]: `Invalid UUID format for ${fieldName}. Received: "${id}", Expected: valid UUID format (e.g., "123e4567-e89b-12d3-a456-426614174000")`
      });
    }
    
    return sanitizedId;
  }

  // Validate UUID format (legacy method - kept for compatibility)
  protected validateUUID(id: string, fieldName: string = 'ID'): void {
    this.sanitizeAndValidateUUID(id, fieldName);
  }

  // Wrap database operations with error handling
  protected async wrapDatabaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      handleDatabaseError(error);
    }
  }
}

// Base Router class for common route patterns
export class BaseRouter {
  protected router: Router;

  constructor() {
    this.router = Router();
  }

  // Get the configured router
  public getRouter(): Router {
    return this.router;
  }

  // Helper method to bind and wrap controller methods with asyncHandler
  protected ah<T extends object>(controllerOrHandler: T | ((req: Request, res: Response, next: NextFunction) => Promise<any>), method?: keyof T & string) {
    // If it's a function (arrow function method), wrap it directly
    if (typeof controllerOrHandler === 'function') {
      return asyncHandler(controllerOrHandler as (req: Request, res: Response, next: NextFunction) => Promise<any>);
    }
    
    // If it's a controller instance with method name, bind and wrap
    if (method) {
      // @ts-ignore
      return asyncHandler((controllerOrHandler[method] as any).bind(controllerOrHandler));
    }
    
    throw new Error('Invalid arguments: provide either a function or controller with method name');
  }

  // Apply middleware to all routes
  protected applyMiddleware(middleware: any) {
    this.router.use(middleware);
  }

  // Setup common route patterns
  protected setupCrudRoutes(basePath: string, controller: any) {
    this.router.get(`${basePath}`, this.ah(controller, 'getAll'));
    this.router.get(`${basePath}/:id`, this.ah(controller, 'getById'));
    this.router.post(`${basePath}`, this.ah(controller, 'create'));
    this.router.put(`${basePath}/:id`, this.ah(controller, 'update'));
    this.router.delete(`${basePath}/:id`, this.ah(controller, 'delete'));
  }

  // Setup paginated list route
  protected setupPaginatedRoute(path: string, controller: any, method: string = "getAll") {
    this.router.get(path, this.ah(controller, method));
  }
}

// Utility functions for common operations
export class RouteUtils {
  
  // Build SQL WHERE clause from filters
  static buildWhereClause(filters: any, allowedFields: string[]): string {
    const conditions: string[] = [];
    
    Object.keys(filters).forEach(key => {
      if (allowedFields.includes(key) && filters[key] !== undefined) {
        conditions.push(`${key} = $${key}`);
      }
    });
    
    return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  }

  // Build SQL ORDER BY clause
  static buildOrderByClause(sortBy: string, sortOrder: string, allowedFields: string[]): string {
    if (allowedFields.includes(sortBy)) {
      return `ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;
    }
    return `ORDER BY created_at DESC`;
  }

  // Build SQL LIMIT/OFFSET clause for pagination
  static buildPaginationClause(page: number, limit: number): string {
    const offset = (page - 1) * limit;
    return `LIMIT ${limit} OFFSET ${offset}`;
  }

  // Validate required fields in request body
  static validateRequired(body: any, requiredFields: string[]): string[] {
    const missing: string[] = [];
    requiredFields.forEach(field => {
      if (!body[field]) {
        missing.push(field);
      }
    });
    return missing;
  }
}