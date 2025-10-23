import { Request, Response } from 'express';
import { BaseController } from '../../utils/base';
import { AuthModel } from './model';
import { TenantModel } from '../tenants/model';
import { signToken, signRefreshToken, verifyRefreshToken, type AuthTokenPayload, type RefreshTokenPayload } from '../../middleware/auth';
import { type AuthenticatedRequest, UserRole, ValidationError, NotFoundError, UnauthorizedError, ForbiddenError, BadRequestError, InternalServerError } from '../../types';
import schema from '../../../shared/schema.js';

const { loginSchema, refreshTokenSchema } = schema;

export class AuthController extends BaseController {
  private authModel: AuthModel;

  constructor() {
    super();
    this.authModel = new AuthModel();
  }

  async login(req: Request, res: Response) {
    // Validate request body
    const { username, password } = this.validateZodSchema(loginSchema, req.body);
    const authReq = req as AuthenticatedRequest;

    // Check if a slug was provided but tenant context is missing
    if ((authReq as any).slugProvided && (!authReq.tenant || !authReq.tenantId)) {
      throw new NotFoundError('Tenant');
    }

    // Handle case where tenant object exists but tenantId is missing
    if (authReq.tenant && !authReq.tenantId) {
      throw new BadRequestError('Invalid tenant context');
    }

    // Check for tenant context from slug middleware
    if (authReq.tenant && authReq.tenantId) {
      // Tenant-specific login (/{slug}/login)
      console.log(`Tenant-specific login attempt for user ${username} in tenant ${authReq.tenant.slug}`);

      const authResult = await this.authModel.authenticateUserWithTenant(username, password, authReq.tenantId);
      
      if (!authResult.success) {
        if (authResult.error === 'USER_NOT_IN_TENANT') {
          throw new ForbiddenError('User not authorized for this tenant');
        }
        if (authResult.error === 'TENANT_INACTIVE') {
          throw new ForbiddenError('Account access is temporarily suspended');
        }
        throw new UnauthorizedError('Invalid username or password');
      }

      const user = authResult.user!;

      // Validate user role conforms to UserRole enum
      const validRoles = Object.values(UserRole);
      if (!validRoles.includes(user.role as UserRole)) {
        console.error(`Invalid role for user ${user.id}: ${user.role}`);
        throw new InternalServerError('User has invalid role configuration');
      }

      // Generate JWT access token with tenant context
      const tokenPayload: AuthTokenPayload = {
        id: user.id,
        username: user.username,
        role: user.role as UserRole,
        tenantId: authReq.tenantId
      };
      
      const token = signToken(tokenPayload);

      // Generate refresh token
      const refreshTokenPayload: RefreshTokenPayload = {
        id: user.id,
        username: user.username,
        tenantId: authReq.tenantId,
        tokenVersion: 1
      };
      
      const refreshToken = signRefreshToken(refreshTokenPayload);

      // Set refresh token as HttpOnly cookie
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      console.log(`Successful tenant login for user ${username} in tenant ${authReq.tenant.slug}`);

      return res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          tenantId: authReq.tenantId,
          permissions: user.permissions
        }
      });
    } else {
      // No tenant context - require tenant for all logins in tenant-only system
      throw new BadRequestError('Tenant context required');
    }
  }

  async logout(req: Request, res: Response) {
    // Clear refresh token cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    // Log the logout action for audit purposes
    const authReq = req as AuthenticatedRequest;
    if (authReq.user) {
      console.log(`User ${authReq.user.username} logged out at ${new Date().toISOString()}`);
    }

    res.json({
      message: 'Logged out successfully'
    });
  }

  async getCurrentUser(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    
    if (!authReq.user) {
      throw new UnauthorizedError('No authenticated user found');
    }

    // Get fresh user data from database
    const user = await this.authModel.getUserForToken(authReq.user.id);
    
    if (!user) {
      throw new NotFoundError('User');
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        permissions: user.permissions
      }
    });
  }

  async refreshToken(req: Request, res: Response) {
    // Get refresh token from HttpOnly cookie
    const refreshToken = req.cookies.refreshToken;
    
    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token not found');
    }

    // Verify refresh token
    let refreshPayload: RefreshTokenPayload;
    try {
      refreshPayload = verifyRefreshToken(refreshToken);
    } catch (error) {
      // Clear invalid refresh token cookie
      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
      });
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Validate user still exists
    const userExists = await this.authModel.validateUserExists(refreshPayload.id);
    
    if (!userExists) {
      // Clear refresh token cookie for non-existent user
      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
      });
      throw new UnauthorizedError('User no longer exists');
    }

    // Get fresh user data
    const user = await this.authModel.getUserForToken(refreshPayload.id);
    
    if (!user) {
      throw new NotFoundError('User');
    }

    // Validate tenant status before issuing new access token
    const tenant = await TenantModel.getTenant(user.tenantId);
    if (!tenant || !tenant.isActive) {
      throw new ForbiddenError('Account access is temporarily suspended');
    }

    // Validate user role conforms to UserRole enum
    const validRoles = Object.values(UserRole);
    if (!validRoles.includes(user.role as UserRole)) {
      console.error(`Invalid role for user ${user.id}: ${user.role}`);
      throw new InternalServerError('User has invalid role configuration');
    }

    // Generate new access token
    const tokenPayload: AuthTokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role as UserRole,
      tenantId: user.tenantId
    };
    
    const token = signToken(tokenPayload);

    // Return new access token and user data
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        permissions: user.permissions
      }
    });
  }

  async switchTenant(req: AuthenticatedRequest, res: Response) {
    const { tenantId } = req.body;

    if (!tenantId) {
      throw new BadRequestError('Tenant ID is required');
    }

    if (!req.user) {
      throw new UnauthorizedError('User not authenticated');
    }

    // Verify the tenant exists and is active
    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant');
    }

    if (!tenant.isActive) {
      throw new ForbiddenError('Tenant is not active');
    }

    // In tenant-only system, users can only access their own tenant
    // Remove tenant switching capability as each user belongs to one tenant
    throw new ForbiddenError('Tenant switching not available');
  }
}