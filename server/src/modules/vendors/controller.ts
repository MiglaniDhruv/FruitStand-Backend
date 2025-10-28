import { Request, Response } from "express";
import { z } from "zod";
import { BaseController } from "../../utils/base";
import { VendorModel } from "./model";
import { PaymentModel } from "../payments/model";
import { AuthenticatedRequest, NotFoundError, ValidationError, BadRequestError, ForbiddenError } from "../../types";
import schema from '../../../shared/schema.js';

const { insertVendorSchema, insertVendorPaymentSchema } = schema;
import { whatsAppService } from "../../services/whatsapp";

export class VendorController extends BaseController {
  private vendorModel: VendorModel;
  private paymentModel: PaymentModel;

  constructor() {
    super();
    this.vendorModel = new VendorModel();
    this.paymentModel = new PaymentModel();
  }



  async getAll(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Check if pagination is requested
    const isPaginated = req.query.page || req.query.limit || req.query.paginated === 'true';
    
    if (!isPaginated) {
      // Return original array response for backward compatibility
      const vendors = await this.vendorModel.getVendors(tenantId);
      res.json(vendors);
      return;
    }

    // Use base controller utilities for pagination parsing
    const opts = {
      ...this.getPaginationOptions(req.query),
      status: req.query.status as string | undefined
    };
    
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
    const validSortFields = ['name', 'createdAt'];
    if (opts.sortBy && !validSortFields.includes(opts.sortBy)) {
      throw new BadRequestError("Invalid sortBy field");
    }
    
    const result = await this.vendorModel.getVendorsPaginated(tenantId, opts);
    
    this.sendPaginatedResponse(res, result.data, result.pagination);
  }

  async getById(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const vendor = await this.vendorModel.getVendor(tenantId, req.params.id);
    this.ensureResourceExists(vendor, "Vendor");
    
    res.json(vendor);
  }

  async create(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const vendorData = this.validateZodSchema(insertVendorSchema, { ...req.body, tenantId });
    const vendor = await this.vendorModel.createVendor(tenantId, vendorData);
    
    res.status(201).json(vendor);
  }

  async update(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const vendorData = this.validateZodSchema(insertVendorSchema.partial(), { ...req.body, tenantId });
    const vendor = await this.vendorModel.updateVendor(tenantId, req.params.id, vendorData);
    
    this.ensureResourceExists(vendor, "Vendor");
    
    res.json(vendor);
  }

  async delete(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const success = await this.wrapDatabaseOperation(() => 
      this.vendorModel.deleteVendor(tenantId, req.params.id)
    );
    if (!success) {
      throw new NotFoundError("Vendor");
    }
    res.json({ message: "Vendor deleted successfully" });
  }

  async recordPayment(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const vendorId = req.params.id;

    const validatedData = this.validateZodSchema(insertVendorPaymentSchema, req.body);

    // Extract payment data without vendorId (it's passed separately)
    const { vendorId: _, ...rest } = validatedData;
    
    // Ensure proper typing for the model method
    const paymentData = {
      ...rest,
      paymentDate: typeof rest.paymentDate === 'string' ? new Date(rest.paymentDate) : rest.paymentDate,
      paymentMode: rest.paymentMode as string
    };

    const result = await this.paymentModel.recordVendorPayment(tenantId, vendorId, paymentData);

    // Send WhatsApp notifications for each created payment
    for (const payment of result.paymentsCreated) {
      try {
        await whatsAppService.sendPaymentNotification(tenantId, payment.id, 'purchase');
      } catch (error) {
        console.error('WhatsApp notification failed:', error);
      }
    }

    res.status(201).json(result);
  }

  async getOutstandingInvoices(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const vendorId = req.params.id;

    this.validateUUID(vendorId, 'Vendor ID');

    const invoices = await this.paymentModel.getOutstandingInvoicesForVendor(tenantId, vendorId);
    res.json(invoices);
  }

  async toggleFavourite(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    if (!id) throw new BadRequestError('Vendor ID is required');
    
    const vendor = await this.vendorModel.toggleFavourite(tenantId, id);
    this.ensureResourceExists(vendor, 'Vendor');
    
    res.json(vendor);
  }
}