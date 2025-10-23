import { Request, Response } from "express";
import { z } from "zod";
import { BaseController } from "../../utils/base";
import { ItemModel } from "./model";
import { AuthenticatedRequest, ForbiddenError, BadRequestError, NotFoundError, ValidationError } from "../../types";
import schema from '../../../shared/schema.js';

const { insertItemSchema } = schema;

const itemValidation = {
  getItemsPaginated: z.object({
    page: z.string().optional().transform(val => val ? parseInt(val, 10) : 1),
    limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 10),
    search: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    paginated: z.string().optional().transform(val => val === 'true'),
    isActive: z.enum(['true', 'false']).optional()
  })
};

export class ItemController extends BaseController {
  private itemModel: ItemModel;

  constructor() {
    super();
    this.itemModel = new ItemModel();
  }

  async getAll(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Validate query parameters
    const validationResult = itemValidation.getItemsPaginated.safeParse(req.query);
    if (!validationResult.success) {
      throw new ValidationError('Invalid query parameters', validationResult.error);
    }
    const validatedQuery = validationResult.data;
    const { isActive } = validatedQuery;
    
    // Check if pagination is requested
    const isPaginated = req.query.paginated === 'false' ? false : 
      (req.query.page || req.query.limit || req.query.paginated === 'true');
    
    if (!isPaginated) {
      // Return original array response for backward compatibility
      const items = await this.itemModel.getItems(tenantId, isActive);
      res.json(items);
      return;
    }

    // Use base controller utilities for pagination parsing
    const opts = this.getPaginationOptions(req.query);
    
    // Override default sort to preserve legacy behavior (name instead of createdAt)
    if (!req.query.sortBy) {
      opts.sortBy = 'name';
    }
    
    // Validate pagination parameters (with defaults from getPaginationOptions)
    const page = opts.page || 1;
    const limit = opts.limit || 10;
    
    if (page < 1) {
      throw new BadRequestError("Page must be >= 1");
    }
    
    if (limit < 1 || limit > 100) {
      throw new BadRequestError("Limit must be between 1 and 100");
    }
    
    // Validate sortBy if provided
    const validSortFields = ['name', 'quality', 'unit', 'createdAt'];
    if (opts.sortBy && !validSortFields.includes(opts.sortBy)) {
      throw new BadRequestError("Invalid sortBy field");
    }
    
    const result = await this.itemModel.getItemsPaginated(tenantId, { ...opts, isActive });
    
    res.json(result);
  }

  async getByVendor(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Validate query parameters
    const validationResult = itemValidation.getItemsPaginated.safeParse(req.query);
    if (!validationResult.success) {
      throw new ValidationError('Invalid query parameters', validationResult.error);
    }
    const validatedQuery = validationResult.data;
    const { isActive } = validatedQuery;
    
    this.validateUUID(req.params.vendorId, 'Vendor ID');
    const vendorId = req.params.vendorId;
    
    const items = await this.itemModel.getItemsByVendor(tenantId, vendorId, isActive);
    res.json(items);
  }

  async getById(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    this.validateUUID(req.params.id, 'Item ID');
    const itemId = req.params.id;
    
    const item = await this.itemModel.getItem(tenantId, itemId);
    this.ensureResourceExists(item, 'Item');
    
    res.json(item);
  }

  async create(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const itemData = this.validateZodSchema(insertItemSchema, { ...req.body, tenantId });
    const item = await this.wrapDatabaseOperation(() => 
      this.itemModel.createItem(tenantId, itemData)
    );
    
    res.status(201).json(item);
  }

  async update(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    this.validateUUID(req.params.id, 'Item ID');
    const itemId = req.params.id;
    
    const itemData = this.validateZodSchema(insertItemSchema.partial(), { ...req.body, tenantId });
    const item = await this.wrapDatabaseOperation(() =>
      this.itemModel.updateItem(tenantId, itemId, itemData)
    );
    
    this.ensureResourceExists(item, 'Item');
    
    res.json(item);
  }

  async delete(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    this.validateUUID(req.params.id, 'Item ID');
    const itemId = req.params.id;
    
    const result = await this.wrapDatabaseOperation(() =>
      this.itemModel.deleteItem(tenantId, itemId)
    );
    
    if (!result.success) {
      if (result.error) {
        throw new BadRequestError(result.error);
      }
      throw new NotFoundError("Item not found");
    }
    
    res.json({ message: "Item deleted successfully" });
  }
}