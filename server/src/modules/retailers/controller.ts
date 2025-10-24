import { Request, Response } from 'express';
import { z } from 'zod';
import { BaseController } from '../../utils/base';
import { RetailerModel } from './model';
import { SalesPaymentModel } from '../sales-payments/model';
import schema from '../../../shared/schema.js';
import { NotFoundError, ValidationError, BadRequestError, ForbiddenError } from '../../types';
import { whatsAppService } from '../../services/whatsapp';

const { insertRetailerSchema, insertRetailerPaymentSchema } = schema;

export class RetailerController extends BaseController {
  private retailerModel: RetailerModel;
  private salesPaymentModel: SalesPaymentModel;

  constructor() {
    super();
    this.retailerModel = new RetailerModel();
    this.salesPaymentModel = new SalesPaymentModel();
  }

  async getAll(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { page, limit, search, sortBy, sortOrder, status, paginated } = req.query;

    const validSortFields = ['name', 'phone', 'createdAt'];
    const sortByValue = typeof sortBy === 'string' && validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortOrderValue = sortOrder === 'asc' ? 'asc' : 'desc';
    const doPaginate = paginated === 'true';

    if (doPaginate) {
      const options = {
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 10,
        search: search as string,
        sortBy: sortByValue,
        sortOrder: sortOrderValue as 'asc' | 'desc',
        status: status as string
      };

      const result = await this.retailerModel.getRetailersPaginated(tenantId, options);

      // ✅ Ensure all pagination fields are required for TypeScript
      const pagination = {
        page: result.pagination.page ?? 1,
        limit: result.pagination.limit ?? 10,
        total: result.pagination.total ?? 0,
        totalPages: result.pagination.totalPages ?? 1,
        hasNext: result.pagination.hasNext ?? false,
        hasPrevious: result.pagination.hasPrevious ?? false
      };

      return this.sendPaginatedResponse(res, result.data, pagination);
    } else {
      const retailers = await this.retailerModel.getRetailers(tenantId);
      res.json(retailers);
    }
  }

  async getById(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    if (!id) throw new BadRequestError('Retailer ID is required');

    const retailer = await this.retailerModel.getRetailer(tenantId, id);
    this.ensureResourceExists(retailer, 'Retailer');

    res.json(retailer);
  }

  async create(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const retailerData = this.validateZodSchema(insertRetailerSchema, { ...req.body, tenantId });
    const retailer = await this.retailerModel.createRetailer(tenantId, retailerData);
    
    res.status(201).json(retailer);
  }

  async update(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    if (!id) throw new BadRequestError('Retailer ID is required');

    const retailerData = this.validateZodSchema(insertRetailerSchema.partial(), { ...req.body, tenantId });
    const retailer = await this.retailerModel.updateRetailer(tenantId, id, retailerData);
    this.ensureResourceExists(retailer, 'Retailer');

    res.json(retailer);
  }

  async delete(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    if (!id) throw new BadRequestError('Retailer ID is required');

    const success = await this.wrapDatabaseOperation(() => 
      this.retailerModel.deleteRetailer(tenantId, id)
    );
    
    if (!success) throw new NotFoundError('Retailer');

    return res.status(204).send();
  }

  async recordPayment(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const retailerId = req.params.id;

    const validatedData = this.validateZodSchema(insertRetailerPaymentSchema, req.body);

    // Ensure amount exists
    if (!validatedData.amount) {
      throw new BadRequestError('Payment amount is required');
    }

    const paymentData = {
      ...validatedData,
      paymentDate: typeof validatedData.paymentDate === 'string' ? new Date(validatedData.paymentDate) : validatedData.paymentDate,
      amount: validatedData.amount, // required
      paymentMode: validatedData.paymentMode as string
    };

    const result = await this.salesPaymentModel.recordRetailerPayment(tenantId, retailerId, paymentData);

    for (const payment of result.paymentsCreated) {
      try {
        await whatsAppService.sendPaymentNotification(tenantId, payment.id, 'sales');
      } catch (error) {
        console.error('WhatsApp notification failed:', error);
      }
    }

    res.status(201).json(result);
  }

  async getOutstandingInvoices(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const retailerId = req.params.id;

    this.validateUUID(retailerId, 'Retailer ID');

    const invoices = await this.salesPaymentModel.getOutstandingInvoicesForRetailer(tenantId, retailerId);
    res.json(invoices);
  }

  async getStats(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const stats = await this.retailerModel.getRetailerStats(tenantId);
    res.json(stats);
  }

  async toggleFavourite(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    if (!id) throw new BadRequestError('Retailer ID is required');
    
    const retailer = await this.retailerModel.toggleFavourite(tenantId, id);
    this.ensureResourceExists(retailer, 'Retailer');
    
    res.json(retailer);
  }
}
