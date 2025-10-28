import { db } from '../../../db';
import schema from '../../../shared/schema.js';
import { eq, and } from 'drizzle-orm';
import { withTenant, ensureTenantInsert } from '../../utils/tenant-scope';

// Destructure what you need from the default export
const { tenants, whatsappCreditTransactions } = schema;

// Define types from the schema
type InsertWhatsAppCreditTransaction = typeof schema.insertWhatsAppCreditTransactionSchema._input;
type WhatsAppCreditTransaction = typeof schema.whatsappCreditTransactions.$inferSelect;

export interface CreditCheckResult {
  hasCredits: boolean;
  currentBalance: number;
  lowCreditWarning: boolean;
  threshold: number;
  reason?: string;
}

export interface CreditDeductionResult {
  success: boolean;
  newBalance: number;
  transactionId: string;
  lowCreditWarning: boolean;
}

export class WhatsAppCreditModel {
  /**
   * Fetch the current credit balance from tenant settings
   */
  async getCreditBalance(tenantId: string): Promise<number> {
    try {
      const tenant = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      if (!tenant[0]) {
        return 0;
      }

      const settings = tenant[0].settings as any;
      return settings?.whatsapp?.creditBalance || 0;
    } catch (error) {
      console.error('Error fetching credit balance:', error);
      return 0;
    }
  }

  /**
   * Check if tenant has sufficient credits and if low-credit warning should be triggered
   */
  async checkCreditAvailability(tenantId: string, creditsRequired: number = 1): Promise<CreditCheckResult> {
    try {
      const tenant = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      if (!tenant[0]) {
        return {
          hasCredits: false,
          currentBalance: 0,
          lowCreditWarning: false,
          threshold: 0,
          reason: 'Tenant not found'
        };
      }

      const settings = tenant[0].settings as any;
      const creditBalance = settings?.whatsapp?.creditBalance || 0;
      const lowCreditThreshold = settings?.whatsapp?.lowCreditThreshold || 50;

      const hasCredits = creditBalance >= creditsRequired;
      const lowCreditWarning = creditBalance <= lowCreditThreshold;

      return {
        hasCredits,
        currentBalance: creditBalance,
        lowCreditWarning,
        threshold: lowCreditThreshold,
        reason: hasCredits ? undefined : `Insufficient WhatsApp credits. Current balance: ${creditBalance}, Required: ${creditsRequired}`
      };
    } catch (error) {
      console.error('Error checking credit availability:', error);
      return {
        hasCredits: false,
        currentBalance: 0,
        lowCreditWarning: false,
        threshold: 0,
        reason: 'Error checking credit availability'
      };
    }
  }

  /**
   * Atomically deduct credits and create a transaction record
   */
  async deductCredits(
    tenantId: string,
    amount: number,
    referenceType: string,
    referenceId: string,
    notes?: string
  ): Promise<CreditDeductionResult> {
    return await db.transaction(async (tx) => {
      try {
        // Fetch current tenant settings with row lock
        const tenant = await tx
          .select()
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);

        if (!tenant[0]) {
          throw new Error('Tenant not found');
        }

        const settings = tenant[0].settings as any;
        const creditBalance = settings?.whatsapp?.creditBalance || 0;
        const lowCreditThreshold = settings?.whatsapp?.lowCreditThreshold || 50;

        const newBalance = creditBalance - amount;

        if (newBalance < 0) {
          throw new Error('Cannot deduct credits: insufficient balance');
        }

        // Update tenant settings with new balance
        const updatedSettings = {
          ...settings,
          whatsapp: {
            ...settings?.whatsapp,
            creditBalance: newBalance
          }
        };

        await tx
          .update(tenants)
          .set({ settings: updatedSettings })
          .where(eq(tenants.id, tenantId));

        // Create credit transaction record
        const transactionData: InsertWhatsAppCreditTransaction = {
          tenantId,
          transactionType: 'usage',
          amount: -amount, // Negative for deduction
          balanceAfter: newBalance,
          referenceType,
          referenceId,
          notes
        };

        const [transaction] = await tx
          .insert(whatsappCreditTransactions)
          .values(transactionData)
          .returning();

        const lowCreditWarning = newBalance <= lowCreditThreshold;

        return {
          success: true,
          newBalance,
          transactionId: transaction.id,
          lowCreditWarning
        };
      } catch (error) {
        console.error('Error deducting credits:', error);
        throw error;
      }
    });
  }

  /**
   * Fetch recent credit transactions for a tenant
   */
  async getCreditTransactions(tenantId: string, limit: number = 50): Promise<WhatsAppCreditTransaction[]> {
    try {
      return await db
        .select()
        .from(whatsappCreditTransactions)
        .where(withTenant(whatsappCreditTransactions, tenantId))
        .orderBy(whatsappCreditTransactions.createdAt)
        .limit(limit);
    } catch (error) {
      console.error('Error fetching credit transactions:', error);
      return [];
    }
  }

  /**
   * Fetch the credit transaction associated with a specific WhatsApp message
   */
  async getTransactionByMessageId(tenantId: string, messageId: string): Promise<WhatsAppCreditTransaction | null> {
    try {
      const transactions = await db
        .select()
        .from(whatsappCreditTransactions)
        .where(
          and(
            withTenant(whatsappCreditTransactions, tenantId),
            eq(whatsappCreditTransactions.referenceType, 'message_sent'),
            eq(whatsappCreditTransactions.referenceId, messageId)
          )
        )
        .limit(1);

      return transactions[0] || null;
    } catch (error) {
      console.error('Error fetching transaction by message ID:', error);
      return null;
    }
  }
}

export default WhatsAppCreditModel;