import { Request, Response } from "express";
import { z } from "zod";
import { BaseController } from "../../utils/base";
import { StockModel } from "./model";
import { AuthenticatedRequest, ForbiddenError, BadRequestError } from "../../types";
import schema from '../../../shared/schema.js';

const { insertStockSchema, insertStockMovementSchema } = schema;

export class StockController extends BaseController {
  private stockModel: StockModel;

  constructor() {
    super();
    this.stockModel = new StockModel();
  }

  async getAll(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Check if pagination is requested (match legacy behavior)
    const isPaginated = req.query.paginated === 'true';
    
    if (!isPaginated) {
      // Return original array response for backward compatibility
      const stock = await this.stockModel.getStock(tenantId);
      res.json(stock);
      return;
    }

    // Use base controller utilities for pagination parsing
    const opts = this.getPaginationOptions(req.query);
    
    // Override default sort to preserve legacy behavior (lastUpdated instead of createdAt)
    if (!req.query.sortBy) {
      opts.sortBy = 'lastUpdated';
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
    const validSortFields = ['itemName', 'vendorName', 'quantityInCrates', 'quantityInBoxes', 'quantityInKgs', 'lastUpdated'];
    if (opts.sortBy && !validSortFields.includes(opts.sortBy)) {
      throw new BadRequestError("Invalid sortBy field");
    }
    
    // Add special filters for stock
    const stockOptions = {
      ...opts,
      search: req.query.search as string,
      lowStock: req.query.lowStock === 'true'
    };
    
    const result = await this.stockModel.getStockPaginated(tenantId, stockOptions);
    
    // Match legacy response format
    this.sendPaginatedResponse(res, result.data, result.pagination);
  }

  async updateStock(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    this.validateUUID(req.params.itemId, 'Item ID');
    const itemId = req.params.itemId;
    
    const stockData = this.validateZodSchema(insertStockSchema.partial(), { ...req.body, tenantId });
    const stock = await this.wrapDatabaseOperation(() =>
      this.stockModel.updateStock(tenantId, itemId, stockData)
    );
    
    res.json(stock);
  }

  async getMovements(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const movements = await this.stockModel.getStockMovements(tenantId);
    res.json(movements);
  }

  async getMovementsByItem(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    this.validateUUID(req.params.itemId, 'Item ID');
    const itemId = req.params.itemId;
    
    const movements = await this.stockModel.getStockMovementsByItem(tenantId, itemId);
    res.json(movements);
  }

  async getAvailableOutEntriesByVendor(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    this.validateUUID(req.params.vendorId, 'Vendor ID');
    const vendorId = req.params.vendorId;
    
    const entries = await this.stockModel.getAvailableStockOutEntriesByVendor(tenantId, vendorId);
    res.json(entries);
  }

  async createMovement(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedData = this.validateZodSchema(insertStockMovementSchema, { ...req.body, tenantId });
    
    // Ensure movementDate is a Date object
    const movementData = {
      ...validatedData,
      movementDate: typeof validatedData.movementDate === 'string' 
        ? new Date(validatedData.movementDate) 
        : validatedData.movementDate
    };
    
    const movement = await this.wrapDatabaseOperation(() =>
      this.stockModel.createStockMovement(tenantId, movementData)
    );
    
    res.status(201).json(movement);
  }

  async calculateBalance(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    this.validateUUID(req.params.itemId, 'Item ID');
    const itemId = req.params.itemId;
    
    const balance = await this.stockModel.calculateStockBalance(tenantId, itemId);
    res.json(balance);
  }
}