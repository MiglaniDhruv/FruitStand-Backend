import { BaseRouter } from '../../utils/base';
import { WhatsAppController } from './controller';
import { 
  authenticateToken, 
  validateTenant, 
  attachTenantContext, 
  requirePermission 
} from '../../middleware/auth';
import { PERMISSIONS } from '../../../shared/permissions.js';

import { asyncHandler } from '../../utils/async-handler';

export class WhatsAppRouter extends BaseRouter {
  private whatsAppController: WhatsAppController;

  constructor() {
    super();
    this.whatsAppController = new WhatsAppController();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // POST /whatsapp/send/sales-invoice - Send sales invoice to retailer
    this.router.post(
      '/whatsapp/send/sales-invoice',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission([PERMISSIONS.SEND_WHATSAPP_MESSAGES])),
      this.ah(this.whatsAppController.sendSalesInvoice)
    );

    // POST /whatsapp/send/purchase-invoice - Send purchase invoice to vendor
    this.router.post(
      '/whatsapp/send/purchase-invoice',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission([PERMISSIONS.SEND_WHATSAPP_MESSAGES])),
      this.ah(this.whatsAppController.sendPurchaseInvoice)
    );

    // POST /whatsapp/send/payment-reminder - Send payment reminder
    this.router.post(
      '/whatsapp/send/payment-reminder',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission([PERMISSIONS.SEND_WHATSAPP_MESSAGES])),
      this.ah(this.whatsAppController.sendPaymentReminder)
    );

    // POST /whatsapp/send/payment-notification - Send payment notification
    this.router.post(
      '/whatsapp/send/payment-notification',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission([PERMISSIONS.SEND_WHATSAPP_MESSAGES])),
      this.ah(this.whatsAppController.sendPaymentNotification)
    );

    // GET /whatsapp/messages - Get paginated message history
    this.router.get(
      '/whatsapp/messages',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission([PERMISSIONS.VIEW_WHATSAPP_LOGS])),
      this.ah(this.whatsAppController.getMessageHistory)
    );

    // GET /whatsapp/messages/by-reference - Get messages for a specific reference
    this.router.get(
      '/whatsapp/messages/by-reference',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission([PERMISSIONS.VIEW_WHATSAPP_LOGS])),
      this.ah(this.whatsAppController.getMessagesByReference)
    );

    // POST /whatsapp/preview - Preview message without sending
    this.router.post(
      '/whatsapp/preview',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission([PERMISSIONS.SEND_WHATSAPP_MESSAGES])),
      this.ah(this.whatsAppController.previewMessage)
    );

    // POST /whatsapp/webhook - Handle Twilio status webhooks (no auth required)
    this.router.post(
      '/whatsapp/webhook',
      this.ah(this.whatsAppController, 'handleWebhook')
    );

    // GET /whatsapp/credits - Get current credit balance
    this.router.get(
      '/whatsapp/credits',
      authenticateToken,
      asyncHandler(validateTenant),
      attachTenantContext,
      asyncHandler(requirePermission([PERMISSIONS.VIEW_WHATSAPP_LOGS])),
      this.ah(this.whatsAppController.getCreditBalance)
    );
  }
}