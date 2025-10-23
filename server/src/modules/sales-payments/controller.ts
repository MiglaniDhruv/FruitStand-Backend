import { Request, Response } from 'express';
import schema from '../../../shared/schema.js';

const { insertSalesPaymentSchema } = schema;
import { BaseController } from '../../utils/base';
import { SalesPaymentModel } from './model';
import { type AuthenticatedRequest, ForbiddenError, BadRequestError, NotFoundError, ValidationError } from '../../types';
import { whatsAppService } from '../../services/whatsapp/index.js';

export class SalesPaymentController extends BaseController {
  private salesPaymentModel: SalesPaymentModel;

  constructor() {
    super();
    this.salesPaymentModel = new SalesPaymentModel();
  }

  async getSalesPayments(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const includeDetails = req.query.includeDetails === 'true';
    const salesPayments = await this.salesPaymentModel.getSalesPayments(tenantId, includeDetails);
    res.json(salesPayments);
  }

  async getSalesPaymentsByInvoice(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { invoiceId } = req.params;
    if (!invoiceId) {
      throw new BadRequestError('Invoice ID is required');
    }

    const includeDetails = req.query.includeDetails === 'true';
    const salesPayments = await this.salesPaymentModel.getSalesPaymentsByInvoice(tenantId, invoiceId, includeDetails);
    res.json(salesPayments);
  }

  async createSalesPayment(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Sanitize UUID fields before validation
    const uuidFields = ['invoiceId', 'retailerId', 'bankAccountId'];
    const sanitizedBody = this.sanitizeUUIDs(req.body, uuidFields);
    
    const validatedData = this.validateZodSchema(insertSalesPaymentSchema, sanitizedBody);
    
    // Additional business validation
    if (['Bank Transfer', 'UPI', 'Cheque'].includes(validatedData.paymentMode)) {
      if (!validatedData.bankAccountId) {
        throw new ValidationError('Bank account is required for non-cash payments', {
          bankAccountId: 'Bank account ID is required for Bank Transfer, UPI, and Cheque payments'
        });
      }
    }
    
    // Ensure paymentDate is a Date object
    const paymentData = {
      ...validatedData,
      paymentDate: typeof validatedData.paymentDate === 'string' 
        ? new Date(validatedData.paymentDate) 
        : validatedData.paymentDate
    };
    
    const salesPayment = await this.wrapDatabaseOperation(() =>
      this.salesPaymentModel.createSalesPayment(tenantId, paymentData)
    );
    
    // Attempt to send WhatsApp payment notification (non-blocking)
    try {
      await whatsAppService.sendPaymentNotification(tenantId, salesPayment.id, 'sales');
      console.log(`✅ WhatsApp payment notification sent for sales payment ${salesPayment.id}`);
    } catch (whatsappError: any) {
      // Log error but don't fail the payment creation
      console.error(`⚠️ Failed to send WhatsApp notification for sales payment ${salesPayment.id}:`, whatsappError.message);
      // Optionally, you could add a flag to the response indicating notification failed
    }
    
    res.status(201).json(salesPayment);
  }

  async deleteSalesPayment(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    if (!id) throw new BadRequestError('Payment ID is required');
    this.validateUUID(id, 'Payment ID');

    const success = await this.wrapDatabaseOperation(() => 
      this.salesPaymentModel.deleteSalesPayment(tenantId, id)
    );
    
    if (!success) throw new NotFoundError('Sales payment not found');
    
    res.status(204).send();
  }
}