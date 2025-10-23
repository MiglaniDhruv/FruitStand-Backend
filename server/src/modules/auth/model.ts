import bcrypt from 'bcrypt';
import { UserModel } from '../users/model';
import { TenantModel } from '../tenants/model';
import type { User } from '../../../shared/schema.js';

export interface AuthenticationResult {
  success: boolean;
  user?: Omit<User, 'password'>;
  error?: 'INVALID_CREDENTIALS' | 'TENANT_INACTIVE' | 'USER_NOT_IN_TENANT';
}

export class AuthModel {
  private userModel: UserModel;

  constructor() {
    this.userModel = new UserModel();
  }

  async authenticateUser(username: string, password: string): Promise<AuthenticationResult> {
    // Get user by username without tenant filtering (for authentication)
    const user = await this.userModel.getUserByUsernameForAuth(username);
    
    if (!user) {
      return { success: false, error: 'INVALID_CREDENTIALS' };
    }

    // Verify password using bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return { success: false, error: 'INVALID_CREDENTIALS' };
    }

    // Validate tenant status
    const tenant = await TenantModel.getTenant(user.tenantId);
    if (!tenant || !tenant.isActive) {
      return { success: false, error: 'TENANT_INACTIVE' };
    }

    // Return user data without password
    const { password: _, ...userWithoutPassword } = user;
    return { success: true, user: userWithoutPassword };
  }

  async getUserForToken(userId: string): Promise<Omit<User, 'password'> | null> {
    // Get user data for token generation/refresh without tenant filtering
    const user = await this.userModel.getUserForAuth(userId);
    
    if (!user) {
      return null;
    }

    // Return user data without password
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async validateUserExists(userId: string): Promise<boolean> {
    // Validate user exists for token refresh without tenant filtering
    const user = await this.userModel.getUserForAuth(userId);
    return !!user;
  }

  async authenticateUserWithTenant(username: string, password: string, tenantId: string): Promise<AuthenticationResult> {
    // Get user by username without tenant filtering first
    const user = await this.userModel.getUserByUsernameForAuth(username);
    
    if (!user) {
      return { success: false, error: 'INVALID_CREDENTIALS' };
    }

    // Verify password using bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return { success: false, error: 'INVALID_CREDENTIALS' };
    }

    // Validate that user belongs to the specified tenant
    if (user.tenantId !== tenantId) {
      return { success: false, error: 'USER_NOT_IN_TENANT' };
    }

    // Validate tenant status
    const tenant = await TenantModel.getTenant(user.tenantId);
    if (!tenant || !tenant.isActive) {
      return { success: false, error: 'TENANT_INACTIVE' };
    }

    // Return user data without password
    const { password: _, ...userWithoutPassword } = user;
    return { success: true, user: userWithoutPassword };
  }

  // Helper method to validate user-tenant relationships
  private async validateUserTenantRelationship(userId: string, tenantId: string): Promise<boolean> {
    const user = await this.userModel.getUserForAuth(userId);
    return user?.tenantId === tenantId;
  }
}