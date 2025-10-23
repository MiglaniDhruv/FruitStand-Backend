import { Request, Response } from "express";
import { z } from "zod";
import { BaseController } from "../../utils/base";
import { UserModel } from "./model";
import { AuthenticatedRequest, Permission, ForbiddenError, BadRequestError, NotFoundError } from "../../types";
import schema from '../../../shared/schema.js';
const { insertUserSchema } = schema;

export class UserController extends BaseController {
  private userModel: UserModel;

  constructor() {
    super();
    this.userModel = new UserModel();
  }

  async getAll(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Check if pagination is requested
    const isPaginated = req.query.page || req.query.limit || req.query.paginated === 'true';
    
    if (!isPaginated) {
      // Return original array response for backward compatibility
      const users = await this.userModel.getUsers(tenantId);
      // Remove passwords from response
      const safeUsers = users.map(({ password, ...user }) => user);
      res.json(safeUsers);
      return;
    }

    // Extract pagination query parameters
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string;
    const sortBy = req.query.sortBy as string;
    const sortOrder: 'asc' | 'desc' = (req.query.sortOrder as string) === 'desc' ? 'desc' : 'asc';
    
    // Validate pagination parameters
    if (page < 1) {
      throw new BadRequestError("Page must be >= 1");
    }
    
    if (limit < 1 || limit > 100) {
      throw new BadRequestError("Limit must be between 1 and 100");
    }
    
    // Validate sortBy if provided
    const validSortFields = ['username', 'name', 'role', 'createdAt'];
    if (sortBy && !validSortFields.includes(sortBy)) {
      throw new BadRequestError("Invalid sortBy field");
    }
    
    const paginationOptions = { page, limit, search, sortBy, sortOrder };
    const result = await this.userModel.getUsersPaginated(tenantId, paginationOptions);
    
    // Remove passwords from response
    const safeData = result.data.map(({ password, ...user }) => user);
    
    this.sendPaginatedResponse(res, safeData, result.pagination);
  }

  async getById(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    this.validateUUID(req.params.id, 'User ID');
    const user = await this.userModel.getUser(tenantId, req.params.id);
    this.ensureResourceExists(user, "User");
    
    // Remove password from response
    const { password, ...safeUser } = user!;
    res.json(safeUser);
  }

  async create(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const userData = this.validateZodSchema(insertUserSchema, { ...req.body, tenantId });
    const user = await this.wrapDatabaseOperation(() =>
      this.userModel.createUser(tenantId, userData)
    );
    
    // Remove password from response
    const { password, ...safeUser } = user;
    res.status(201).json(safeUser);
  }

  async update(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    this.validateUUID(req.params.id, 'User ID');
    const userData = this.validateZodSchema(insertUserSchema.partial(), { ...req.body, tenantId });
    const user = await this.wrapDatabaseOperation(() =>
      this.userModel.updateUser(tenantId, req.params.id, userData)
    );
    
    this.ensureResourceExists(user, "User");
    
    // Remove password from response
    const { password, ...safeUser } = user!;
    res.json(safeUser);
  }

  async delete(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    this.validateUUID(req.params.id, 'User ID');
    const success = await this.wrapDatabaseOperation(() =>
      this.userModel.deleteUser(tenantId, req.params.id)
    );
    
    if (!success) {
      throw new NotFoundError("User not found in organization");
    }
    
    res.status(204).send();
  }

  async updatePermissions(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    this.validateUUID(req.params.id, 'User ID');
    const schema = z.object({ permissions: z.array(z.nativeEnum(Permission)) });
    const { permissions } = this.validateZodSchema(schema, req.body);
    
    const user = await this.wrapDatabaseOperation(() =>
      this.userModel.updateUserPermissions(tenantId, req.params.id, permissions)
    );
    
    this.ensureResourceExists(user, "User");
    
    // Remove password from response
    const { password, ...safeUser } = user!;
    res.json(safeUser);
  }
}