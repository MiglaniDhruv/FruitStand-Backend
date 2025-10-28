import { Request, Response } from 'express';
import { BaseController } from '../../utils/base';
import { PaymentModel } from './model';
import schema from '../../../shared/schema.js';

const { insertPaymentSchema } = schema;
import { type AuthenticatedRequest, ForbiddenError, BadRequestError, NotFoundError } from '../../types';
import { whatsAppService } from '../../services/whatsapp/index.js';

export class PaymentController extends BaseController {
  private paymentModel: PaymentModel;

  constructor() {
    super();
    this.paymentModel = new PaymentModel();
  }

  async getAll(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const payments = await this.paymentModel.getPayments(tenantId);
    res.json(payments);
  }

  async getByInvoice(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { invoiceId } = req.params;
    if (!invoiceId) {
      throw new BadRequestError('Invoice ID is required');
    }

    const payments = await this.paymentModel.getPaymentsByInvoice(tenantId, invoiceId);
    res.json(payments);
  }

  async create(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedData = this.validateZodSchema(insertPaymentSchema, req.body);
    
    // Ensure paymentDate is a Date object
    const paymentData = {
      ...validatedData,
      paymentDate: typeof validatedData.paymentDate === 'string' 
        ? new Date(validatedData.paymentDate) 
        : validatedData.paymentDate
    };
    
    const payment = await this.wrapDatabaseOperation(() =>
      this.paymentModel.createPayment(tenantId, paymentData)
    );
    
    // Attempt to send WhatsApp payment notification (non-blocking)
    try {
      await whatsAppService.sendPaymentNotification(tenantId, payment.id, 'purchase');
      console.log(`✅ WhatsApp payment notification sent for purchase payment ${payment.id}`);
    } catch (whatsappError: any) {
      // Log error but don't fail the payment creation
      console.error(`⚠️ Failed to send WhatsApp notification for purchase payment ${payment.id}:`, whatsappError.message);
      // Optionally, you could add a flag to the response indicating notification failed
    }
    
    res.status(201).json(payment);
  }

  async deletePayment(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    if (!id) throw new BadRequestError('Payment ID is required');
    this.validateUUID(id, 'Payment ID');

    const success = await this.wrapDatabaseOperation(() => 
      this.paymentModel.deletePayment(tenantId, id)
    );
    
    if (!success) throw new NotFoundError('Payment not found');
    
    res.status(204).send();
  }
}