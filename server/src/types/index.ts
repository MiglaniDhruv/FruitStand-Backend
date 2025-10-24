// src/types/index.ts

import type { Request } from "express";
import schema from "../../shared/schema.js";
import { ERROR_CODES, type ErrorCode } from "../constants/error-codes";
import { ZodError } from "zod";

// Tenant type from your schema
export type Tenant = typeof schema.tenants.$inferSelect;

// Authentication related types
export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  name: string;
  permissions: string[];
}

// Role enum
export enum UserRole {
  ADMIN = "Admin",
  OPERATOR = "Operator",
  ACCOUNTANT = "Accountant",
}


export interface BankAccount1 {
  id: string;
  name: string;
  accountNumber: string;
  bankName: string;
  balance: number;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}

// Authenticated request with generics for Express

export interface AuthenticatedRequest<
  P = any,
  ResBody = any,
  ReqBody = any,
  ReqQuery = any
> extends Request<P, ResBody, ReqBody, ReqQuery> {
  user?: AuthUser;
  tenantId?: string;
  tenant?: Tenant;
  requestId?: string;
  slugProvided?: boolean;
}


// Common API response structures
export interface ApiResponse<T = any> {
  data?: T;
  message?: string;
  error?: string;
}

export interface ApiErrorResponse {
  message: string;
  code?: ErrorCode;
  error?: string;
  errors?: any;
}

// Permissions enum
export enum Permission {
  // User management
  MANAGE_USERS = "manage_users",
  VIEW_USERS = "view_users",

  // Vendor management
  MANAGE_VENDORS = "manage_vendors",
  VIEW_VENDORS = "view_vendors",
  DELETE_VENDORS = "delete_vendors",

  // Item management
  MANAGE_ITEMS = "manage_items",
  VIEW_ITEMS = "view_items",
  DELETE_ITEMS = "delete_items",

  // Purchase Invoices
  CREATE_PURCHASE_INVOICES = "create_purchase_invoices",
  VIEW_PURCHASE_INVOICES = "view_purchase_invoices",
  EDIT_PURCHASE_INVOICES = "edit_purchase_invoices",
  DELETE_PURCHASE_INVOICES = "delete_purchase_invoices",

  // Payments
  CREATE_PAYMENTS = "create_payments",
  VIEW_PAYMENTS = "view_payments",
  EDIT_PAYMENTS = "edit_payments",
  DELETE_PAYMENTS = "delete_payments",

  // Stock management
  MANAGE_STOCK = "manage_stock",
  VIEW_STOCK = "view_stock",

  // Financial Reports & Ledgers
  VIEW_LEDGERS = "view_ledgers",
  VIEW_CASHBOOK = "view_cashbook",
  VIEW_BANKBOOK = "view_bankbook",

  // Bank Accounts
  MANAGE_BANK_ACCOUNTS = "manage_bank_accounts",
  VIEW_BANK_ACCOUNTS = "view_bank_accounts",

  // System Settings
  MANAGE_SETTINGS = "manage_settings",
  VIEW_SETTINGS = "view_settings",

  // Dashboard & Analytics
  VIEW_DASHBOARD = "view_dashboard",
  VIEW_ANALYTICS = "view_analytics",
}

// Request/Response interfaces for common operations
export interface ListRequest {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface CreateRequest<T> {
  data: T;
}

export interface UpdateRequest<T> {
  id: string;
  data: Partial<T>;
}

export interface DeleteRequest {
  id: string;
}

// Filter interfaces
export interface DateFilter {
  startDate?: string;
  endDate?: string;
}

export interface StatusFilter {
  status?: string;
}

export interface VendorFilter {
  vendorId?: string;
}

export interface RetailerFilter {
  retailerId?: string;
}

// Enhanced error infrastructure
export class AppError extends Error {
  public statusCode: number;
  public code: ErrorCode;
  public isOperational: boolean;
  public details?: any;

  constructor(
    message: string,
    statusCode: number,
    code: ErrorCode,
    isOperational: boolean = true,
    details?: any
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  public fields?: Record<string, string>;

  constructor(
    message: string = "Validation failed",
    fieldsOrZodError?: Record<string, string> | ZodError
  ) {
    super(message, 400, ERROR_CODES.VALIDATION_FAILED, true);
    this.name = "ValidationError";

    if (fieldsOrZodError instanceof ZodError) {
      this.fields = {};
      fieldsOrZodError.errors.forEach((error) => {
        const path = error.path.join(".");
        this.fields![path] = error.message;
      });
      this.details = { fields: this.fields };
    } else if (fieldsOrZodError) {
      this.fields = fieldsOrZodError;
      this.details = { fields: this.fields };
    }
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = "Resource") {
    super(`${resource} not found`, 404, ERROR_CODES.RESOURCE_NOT_FOUND, true);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message: string = "Unauthorized access",
    code: ErrorCode = ERROR_CODES.AUTH_UNAUTHORIZED
  ) {
    super(message, 401, code, true);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Insufficient permissions") {
    super(message, 403, ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS, true);
    this.name = "ForbiddenError";
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = "Bad request") {
    super(message, 400, ERROR_CODES.VALIDATION_FAILED, true);
    this.name = "BadRequestError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Resource conflict") {
    super(message, 409, ERROR_CODES.RESOURCE_CONFLICT, true);
    this.name = "ConflictError";
  }
}

export class DatabaseError extends AppError {
  public originalError?: Error;

  constructor(message: string = "Database error", originalError?: Error) {
    super(message, 500, ERROR_CODES.DB_QUERY_ERROR, false);
    this.name = "DatabaseError";
    this.originalError = originalError;
    this.details = { originalError: originalError?.message };
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = "Internal server error") {
    super(message, 500, ERROR_CODES.SYSTEM_INTERNAL_ERROR, false);
    this.name = "InternalServerError";
  }
}

export class TimeoutError extends AppError {
  constructor(message: string = "Request timeout") {
    super(message, 408, ERROR_CODES.REQUEST_TIMEOUT, true);
    this.name = "TimeoutError";
  }
}
