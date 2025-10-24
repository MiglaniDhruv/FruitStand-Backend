import { Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import twilio from 'twilio';
const { validateRequest } = twilio;
import { BaseController } from '../../utils/base';
import { AuthenticatedRequest, ForbiddenError, BadRequestError, NotFoundError } from '../../types';
import { WhatsAppMessageModel } from './model';
import { WhatsAppCreditModel } from './credit-model';
import { whatsAppService } from '../../services/whatsapp';
import { InvoiceShareLinkModel } from '../invoice-share-links/model';
import { TenantModel } from '../tenants/model';

// Define request body types
interface SendInvoiceBody {
  invoiceId: string;
}

interface SendPaymentReminderBody {
  invoiceId: string;
  invoiceType: 'sales' | 'purchase';
}

interface SendPaymentNotificationBody {
  paymentId: string;
  paymentType: 'sales' | 'purchase';
}

interface MessageHistoryQuery {
  page?: string;
  limit?: string;
  status?: string;
  messageType?: string;
  recipientType?: string;
  search?: string;
}

interface MessagesByReferenceQuery {
  referenceType: string;
  referenceId: string;
}

interface PreviewMessageBody {
  messageType: 'sales_invoice' | 'purchase_invoice' | 'payment_reminder' | 'payment_notification';
  referenceId: string;
  invoiceType?: 'sales' | 'purchase';
  paymentType?: 'sales' | 'purchase';
}

export class WhatsAppController extends BaseController {
  private whatsAppMessageModel: WhatsAppMessageModel;

  constructor() {
    super();
    this.whatsAppMessageModel = new WhatsAppMessageModel();
  }

  /**
   * Send sales invoice via WhatsApp
   */
  sendSalesInvoice = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Validate request body using BaseController method
    const { invoiceId } = this.validateZodSchema(z.object({
      invoiceId: z.string().uuid('Invalid invoice ID format')
    }), (req as any).body);
    
    // Consumes 1 WhatsApp credit. Returns 403 if insufficient credits.
    const result = await whatsAppService.sendSalesInvoice(tenantId, invoiceId);
    
    res.status(200).json({
      success: true,
      message: 'Sales invoice sent via WhatsApp successfully',
      data: result,
      creditWarning: result.creditMetadata?.lowCreditWarning ? 'Credit balance is low' : undefined,
      remainingCredits: result.creditMetadata?.remainingCredits
    });
  };

  /**
   * Send purchase invoice via WhatsApp
   */
  sendPurchaseInvoice = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Validate request body using BaseController method
    const { invoiceId } = this.validateZodSchema(z.object({
      invoiceId: z.string().uuid('Invalid invoice ID format')
    }), (req as any).body);
    
    // Consumes 1 WhatsApp credit. Returns 403 if insufficient credits.
    const result = await whatsAppService.sendPurchaseInvoice(tenantId, invoiceId);
    
    res.status(200).json({
      success: true,
      message: 'Purchase invoice sent via WhatsApp successfully',
      data: result,
      creditWarning: result.creditMetadata?.lowCreditWarning ? 'Credit balance is low' : undefined,
      remainingCredits: result.creditMetadata?.remainingCredits
    });
  };

  /**
   * Send payment reminder via WhatsApp
   */
  sendPaymentReminder = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Validate request body using BaseController method
    const { invoiceId, invoiceType } = this.validateZodSchema(z.object({
      invoiceId: z.string().uuid('Invalid invoice ID format'),
      invoiceType: z.enum(['sales', 'purchase'], { 
        errorMap: () => ({ message: 'Invoice type must be either "sales" or "purchase"' })
      })
    }), (req as any).body);
    
    // Consumes 1 WhatsApp credit. Returns 403 if insufficient credits.
    const result = await whatsAppService.sendPaymentReminder(tenantId, invoiceId, invoiceType);
    
    res.status(200).json({
      success: true,
      message: 'Payment reminder sent via WhatsApp successfully',
      data: result,
      creditWarning: result.creditMetadata?.lowCreditWarning ? 'Credit balance is low' : undefined,
      remainingCredits: result.creditMetadata?.remainingCredits
    });
  };

  /**
   * Send payment notification via WhatsApp
   */
  sendPaymentNotification = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Validate request body using BaseController method
    const { paymentId, paymentType } = this.validateZodSchema(z.object({
      paymentId: z.string().uuid('Invalid payment ID format'),
      paymentType: z.enum(['sales', 'purchase'], {
        errorMap: () => ({ message: 'Payment type must be either "sales" or "purchase"' })
      })
    }), (req as any).body);
    
    // Consumes 1 WhatsApp credit. Returns 403 if insufficient credits.
    const result = await whatsAppService.sendPaymentNotification(tenantId, paymentId, paymentType);
    
    res.status(200).json({
      success: true,
      message: 'Payment notification sent via WhatsApp successfully',
      data: result,
      creditWarning: result.creditMetadata?.lowCreditWarning ? 'Credit balance is low' : undefined,
      remainingCredits: result.creditMetadata?.remainingCredits
    });
  };

  /**
   * Get paginated message history
   */
  getMessageHistory = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Get pagination options from base controller
    const paginationOptions = this.getPaginationOptions((req as any).query);
    
    // Extract optional filters from query
    const { status, messageType, recipientType, search } = (req as any).query;
    
    const filters = {
      ...(status && { status: status as string }),
      ...(messageType && { messageType: messageType as string }),
      ...(recipientType && { recipientType: recipientType as string }),
      ...(search && { search: search as string })
    };
    
    // Get paginated messages
    const result = await WhatsAppMessageModel.getMessagesPaginated(tenantId, {
      ...paginationOptions,
      ...filters
    });
    
    this.sendPaginatedResponse(res, result.data, result.pagination);
  };

  /**
   * Get messages by reference (invoice/payment)
   */
  getMessagesByReference = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Validate query params using BaseController method
    const { referenceType, referenceId } = this.validateZodSchema(z.object({
      referenceType: z.string().min(1, 'Reference type is required'),
      referenceId: z.string().uuid('Invalid reference ID format')
    }), (req as any).query);
    
    // Get messages by reference
    const messages = await WhatsAppMessageModel.getMessagesByReference(
      tenantId, 
      referenceType, 
      referenceId
    );
    
    res.status(200).json({
      success: true,
      data: messages
    });
  };

  /**
   * Preview message content without sending
   */
  previewMessage = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
      
      // Validate request body using BaseController method
      const { messageType, referenceId, invoiceType, paymentType } = this.validateZodSchema(z.object({
        messageType: z.enum(['sales_invoice', 'purchase_invoice', 'payment_reminder', 'payment_notification']),
        referenceId: z.string().uuid('Invalid reference ID format'),
        // For payment reminders, we need to specify invoice type
        invoiceType: z.enum(['sales', 'purchase']).optional(),
        // For payment notifications, we need to specify payment type
        paymentType: z.enum(['sales', 'purchase']).optional()
      }), (req as any).body);
      
      let templateVariables: any;
      let recipientInfo: any;
      let referenceData: any;
      const warnings: string[] = [];
      
      if (messageType === 'sales_invoice') {
        // Mirror logic from sendSalesInvoice method
        const salesInvoiceModel = new (await import('../../modules/sales-invoices/model')).SalesInvoiceModel();
        const invoice = await salesInvoiceModel.getSalesInvoice(tenantId, referenceId);
        
        if (!invoice) {
          throw new Error('Sales invoice not found');
        }
        
        if (!invoice.retailer) {
          throw new Error('Retailer information not found for invoice');
        }
        
        // Fetch tenant details with graceful fallback
        let tenant = null;
        try {
          tenant = await TenantModel.getTenant(tenantId);
        } catch (error) {
          console.warn(`Warning: Failed to fetch tenant details for ${tenantId}:`, error);
        }
        
        // Create or get share link for invoice
        let invoiceToken: string | undefined;
        try {
          const invoiceShareLinkModel = new InvoiceShareLinkModel();
          const shareLink = await invoiceShareLinkModel.createOrGetShareLink(tenantId, referenceId, 'sales');
          invoiceToken = shareLink.token;
        } catch (error) {
          console.warn(`Warning: Failed to create share link for invoice ${referenceId}:`, error);
          warnings.push('Invoice share link could not be generated. The message template will not include a link to the invoice.');
        }
        
        const { buildSalesInvoiceVariables } = await import('../../services/whatsapp/template-builder');
        templateVariables = buildSalesInvoiceVariables(invoice, invoice.retailer, tenant, invoiceToken);
        
        recipientInfo = {
          name: invoice.retailer.name,
          phone: invoice.retailer.phone,
          type: 'retailer'
        };
        
        referenceData = {
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          totalAmount: invoice.totalAmount
        };
        
      } else if (messageType === 'purchase_invoice') {
        // Mirror logic from sendPurchaseInvoice method
        const purchaseInvoiceModel = new (await import('../../modules/purchase-invoices/model')).PurchaseInvoiceModel();
        const invoice = await purchaseInvoiceModel.getPurchaseInvoice(tenantId, referenceId);
        
        if (!invoice) {
          throw new Error('Purchase invoice not found');
        }
        
        if (!(invoice as any).vendor) {
          throw new Error('Vendor information not found for invoice');
        }
        
        // Fetch tenant details with graceful fallback
        let tenant = null;
        try {
          tenant = await TenantModel.getTenant(tenantId);
        } catch (error) {
          console.warn(`Warning: Failed to fetch tenant details for ${tenantId}:`, error);
        }
        
        // Create or get share link for invoice
        let invoiceToken: string | undefined;
        try {
          const invoiceShareLinkModel = new InvoiceShareLinkModel();
          const shareLink = await invoiceShareLinkModel.createOrGetShareLink(tenantId, referenceId, 'purchase');
          invoiceToken = shareLink.token;
        } catch (error) {
          console.warn(`Warning: Failed to create share link for invoice ${referenceId}:`, error);
          warnings.push('Invoice share link could not be generated. The message template will not include a link to the invoice.');
        }
        
        const { buildPurchaseInvoiceVariables } = await import('../../services/whatsapp/template-builder');
        templateVariables = buildPurchaseInvoiceVariables(invoice, (invoice as any).vendor, tenant, invoiceToken);
        
        recipientInfo = {
          name: (invoice as any).vendor.name,
          phone: (invoice as any).vendor.phone,
          type: 'vendor'
        };
        
        referenceData = {
          invoiceNumber: (invoice as any).invoiceNumber,
          invoiceDate: (invoice as any).invoiceDate,
          netAmount: (invoice as any).netAmount
        };
        
      } else if (messageType === 'payment_reminder') {
        // Mirror logic from sendPaymentReminder method
        if (!invoiceType) {
          throw new Error('Invoice type is required for payment reminders');
        }
        
        let invoice: any;
        let recipient: any;
        let recipientType: 'vendor' | 'retailer';
        
        if (invoiceType === 'sales') {
          const salesInvoiceModel = new (await import('../../modules/sales-invoices/model')).SalesInvoiceModel();
          invoice = await salesInvoiceModel.getSalesInvoice(tenantId, referenceId);
          recipient = invoice?.retailer;
          recipientType = 'retailer';
        } else {
          const purchaseInvoiceModel = new (await import('../../modules/purchase-invoices/model')).PurchaseInvoiceModel();
          invoice = await purchaseInvoiceModel.getPurchaseInvoice(tenantId, referenceId);
          recipient = invoice?.vendor;
          recipientType = 'vendor';
        }
        
        if (!invoice) {
          throw new Error(`${invoiceType} invoice not found`);
        }
        
        if (!recipient) {
          throw new Error(`${recipientType} information not found for invoice`);
        }
        
        // Fetch tenant details with graceful fallback
        let tenant = null;
        try {
          tenant = await TenantModel.getTenant(tenantId);
        } catch (error) {
          console.warn(`Warning: Failed to fetch tenant details for ${tenantId}:`, error);
        }
        
        // Create or get share link for invoice
        let invoiceToken: string | undefined;
        try {
          const invoiceShareLinkModel = new InvoiceShareLinkModel();
          const shareInvoiceType = invoiceType === 'sales' ? 'sales' : 'purchase';
          const shareLink = await invoiceShareLinkModel.createOrGetShareLink(tenantId, referenceId, shareInvoiceType);
          invoiceToken = shareLink.token;
        } catch (error) {
          console.warn(`Warning: Failed to create share link for invoice ${referenceId}:`, error);
          warnings.push('Invoice share link could not be generated. The message template will not include a link to the invoice.');
        }
        
        const { buildPaymentReminderVariables } = await import('../../services/whatsapp/template-builder');
        templateVariables = buildPaymentReminderVariables(invoice, recipient, recipientType, tenant, invoiceToken);
        
        recipientInfo = {
          name: recipient.name,
          phone: recipient.phone,
          type: recipientType
        };
        
        referenceData = {
          invoiceNumber: invoice.invoiceNumber,
          udhaaarAmount: invoice.udhaaarAmount
        };
        
      } else if (messageType === 'payment_notification') {
        // Mirror logic from sendPaymentNotification method
        if (!paymentType) {
          throw new Error('Payment type is required for payment notifications');
        }
        
        let payments: any[];
        let recipientType: 'vendor' | 'retailer';
        
        if (paymentType === 'sales') {
          const salesPaymentModel = new (await import('../../modules/sales-payments/model')).SalesPaymentModel();
          payments = await salesPaymentModel.getSalesPayments(tenantId, true) as any[];
          recipientType = 'retailer';
        } else {
          const paymentModel = new (await import('../../modules/payments/model')).PaymentModel();
          payments = await paymentModel.getPayments(tenantId);
          recipientType = 'vendor';
        }
        
        const payment = payments.find(p => p.id === referenceId);
        if (!payment) {
          throw new Error(`${paymentType} payment not found`);
        }
        
        const invoice = payment.invoice;
        const recipient = paymentType === 'sales' ? payment.retailer : payment.vendor;
        
        if (!invoice) {
          throw new Error('Invoice information not found for payment');
        }
        
        if (!recipient) {
          throw new Error(`${recipientType} information not found for payment`);
        }
        
        // Fetch tenant details with graceful fallback
        let tenant = null;
        try {
          tenant = await TenantModel.getTenant(tenantId);
        } catch (error) {
          console.warn(`Warning: Failed to fetch tenant details for ${tenantId}:`, error);
        }
        
        // Create or get share link for invoice
        let invoiceToken: string | undefined;
        try {
          const invoiceShareLinkModel = new InvoiceShareLinkModel();
          const shareInvoiceType = paymentType === 'sales' ? 'sales' : 'purchase';
          const shareLink = await invoiceShareLinkModel.createOrGetShareLink(tenantId, invoice.id, shareInvoiceType);
          invoiceToken = shareLink.token;
        } catch (error) {
          console.warn(`Warning: Failed to create share link for invoice ${invoice.id}:`, error);
          warnings.push('Invoice share link could not be generated. The message template will not include a link to the invoice.');
        }
        
        const { buildPaymentNotificationVariables } = await import('../../services/whatsapp/template-builder');
        templateVariables = buildPaymentNotificationVariables(payment, invoice, recipient, tenant, invoiceToken);
        
        recipientInfo = {
          name: recipient.name,
          phone: recipient.phone,
          type: recipientType
        };
        
        referenceData = {
          paymentAmount: payment.amount,
          paymentDate: payment.paymentDate,
          invoiceNumber: invoice.invoiceNumber
        };
      }
      
      res.status(200).json({
        success: true,
        message: 'Message preview generated successfully',
        data: {
          messageType,
          templateVariables,
          recipientInfo,
          referenceData,
          warnings,
          preview: {
            note: 'This shows the template variables that would be sent to WhatsApp. The actual message format depends on your Twilio WhatsApp template configuration.'
          }
        }
      });
  };


  /**
   * Handle Twilio WhatsApp status webhooks
   */
  handleWebhook = async (req: Request, res: Response) => {
    try {
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!authToken) {
        console.error('TWILIO_AUTH_TOKEN not configured for webhook verification');
        return res.status(500).json({
          success: false,
          message: 'Webhook verification not configured'
        });
      }

      // Get Twilio signature from headers
      const twilioSignature = req.headers['x-twilio-signature'] as string;
      if (!twilioSignature) {
        console.error('Missing Twilio signature in webhook');
        // Still return 200 to prevent Twilio retries
        return res.status(200).json({
          success: false,
          message: 'Missing webhook signature'
        });
      }

      // Verify signature using Twilio SDK
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const isValidSignature = validateRequest(authToken, twilioSignature, url, req.body);

      if (!isValidSignature) {
        console.error('Invalid Twilio webhook signature');
        // Still return 200 to prevent Twilio retries
        return res.status(200).json({
          success: false,
          message: 'Invalid webhook signature'
        });
      }

      // Extract webhook data
      const {
        MessageSid,
        MessageStatus,
        ErrorCode,
        ErrorMessage,
        From,
        To,
        Body,
        Price,
        PriceUnit
      } = req.body;

      if (!MessageSid) {
        console.error('Missing MessageSid in webhook payload');
        return res.status(400).json({
          success: false,
          message: 'Invalid webhook payload'
        });
      }

      console.log('Processing Twilio webhook:', {
        MessageSid,
        MessageStatus,
        ErrorCode,
        From,
        To
      });

      try {
        // Find message by Twilio SID
        const message = await WhatsAppMessageModel.getMessageByTwilioSid(MessageSid);
        
        if (!message) {
          console.warn(`Message not found for Twilio SID: ${MessageSid}`);
          // Still return success - webhook was processed
          return res.status(200).json({
            success: true,
            message: 'Webhook processed (message not found in database)'
          });
        }

        // Map Twilio status to our message status enum
        const mapTwilioStatus = (twilioStatus: string): string => {
          switch (twilioStatus?.toLowerCase()) {
            case 'queued':
            case 'accepted':
              return 'pending';
            case 'sent':
              return 'sent';
            case 'delivered':
              return 'delivered';
            case 'read':
              return 'read';
            case 'failed':
            case 'undelivered':
              return 'failed';
            default:
              return 'unknown';
          }
        };

        // Update message status
        const updateData: any = {
          status: mapTwilioStatus(MessageStatus) || 'unknown',
          updatedAt: new Date()
        };

        // Add error information if present
        if (ErrorCode || ErrorMessage) {
          updateData.errorCode = ErrorCode || null;
          updateData.errorMessage = ErrorMessage || null;
        }

        // Add cost information if present
        if (Price) {
          updateData.cost = Price;
          updateData.costCurrency = PriceUnit ?? null;
        }

        // Set delivery timestamp for delivered/read messages
        if (MessageStatus?.toLowerCase() === 'delivered' || MessageStatus?.toLowerCase() === 'read') {
          updateData.deliveredAt = new Date();
        }

        // Set sent timestamp for sent messages
        if (MessageStatus?.toLowerCase() === 'sent' && !message.sentAt) {
          updateData.sentAt = new Date();
        }

        await WhatsAppMessageModel.updateMessage(message.tenantId, message.id, updateData);

        console.log(`Updated message ${message.id} with status: ${MessageStatus}`);

        res.status(200).json({
          success: true,
          message: 'Webhook processed successfully'
        });

      } catch (dbError: any) {
        console.error('Database error processing webhook:', dbError);
        // Still return success to Twilio - we don't want retries for DB issues
        res.status(200).json({
          success: true,
          message: 'Webhook received (database update failed)'
        });
      }

    } catch (error: any) {
      console.error('Error processing Twilio webhook:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  };

  /**
   * GET /whatsapp/credits - Get current credit balance
   */
  getCreditBalance = async (req: any, res: any) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(400).json({
          success: false,
          message: 'Tenant context not found'
        });
      }

      const creditModel = new WhatsAppCreditModel();
      const balance = await creditModel.getCreditBalance(tenantId);
      const checkResult = await creditModel.checkCreditAvailability(tenantId, 1);

      res.status(200).json({
        success: true,
        data: {
          balance,
          lowCreditWarning: checkResult.lowCreditWarning,
          threshold: checkResult.threshold
        }
      });

    } catch (error: any) {
      console.error('Error fetching credit balance:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch credit balance'
      });
    }
  };
}