import { Request, Response } from 'express';
import { z } from 'zod';
import { BaseController } from '../../utils/base';
import { RetailerModel } from './model';
import { SalesPaymentModel } from '../sales-payments/model';
import schema from '../../../shared/schema.js';

const { insertRetailerSchema, insertRetailerPaymentSchema } = schema;
import { type AuthenticatedRequest, NotFoundError, ValidationError, BadRequestError, ForbiddenError } from '../../types';
import { whatsAppService } from '../../services/whatsapp';

export class RetailerController extends BaseController {
  private retailerModel: RetailerModel;
  private salesPaymentModel: SalesPaymentModel;

  constructor() {
    super();
    this.retailerModel = new RetailerModel();
    this.salesPaymentModel = new SalesPaymentModel();
  }

  async getAll(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { 
      page, 
      limit, 
      search, 
      sortBy, 
      sortOrder,
      status,
      paginated
    } = req.query;

    // Validate sortBy parameter
    const validSortFields = ['name', 'phone', 'createdAt'];
    const sortByValue = typeof sortBy === 'string' && validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortOrderValue = sortOrder === 'asc' ? 'asc' : 'desc';

    // Check if pagination is requested using the paginated flag
    const doPaginate = paginated === 'true';

    if (doPaginate) {
      // Return paginated response
      const options = {
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 10,
        search: search as string,
        sortBy: sortByValue,
        sortOrder: sortOrderValue as 'asc' | 'desc',
        status: status as string
      };

      const result = await this.retailerModel.getRetailersPaginated(tenantId, options);
      return this.sendPaginatedResponse(res, result.data, result.pagination);
    } else {
      // Return non-paginated response for backward compatibility
      const retailers = await this.retailerModel.getRetailers(tenantId);
      res.json(retailers);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    if (!id) throw new BadRequestError('Retailer ID is required');

    const retailer = await this.retailerModel.getRetailer(tenantId, id);
    this.ensureResourceExists(retailer, 'Retailer');

    res.json(retailer);
  }

  async create(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const retailerData = this.validateZodSchema(insertRetailerSchema, { ...req.body, tenantId });
    
    const retailer = await this.retailerModel.createRetailer(tenantId, retailerData);
    
    res.status(201).json(retailer);
  }

  async update(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    if (!id) throw new BadRequestError('Retailer ID is required');

    const retailerData = this.validateZodSchema(insertRetailerSchema.partial(), { ...req.body, tenantId });
    
    const retailer = await this.retailerModel.updateRetailer(tenantId, id, retailerData);
    this.ensureResourceExists(retailer, 'Retailer');

    res.json(retailer);
  }

  async delete(req: AuthenticatedRequest, res: Response) {
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

  async recordPayment(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const retailerId = req.params.id;

    const validatedData = this.validateZodSchema(insertRetailerPaymentSchema, req.body);

    // Extract payment data without retailerId (it's passed separately)
    const { retailerId: _, ...rest } = validatedData;
    
    // Ensure proper typing for the model method
    const paymentData = {
      ...rest,
      paymentDate: typeof rest.paymentDate === 'string' ? new Date(rest.paymentDate) : rest.paymentDate,
      paymentMode: rest.paymentMode as string
    };

    const result = await this.salesPaymentModel.recordRetailerPayment(tenantId, retailerId, paymentData);

    // Send WhatsApp notifications for each created payment
    for (const payment of result.paymentsCreated) {
      try {
        await whatsAppService.sendPaymentNotification(tenantId, payment.id, 'sales');
      } catch (error) {
        console.error('WhatsApp notification failed:', error);
      }
    }

    res.status(201).json(result);
  }

  async getOutstandingInvoices(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const retailerId = req.params.id;

    this.validateUUID(retailerId, 'Retailer ID');

    const invoices = await this.salesPaymentModel.getOutstandingInvoicesForRetailer(tenantId, retailerId);
    res.json(invoices);
  }

  async getStats(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const stats = await this.retailerModel.getRetailerStats(tenantId);
    res.json(stats);
  }

  async toggleFavourite(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    if (!id) throw new BadRequestError('Retailer ID is required');
    
    const retailer = await this.retailerModel.toggleFavourite(tenantId, id);
    this.ensureResourceExists(retailer, 'Retailer');
    
    res.json(retailer);
  }
}