import { Request, Response } from 'express';
import { z } from 'zod';
import schema from '../../../shared/schema.js';

const { insertCrateTransactionSchema } = schema;
import { BaseController } from '../../utils/base';
import { CrateModel } from './model';
import { type AuthenticatedRequest, ForbiddenError, BadRequestError } from '../../types';

const crateValidation = {
  getCrateTransactionsPaginated: z.object({
    page: z.string().optional().transform(val => val ? parseInt(val, 10) : undefined),
    limit: z.string().optional().transform(val => val ? parseInt(val, 10) : undefined),
    search: z.string().optional(),
    type: z.enum(['given', 'received', 'returned']).optional(),
    partyType: z.enum(['retailer', 'vendor']).optional(),
    retailerId: z.string().uuid().optional(),
    vendorId: z.string().uuid().optional(),
    dateFrom: z.string().optional().refine(val => {
      if (!val) return true;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format for dateFrom'),
    dateTo: z.string().optional().refine(val => {
      if (!val) return true;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format for dateTo'),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    paginated: z.string().optional()
  })
};

export class CrateController extends BaseController {
  private crateModel: CrateModel;

  constructor() {
    super();
    this.crateModel = new CrateModel();
  }

  async getAll(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validationResult = crateValidation.getCrateTransactionsPaginated.safeParse(req.query);
    if (!validationResult.success) {
      throw new BadRequestError('Invalid query parameters');
    }
    const options = validationResult.data;
    
    // Check if this should return all transactions or paginated
    if (options.paginated !== 'true') {
      const allTransactions = await this.crateModel.getCrateTransactions(tenantId);
      return res.json(allTransactions);
    }
    
    const result = await this.crateModel.getCrateTransactionsPaginated(tenantId, options);
    
    return this.sendPaginatedResponse(res, result.data, result.pagination);
  }

  async getByRetailer(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { retailerId } = req.params;
    this.validateUUID(retailerId, 'Retailer ID');

    const transactions = await this.crateModel.getCrateTransactionsByRetailer(tenantId, retailerId);
    // Strip retailer and vendor fields to match original response format
    const responseTransactions = transactions.map(({ retailer, vendor, ...tx }) => tx);
    res.json(responseTransactions);
  }

  async getByVendor(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { vendorId } = req.params;
    this.validateUUID(vendorId, 'Vendor ID');

    const transactions = await this.crateModel.getCrateTransactionsByVendor(tenantId, vendorId);
    // Strip retailer and vendor fields to match original response format
    const responseTransactions = transactions.map(({ retailer, vendor, ...tx }) => tx);
    res.json(responseTransactions);
  }

  async create(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Inject tenantId into request body before validation
    const validatedData = this.validateZodSchema(insertCrateTransactionSchema, { ...req.body, tenantId });
    
    // Ensure transactionDate is a Date object
    const transactionData = {
      ...validatedData,
      transactionDate: typeof validatedData.transactionDate === 'string' 
        ? new Date(validatedData.transactionDate) 
        : validatedData.transactionDate
    };
    
    const transaction = await this.wrapDatabaseOperation(() =>
      this.crateModel.createCrateTransaction(tenantId, transactionData)
    );
    
    // Strip retailer and vendor fields to match original response format
    const { retailer, vendor, ...responseTx } = transaction;
    res.status(201).json(responseTx);
  }
}