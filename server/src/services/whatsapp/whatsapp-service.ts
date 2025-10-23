import { getTwilioClient } from './client.js';
import { whatsappConfig, templateMapping, type MessageType } from './config.js';
import { formatPhoneForWhatsApp, isValidPhone } from './phone-formatter.js';
import {
  buildSalesInvoiceVariables,
  buildPurchaseInvoiceVariables,
  buildPaymentReminderVariables,
  buildPaymentNotificationVariables
} from './template-builder.js';
import { TenantModel } from '../../modules/tenants/model.js';
import { WhatsAppMessageModel } from '../../modules/whatsapp/model.js';
import { SalesInvoiceModel } from '../../modules/sales-invoices/model.js';
import { PurchaseInvoiceModel } from '../../modules/purchase-invoices/model.js';
import { PaymentModel } from '../../modules/payments/model.js';
import { SalesPaymentModel } from '../../modules/sales-payments/model.js';
import { InvoiceShareLinkModel } from '../../modules/invoice-share-links/model.js';

interface CreditCheck {
  allowed: boolean;
  reason?: string;
  currentBalance?: number;
  lowCreditWarning?: boolean;
  threshold?: number;
}

interface SendMessageParams {
  tenantId: string;
  recipientPhone: string;
  messageType: MessageType;
  templateVariables: any;
  referenceType: string;
  referenceId: string;
  referenceNumber: string;
  recipientType: 'vendor' | 'retailer';
  recipientId: string;
}

export class WhatsAppService {
  /**
   * Create or get share link and return token
   */
  private async createInvoiceShareLink(tenantId: string, invoiceId: string, invoiceType: 'sales' | 'purchase'): Promise<string | undefined> {
    try {
      const invoiceShareLinkModel = new InvoiceShareLinkModel();
      const shareLink = await invoiceShareLinkModel.createOrGetShareLink(tenantId, invoiceId, invoiceType);
      return shareLink.token;
    } catch (error) {
      console.warn(`Warning: Failed to create share link for invoice ${invoiceId}:`, error);
      return undefined;
    }
  }

  /**
   * Check if tenant can send messages based on credits
   */
  async checkTenantCredits(tenantId: string, creditsRequired: number = 1): Promise<CreditCheck> {
    try {
      const whatsappSettings = await TenantModel.getWhatsAppSettings(tenantId);
      
      if (!whatsappSettings.enabled) {
        return { allowed: false, reason: 'WhatsApp messaging is not enabled for this tenant' };
      }
      
      const result = await TenantModel.checkCreditAvailability(tenantId, creditsRequired);
      
      if (!result.hasCredits) {
        return { 
          allowed: false, 
          reason: result.reason,
          currentBalance: result.currentBalance,
          lowCreditWarning: result.lowCreditWarning,
          threshold: result.threshold
        };
      }
      
      return { 
        allowed: true,
        currentBalance: result.currentBalance,
        lowCreditWarning: result.lowCreditWarning,
        threshold: result.threshold
      };
    } catch (error) {
      console.error('Error checking tenant credits:', error);
      return { allowed: false, reason: 'Error checking credit balance' };
    }
  }

  /**
   * Core method to send a WhatsApp message
   */
  async sendMessage(params: SendMessageParams): Promise<any> {
    const {
      tenantId,
      recipientPhone,
      messageType,
      templateVariables,
      referenceType,
      referenceId,
      referenceNumber,
      recipientType,
      recipientId
    } = params;

    // Step 1: Check tenant credits
    const creditCheck = await this.checkTenantCredits(tenantId, 1);
    if (!creditCheck.allowed) {
      throw new Error(creditCheck.reason || 'Insufficient WhatsApp credits');
    }

    // Step 2: Format phone number
    const formattedPhone = formatPhoneForWhatsApp(recipientPhone);

    // Step 3: Get template ContentSid
    const templateContentSid = templateMapping[messageType];
    if (!templateContentSid) {
      throw new Error(`Template not configured for message type: ${messageType}`);
    }

    // Step 4: Create initial message log
    const messageLog = await WhatsAppMessageModel.createMessage(tenantId, {
      tenantId, // Add tenantId as it's required by the schema
      recipientType,
      recipientId,
      recipientPhone: formattedPhone,
      messageType,
      referenceType,
      referenceId,
      referenceNumber,
      templateId: templateContentSid,
      status: 'pending',
      templateVariables: JSON.stringify(templateVariables),
      costCurrency: null
    });

    try {
      // Step 5: Call Twilio API
      const twilioClient = getTwilioClient();
      const twilioResponse = await twilioClient.messages.create({
        from: whatsappConfig.whatsappFrom,
        to: formattedPhone,
        contentSid: templateContentSid,
        contentVariables: JSON.stringify(templateVariables)
      });

      // Step 6: Update message log with Twilio response
      const updatedMessage = await WhatsAppMessageModel.updateMessage(
        tenantId,
        messageLog.id,
        {
          twilioMessageSid: twilioResponse.sid,
          status: 'sent',
          sentAt: new Date()
        }
      );

      // Step 7: Deduct credits after successful send
      let creditMetadata = {
        lowCreditWarning: false,
        remainingCredits: 0,
        creditDeductionFailed: false
      };

      try {
        const deductionResult = await TenantModel.deductWhatsAppCredits(tenantId, 1, 'message_sent', messageLog.id, 'WhatsApp message sent');
        
        creditMetadata = {
          lowCreditWarning: deductionResult.lowCreditWarning,
          remainingCredits: deductionResult.newBalance,
          creditDeductionFailed: false
        };

        if (deductionResult.lowCreditWarning) {
          console.warn(`⚠️ Low credit warning for tenant ${tenantId}: Balance is ${deductionResult.newBalance}, threshold is ${creditCheck.threshold}`);
        }
        
        console.log(`✅ WhatsApp message sent successfully: ${twilioResponse.sid}. Credits remaining: ${deductionResult.newBalance}`);
      } catch (creditError) {
        // Non-fatal error since message was already sent
        console.error('❌ Failed to deduct credits after successful send:', creditError);
        creditMetadata.creditDeductionFailed = true;
      }

      return {
        ...updatedMessage,
        creditMetadata
      };

    } catch (twilioError: any) {
      // Update message log with error
      await WhatsAppMessageModel.updateMessage(
        tenantId,
        messageLog.id,
        {
          status: 'failed',
          errorCode: twilioError.code?.toString() || 'UNKNOWN',
          errorMessage: twilioError.message || 'Failed to send message'
        }
      );

      console.error('❌ Twilio WhatsApp error:', twilioError);
      throw new Error(`Failed to send WhatsApp message: ${twilioError.message}`);
    }
  }

  /**
   * Send sales invoice to retailer
   */
async sendSalesInvoice(tenantId: string, invoiceId: string): Promise<any> {
  // Check tenant credits early
  const creditCheck = await this.checkTenantCredits(tenantId);
  if (!creditCheck.allowed) {
    throw new Error(creditCheck.reason || 'Insufficient WhatsApp credits');
  }

  // Fetch invoice
  const salesInvoiceModel = new SalesInvoiceModel();
  const invoice = await salesInvoiceModel.getSalesInvoice(tenantId, invoiceId);

  if (!invoice) {
    throw new Error('Sales invoice not found');
  }

  const retailer = invoice.retailer;
  if (!retailer) {
    throw new Error('Retailer information not found for invoice');
  }

  // Validate phone
  if (!retailer.phone || !isValidPhone(retailer.phone)) {
    throw new Error(`Invalid phone number for retailer: ${retailer.phone ?? 'not provided'}`);
  }

  // Fetch tenant
  let tenant: Tenant | null = null;
  try {
    tenant = await TenantModel.getTenant(tenantId);
  } catch (error) {
    console.warn(`Warning: Failed to fetch tenant details for ${tenantId}:`, error);
  }

  // Create or get share link
  const invoiceToken = await this.createInvoiceShareLink(tenantId, invoiceId, 'sales');
  if (!invoiceToken) {
    throw new Error('Unable to generate invoice share link. Please ensure the invoice is accessible.');
  }

  // Build template variables
  const templateVariables = buildSalesInvoiceVariables(invoice, retailer, tenant, invoiceToken);

  // Send message
  return this.sendMessage({
    tenantId,
    recipientPhone: retailer.phone,
    messageType: 'sales_invoice',
    templateVariables,
    referenceType: 'SALES_INVOICE',
    referenceId: invoiceId,
    referenceNumber: invoice.invoiceNumber,
    recipientType: 'retailer',
    recipientId: retailer.id
  });
}

async sendPurchaseInvoice(tenantId: string, invoiceId: string): Promise<any> {
  // Check tenant credits early
  const creditCheck = await this.checkTenantCredits(tenantId);
  if (!creditCheck.allowed) {
    throw new Error(creditCheck.reason || 'Insufficient WhatsApp credits');
  }

  // Fetch invoice
  const purchaseInvoiceModel = new PurchaseInvoiceModel();
  const invoice = await purchaseInvoiceModel.getPurchaseInvoice(tenantId, invoiceId);

  if (!invoice) {
    throw new Error('Purchase invoice not found');
  }

  const vendor = invoice.vendor;
  if (!vendor) {
    throw new Error('Vendor information not found for invoice');
  }

  // Validate phone
  if (!vendor.phone || !isValidPhone(vendor.phone)) {
    throw new Error(`Invalid phone number for vendor: ${vendor.phone ?? 'not provided'}`);
  }

  // Fetch tenant
  let tenant: Tenant | null = null;
  try {
    tenant = await TenantModel.getTenant(tenantId);
  } catch (error) {
    console.warn(`Warning: Failed to fetch tenant details for ${tenantId}:`, error);
  }

  // Create or get share link
  const invoiceToken = await this.createInvoiceShareLink(tenantId, invoiceId, 'purchase');
  if (!invoiceToken) {
    throw new Error('Unable to generate invoice share link. Please ensure the invoice is accessible.');
  }

  // Build template variables
  const templateVariables = buildPurchaseInvoiceVariables(invoice, vendor, tenant, invoiceToken);

  // Send message
  return this.sendMessage({
    tenantId,
    recipientPhone: vendor.phone,
    messageType: 'purchase_invoice',
    templateVariables,
    referenceType: 'PURCHASE_INVOICE',
    referenceId: invoiceId,
    referenceNumber: invoice.invoiceNumber,
    recipientType: 'vendor',
    recipientId: vendor.id
  });
}


  /**
   * Send payment reminder
   */
  async sendPaymentReminder(
  tenantId: string,
  invoiceId: string,
  invoiceType: 'sales' | 'purchase'
): Promise<any> {
  // Check tenant credits
  const creditCheck = await this.checkTenantCredits(tenantId);
  if (!creditCheck.allowed) {
    throw new Error(creditCheck.reason || 'Insufficient WhatsApp credits');
  }

  // Fetch invoice and recipient
  let invoice: any;
  let recipient: any;
  let recipientType: 'vendor' | 'retailer';

  if (invoiceType === 'sales') {
    const salesInvoiceModel = new SalesInvoiceModel();
    invoice = await salesInvoiceModel.getSalesInvoice(tenantId, invoiceId);
    recipient = invoice?.retailer;
    recipientType = 'retailer';
  } else {
    const purchaseInvoiceModel = new PurchaseInvoiceModel();
    invoice = await purchaseInvoiceModel.getPurchaseInvoice(tenantId, invoiceId);
    recipient = invoice?.vendor;
    recipientType = 'vendor';
  }

  if (!invoice) throw new Error(`${invoiceType} invoice not found`);
  if (!recipient) throw new Error(`${recipientType} information not found for invoice`);

  // Validate recipient phone
  if (!recipient.phone || !isValidPhone(recipient.phone)) {
    throw new Error(`Invalid phone number for ${recipientType}: ${recipient.phone ?? 'not provided'}`);
  }

  // Fetch tenant details safely
  let tenant: Tenant | null = null;
  try {
    tenant = await TenantModel.getTenant(tenantId);
  } catch (error) {
    console.warn(`Warning: Failed to fetch tenant details for ${tenantId}:`, error);
  }

  // Create or get share link
  const shareInvoiceType = invoiceType === 'sales' ? 'sales' : 'purchase';
  const invoiceToken = await this.createInvoiceShareLink(tenantId, invoiceId, shareInvoiceType);
  if (!invoiceToken) throw new Error('Unable to generate invoice share link');

  // Build template variables
  const templateVariables = buildPaymentReminderVariables(invoice, recipient, recipientType, tenant, invoiceToken);

  // Send message
  return this.sendMessage({
    tenantId,
    recipientPhone: recipient.phone,
    messageType: 'payment_reminder',
    templateVariables,
    referenceType: invoiceType === 'sales' ? 'SALES_INVOICE' : 'PURCHASE_INVOICE',
    referenceId: invoiceId,
    referenceNumber: invoice.invoiceNumber,
    recipientType,
    recipientId: recipient.id
  });
}

async sendPaymentNotification(
  tenantId: string,
  paymentId: string,
  paymentType: 'sales' | 'purchase'
): Promise<any> {
  // Check tenant credits
  const creditCheck = await this.checkTenantCredits(tenantId);
  if (!creditCheck.allowed) {
    throw new Error(creditCheck.reason || 'Insufficient WhatsApp credits');
  }

  // Fetch payments
  let payments: any[];
  let recipientType: 'vendor' | 'retailer';

  if (paymentType === 'sales') {
    const salesPaymentModel = new SalesPaymentModel();
    payments = await salesPaymentModel.getSalesPayments(tenantId, true);
    recipientType = 'retailer';
  } else {
    const paymentModel = new PaymentModel();
    payments = await paymentModel.getPayments(tenantId);
    recipientType = 'vendor';
  }

  const payment = payments.find(p => p.id === paymentId);
  if (!payment) throw new Error(`${paymentType} payment not found`);

  const invoice = payment.invoice;
  const recipient = paymentType === 'sales' ? payment.retailer : payment.vendor;

  if (!invoice) throw new Error('Invoice information not found for payment');
  if (!recipient) throw new Error(`${recipientType} information not found for payment`);

  // Validate recipient phone
  if (!recipient.phone || !isValidPhone(recipient.phone)) {
    throw new Error(`Invalid phone number for ${recipientType}: ${recipient.phone ?? 'not provided'}`);
  }

  // Fetch tenant details safely
  let tenant: Tenant | null = null;
  try {
    tenant = await TenantModel.getTenant(tenantId);
  } catch (error) {
    console.warn(`Warning: Failed to fetch tenant details for ${tenantId}:`, error);
  }

  // Create or get share link
  const shareInvoiceType = paymentType === 'sales' ? 'sales' : 'purchase';
  const invoiceToken = await this.createInvoiceShareLink(tenantId, invoice.id, shareInvoiceType);
  if (!invoiceToken) throw new Error('Unable to generate invoice share link');

  // Build template variables
  const templateVariables = buildPaymentNotificationVariables(payment, invoice, recipient, tenant, invoiceToken);

  // Send message
  return this.sendMessage({
    tenantId,
    recipientPhone: recipient.phone,
    messageType: 'payment_notification',
    templateVariables,
    referenceType: paymentType === 'sales' ? 'SALES_PAYMENT' : 'PURCHASE_PAYMENT',
    referenceId: paymentId,
    referenceNumber: invoice.invoiceNumber,
    recipientType,
    recipientId: recipient.id
  });
}

}

// Export singleton instance
export const whatsAppService = new WhatsAppService();