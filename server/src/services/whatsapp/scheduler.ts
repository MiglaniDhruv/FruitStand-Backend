import * as cron from 'node-cron';
import { db } from '../../../db.js';
import { eq, and, lt, or, inArray, gt } from 'drizzle-orm';
import { whatsAppService } from './whatsapp-service.js';
import { TenantModel } from '../../modules/tenants/model.js';
import { withTenant } from '../../utils/tenant-scope.js';
import schema from '../../../shared/schema.js';

const { salesInvoices, purchaseInvoices, tenants } = schema;

// Global scheduler configuration (fallback if tenant settings not available)
const SCHEDULER_CRON = process.env.PAYMENT_REMINDER_CRON || '0 * * * *'; // Default: Every hour
const REMINDER_ENABLED = process.env.PAYMENT_REMINDER_ENABLED !== 'false'; // Default: enabled
// Note: No max reminders limit - tenants control frequency (daily/weekly/monthly) and credits control volume

/**
 * Check if current time is within tenant's preferred send window
 * @param preferredHour - Hour of day (0-23) when tenant wants reminders sent
 * @returns true if current hour matches preferred hour
 */
function isWithinSendWindow(preferredHour: number): boolean {
  const currentHour = new Date().getHours();
  return currentHour === preferredHour;
}

/**
 * Check if today is a weekend
 * @returns true if today is Saturday (6) or Sunday (0)
 */
function isWeekend(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

/**
 * Check if reminders should be sent today based on frequency setting
 * @param frequency - 'daily', 'weekly', or 'monthly'
 * @param sendOnWeekends - whether tenant allows weekend sends
 * @returns true if reminders should be sent today
 */
function shouldSendBasedOnFrequency(frequency: string, sendOnWeekends: boolean = true): boolean {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const dayOfMonth = today.getDate(); // 1-31
  
  switch (frequency) {
    case 'daily':
      return true; // Send every day
    case 'weekly':
      return dayOfWeek === 1; // Send only on Mondays
    case 'monthly':
      // For monthly reminders, handle weekend fallback logic
      if (dayOfMonth === 1) {
        // If weekends are allowed, always send on 1st
        if (sendOnWeekends) {
          return true;
        }
        // If weekends are disabled, only send on 1st if it's not a weekend
        return !(dayOfWeek === 0 || dayOfWeek === 6); // Not Sunday (0) or Saturday (6)
      }
      
      // If sendOnWeekends is false and 1st fell on weekend, send on first business day
      if (!sendOnWeekends) {
        const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const firstDayOfWeek = firstOfMonth.getDay();
        
        // If 1st was Saturday (6), send on Monday (3rd)
        if (firstDayOfWeek === 6 && dayOfMonth === 3 && dayOfWeek === 1) {
          return true;
        }
        
        // If 1st was Sunday (0), send on Monday (2nd)  
        if (firstDayOfWeek === 0 && dayOfMonth === 2 && dayOfWeek === 1) {
          return true;
        }
      }
      
      return false; // Not a monthly send day
    default:
      return true; // Default to daily if unknown frequency
  }
}

/**
 * Get overdue sales invoices for a tenant
 */
async function getOverdueSalesInvoices(tenantId: string): Promise<any[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Start of today
  
  return await db
    .select()
    .from(salesInvoices)
    .where(
      withTenant(
        salesInvoices,
        tenantId,
        and(
          or(
            eq(salesInvoices.status, 'Unpaid'),
            eq(salesInvoices.status, 'Partially Paid')
          ),
          lt(salesInvoices.invoiceDate, today),
          gt(salesInvoices.udhaaarAmount, '0')
        )
      )
    )
    .orderBy(salesInvoices.invoiceDate); // Oldest first, no limit
}

/**
 * Get overdue purchase invoices for a tenant
 */
async function getOverduePurchaseInvoices(tenantId: string): Promise<any[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Start of today
  
  return await db
    .select()
    .from(purchaseInvoices)
    .where(
      withTenant(
        purchaseInvoices,
        tenantId,
        and(
          or(
            eq(purchaseInvoices.status, 'Unpaid'),
            eq(purchaseInvoices.status, 'Partially Paid')
          ),
          lt(purchaseInvoices.invoiceDate, today),
          gt(purchaseInvoices.balanceAmount, '0')
        )
      )
    )
    .orderBy(purchaseInvoices.invoiceDate); // Oldest first, no limit
}

/**
 * Main function to send payment reminders
 */
async function sendPaymentReminders(): Promise<void> {
  const startTime = Date.now();
  console.log(`🔄 Starting payment reminder job at ${new Date().toISOString()}`);
  
  let totalTenantsProcessed = 0;
  let totalRemindersSent = 0;
  let totalFailures = 0;

  try {
    // Step 1: Get all active tenants
    const activeTenants = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.isActive, true));

    console.log(`📋 Found ${activeTenants.length} active tenants to process`);

    // Step 2: Process each tenant
    for (const tenant of activeTenants) {
      totalTenantsProcessed++;
      console.log(`🏢 Processing tenant: ${tenant.name} (${tenant.id})`);

      try {
        // Check if WhatsApp is enabled for this tenant
        const whatsappSettings = await TenantModel.getWhatsAppSettings(tenant.id);
        
        if (!whatsappSettings.enabled) {
          console.log(`⏭️ WhatsApp disabled for tenant ${tenant.name}, skipping`);
          continue;
        }

        // Check if automatic reminders are enabled
        const schedulerSettings = whatsappSettings.scheduler || {
          enabled: true,
          preferredSendHour: 9,
          reminderFrequency: 'daily',
          sendOnWeekends: true,
        };

        if (!schedulerSettings.enabled) {
          console.log(`⏭️ Automatic reminders disabled for tenant ${tenant.name}, skipping`);
          continue;
        }

        // Check if current time matches tenant's preferred send hour
        if (!isWithinSendWindow(schedulerSettings.preferredSendHour)) {
          console.log(`⏰ Outside send window for tenant ${tenant.name} (preferred hour: ${schedulerSettings.preferredSendHour}, current hour: ${new Date().getHours()}), skipping`);
          continue;
        }

        // Check if reminders should be sent based on frequency setting (this handles monthly weekend fallback)
        if (!shouldSendBasedOnFrequency(schedulerSettings.reminderFrequency, schedulerSettings.sendOnWeekends)) {
          const frequencyLabel = schedulerSettings.reminderFrequency === 'weekly' ? 'weekly (Mondays only)' : 
                                 schedulerSettings.reminderFrequency === 'monthly' ? 'monthly (1st or next business day)' : 'daily';
          console.log(`📆 Frequency check failed for tenant ${tenant.name} (${frequencyLabel}), skipping`);
          continue;
        }

        // Check if tenant wants reminders on weekends (only for daily/weekly, monthly handles its own weekend logic)
        if (isWeekend() && !schedulerSettings.sendOnWeekends && schedulerSettings.reminderFrequency !== 'monthly') {
          console.log(`📅 Weekend reminders disabled for tenant ${tenant.name}, skipping`);
          continue;
        }

        // Check if tenant has sufficient credits
        const creditBalance = whatsappSettings.creditBalance || 0;
        if (creditBalance <= 0) {
          console.log(`� Insufficient credits for tenant ${tenant.name} (Balance: ${creditBalance}), skipping`);
          continue;
        }

        // Check for low credit warning
        const lowCreditThreshold = whatsappSettings.lowCreditThreshold || 50;
        if (creditBalance <= lowCreditThreshold) {
          console.warn(`⚠️ Low credit warning for tenant ${tenant.name}: Balance is ${creditBalance}, threshold is ${lowCreditThreshold}`);
        }

        // Step 3: Get ALL overdue invoices (no limit)
        const [overdueSalesInvoices, overduePurchaseInvoices] = await Promise.all([
          getOverdueSalesInvoices(tenant.id),
          getOverduePurchaseInvoices(tenant.id)
        ]);

        const totalOverdueInvoices = overdueSalesInvoices.length + overduePurchaseInvoices.length;
        console.log(`📄 Found ${totalOverdueInvoices} overdue invoices for ${tenant.name} (${overdueSalesInvoices.length} sales, ${overduePurchaseInvoices.length} purchase)`);

        // Step 4: Send reminders for all overdue invoices (no limit)
        let remindersSentForTenant = 0;

        // Send sales reminders
        for (const invoice of overdueSalesInvoices) {
          try {
            await whatsAppService.sendPaymentReminder(tenant.id, invoice.id, 'sales');
            totalRemindersSent++;
            remindersSentForTenant++;
            console.log(`✅ Sales reminder sent for invoice ${invoice.invoiceNumber}`);
          } catch (error: any) {
            totalFailures++;
            console.error(`❌ Failed to send sales reminder for invoice ${invoice.invoiceNumber}:`, error.message);
            
            // If we hit a credit limit error, stop processing this tenant
            if (error.message.includes('Insufficient') || error.message.includes('credits')) {
              console.log(`💳 Credit limit reached for tenant ${tenant.name}, stopping reminders`);
              break;
            }
          }
        }

        // Send purchase reminders (only if we didn't hit credit limit on sales)
        for (const invoice of overduePurchaseInvoices) {
          try {
            await whatsAppService.sendPaymentReminder(tenant.id, invoice.id, 'purchase');
            totalRemindersSent++;
            remindersSentForTenant++;
            console.log(`✅ Purchase reminder sent for invoice ${invoice.invoiceNumber}`);
          } catch (error: any) {
            totalFailures++;
            console.error(`❌ Failed to send purchase reminder for invoice ${invoice.invoiceNumber}:`, error.message);
            
            // If we hit a credit limit error, stop processing this tenant
            if (error.message.includes('Insufficient') || error.message.includes('credits')) {
              console.log(`💳 Credit limit reached for tenant ${tenant.name}, stopping reminders`);
              break;
            }
          }
        }

        console.log(`📊 Sent ${remindersSentForTenant} reminders for ${tenant.name} (${overdueSalesInvoices.length} sales + ${overduePurchaseInvoices.length} purchase invoices)`)

      } catch (tenantError: any) {
        totalFailures++;
        console.error(`❌ Error processing tenant ${tenant.name}:`, tenantError.message);
      }
    }

  } catch (error: any) {
    console.error(`❌ Critical error in payment reminder job:`, error.message);
  }

  // Step 6: Log summary statistics
  const executionTime = Date.now() - startTime;
  console.log(`📊 Payment reminder job completed:`);
  console.log(`   • Tenants processed: ${totalTenantsProcessed}`);
  console.log(`   • Reminders sent: ${totalRemindersSent}`);
  console.log(`   • Failures: ${totalFailures}`);
  console.log(`   • Execution time: ${executionTime}ms`);
}

/**
 * Initialize the payment reminder scheduler
 */
function initializePaymentReminderScheduler(): cron.ScheduledTask | null {
  try {
    // Check if scheduler is enabled
    if (!REMINDER_ENABLED) {
      console.log('📅 Payment reminder scheduler is disabled (PAYMENT_REMINDER_ENABLED=false)');
      return null;
    }

    // Validate cron pattern
    if (!cron.validate(SCHEDULER_CRON)) {
      console.error(`❌ Invalid cron pattern: ${SCHEDULER_CRON}`);
      return null;
    }

    // Schedule the job
    const scheduledTask = cron.schedule(SCHEDULER_CRON, sendPaymentReminders);
    
    console.log(`📅 Payment reminder scheduler initialized with pattern: ${SCHEDULER_CRON}`);
    console.log(`📋 Per-tenant scheduling enabled. Tenants can configure preferred send times.`);
    
    return scheduledTask;

  } catch (error: any) {
    console.error('❌ Failed to initialize payment reminder scheduler:', error.message);
    return null;
  }
}

export { initializePaymentReminderScheduler, sendPaymentReminders };