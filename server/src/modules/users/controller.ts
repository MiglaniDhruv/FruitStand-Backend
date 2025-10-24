import { Request, Response } from "express";
import { z } from "zod";
import { BaseController } from "../../utils/base";
import { UserModel } from "./model";
import { Permission, ForbiddenError, BadRequestError, NotFoundError } from "../../types";
import schema from '../../../shared/schema.js';
const { insertUserSchema } = schema;

export class UserController extends BaseController {
  private userModel: UserModel;

  constructor() {
    super();
    this.userModel = new UserModel();
  }

  async getAll(req: Request, res: Response) {
    const tenantId = (req as any).tenantId; // still use your tenantId
    if (!tenantId) throw new ForbiddenError('No tenant context found');
    
    const isPaginated = req.query.page || req.query.limit || req.query.paginated === 'true';
    
    if (!isPaginated) {
      const users = await this.userModel.getUsers(tenantId);
      const safeUsers = users.map(({ password, ...user }) => user);
      res.json(safeUsers);
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string;
    const sortBy = req.query.sortBy as string;
    const sortOrder: 'asc' | 'desc' = (req.query.sortOrder as string) === 'desc' ? 'desc' : 'asc';

    if (page < 1) throw new BadRequestError("Page must be >= 1");
    if (limit < 1 || limit > 100) throw new BadRequestError("Limit must be between 1 and 100");

    const validSortFields = ['username', 'name', 'role', 'createdAt'];
    if (sortBy && !validSortFields.includes(sortBy)) throw new BadRequestError("Invalid sortBy field");

    const paginationOptions = { page, limit, search, sortBy, sortOrder };
    const result = await this.userModel.getUsersPaginated(tenantId, paginationOptions);

    const safeData = result.data.map(({ password, ...user }) => user);
    this.sendPaginatedResponse(res, safeData, result.pagination);
  }

  async getById(req: Request, res: Response) {
    const tenantId = (req as any).tenantId;
    if (!tenantId) throw new ForbiddenError('No tenant context found');

    const id = req.params.id;
    this.validateUUID(id, 'User ID');
    const user = await this.userModel.getUser(tenantId, id);
    this.ensureResourceExists(user, "User");

    const { password, ...safeUser } = user!;
    res.json(safeUser);
  }

  async create(req: Request, res: Response) {
    const tenantId = (req as any).tenantId;
    if (!tenantId) throw new ForbiddenError('No tenant context found');

    const userData = this.validateZodSchema(insertUserSchema, { ...req.body, tenantId });
    const user = await this.wrapDatabaseOperation(() =>
      this.userModel.createUser(tenantId, userData)
    );

    const { password, ...safeUser } = user;
    res.status(201).json(safeUser);
  }

  async update(req: Request, res: Response) {
    const tenantId = (req as any).tenantId;
    if (!tenantId) throw new ForbiddenError('No tenant context found');

    const id = req.params.id;
    this.validateUUID(id, 'User ID');

    const userData = this.validateZodSchema(insertUserSchema.partial(), { ...req.body, tenantId });
    const user = await this.wrapDatabaseOperation(() =>
      this.userModel.updateUser(tenantId, id, userData)
    );

    this.ensureResourceExists(user, "User");
    const { password, ...safeUser } = user!;
    res.json(safeUser);
  }

  async delete(req: Request, res: Response) {
    const tenantId = (req as any).tenantId;
    if (!tenantId) throw new ForbiddenError('No tenant context found');

    const id = req.params.id;
    this.validateUUID(id, 'User ID');

    const success = await this.wrapDatabaseOperation(() =>
      this.userModel.deleteUser(tenantId, id)
    );

    if (!success) throw new NotFoundError("User not found in organization");
    res.status(204).send();
  }

  async updatePermissions(req: Request, res: Response) {
    const tenantId = (req as any).tenantId;
    if (!tenantId) throw new ForbiddenError('No tenant context found');

    const id = req.params.id;
    this.validateUUID(id, 'User ID');

    const schema = z.object({ permissions: z.array(z.nativeEnum(Permission)) });
    const { permissions } = this.validateZodSchema(schema, req.body);

    const user = await this.wrapDatabaseOperation(() =>
      this.userModel.updateUserPermissions(tenantId, id, permissions)
    );

    this.ensureResourceExists(user, "User");
    const { password, ...safeUser } = user!;
    res.json(safeUser);
  }
}
