import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { IncomingHttpHeaders } from "http";
import {
  AuthUser as BaseAuthUser,
  UserRole,
  UnauthorizedError,
  ForbiddenError
} from '../../types';
import { ERROR_CODES } from '../../constants/error-codes';
import { ROLE_PERMISSIONS } from '../../../shared/permissions';

// -----------------------------
// JWT Secrets
// -----------------------------
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production');
}

export const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "your-refresh-secret-key";

// -----------------------------
// AuthUser
// -----------------------------
export interface AuthUser extends BaseAuthUser {
  id: string;
  username: string;
  role: UserRole;
  tenantId: string;
  tokenVersion?: number;
}


// Inside src/modules/auth/controller.ts

export class AuthController {
  // Example methods
  login(req: Request, res: Response) {
    res.send("Login logic here");
  }

  logout(req: Request, res: Response) {
    res.send("Logout logic here");
  }

  refreshToken(req: Request, res: Response) {
    res.send("Refresh token logic here");
  }

  getCurrentUser(req: Request, res: Response) {
    res.send("Get current user logic here");
  }

  switchTenant(req: Request, res: Response) {
    res.send("Switch tenant logic here");
  }
}

// -----------------------------
// AuthenticatedRequest
// -----------------------------
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  tenantId?: string;
  tenant?: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    settings: unknown;
    createdAt: Date;
  };
  headers: IncomingHttpHeaders;
}

// -----------------------------
// JWT Payloads
// -----------------------------
export interface AuthTokenPayload extends AuthUser {}
export interface RefreshTokenPayload {
  id: string;
  username: string;
  tenantId: string;
  tokenVersion: number;
}

// -----------------------------
// Sign / Verify Tokens
// -----------------------------
export const signToken = (payload: AuthTokenPayload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });

export const signRefreshToken = (payload: RefreshTokenPayload) =>
  jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: "7d" });

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as RefreshTokenPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Refresh token expired', ERROR_CODES.AUTH_TOKEN_EXPIRED);
    }
    throw new UnauthorizedError('Invalid refresh token', ERROR_CODES.AUTH_TOKEN_INVALID);
  }
};

// -----------------------------
// Middleware: Authenticate JWT
// -----------------------------
export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) throw new UnauthorizedError('Access token required');

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Token expired', ERROR_CODES.AUTH_TOKEN_EXPIRED);
    }
    throw new UnauthorizedError('Invalid token', ERROR_CODES.AUTH_TOKEN_INVALID);
  }
};

// -----------------------------
// Role / Permission Middleware
// -----------------------------
export const requireRole = (roles: UserRole[]) => async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user || !roles.includes(req.user.role)) {
    throw new ForbiddenError('Insufficient permissions');
  }
  next();
};

export const requirePermission = (permissions: (keyof typeof ROLE_PERMISSIONS)[]) => async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) throw new UnauthorizedError('Authentication required');

  const { UserModel } = await import('../users/model');
  const userModel = new UserModel();
  const user = await userModel.getUserForAuth(req.user.id);

  if (!user) throw new ForbiddenError('User not found');

  const userPermissions = user.permissions.length
    ? user.permissions
    : ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS];

  const hasPermission = permissions.some(permission => userPermissions.includes(permission as any));
  if (!hasPermission) throw new ForbiddenError('Insufficient permissions');

  next();
};

// -----------------------------
// Tenant Middleware
// -----------------------------
export const validateTenant = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (req.tenant) {
    if (!req.tenant.isActive)
      throw new ForbiddenError('Account access is temporarily suspended');
    return next();
  }

  if (!req.user?.tenantId) throw new ForbiddenError('No tenant context found');

  const { TenantModel } = await import('../tenants/model');
  const tenant = await TenantModel.getTenant(req.user.tenantId);

  if (!tenant || !tenant.isActive)
    throw new ForbiddenError('Account access is temporarily suspended');

  req.tenant = tenant;
  next();
};

export const attachTenantContext = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (req.tenant) {
    req.tenantId = req.tenant.id;
    return next();
  }

  if (!req.user?.tenantId) throw new ForbiddenError('No tenant context found');

  req.tenantId = req.user.tenantId;
  next();
};
