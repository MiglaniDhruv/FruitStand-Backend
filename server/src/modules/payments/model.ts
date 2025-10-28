import { eq, desc, inArray, and, or, gt, asc, sum, sql } from 'drizzle-orm';
import { db } from '../../../db';
import schema from '../../../shared/schema.js';

const { payments, purchaseInvoices, vendors, bankAccounts, cashbook, bankbook } = schema;

type Payment = typeof schema.payments.$inferSelect;
type InsertPayment = typeof schema.insertPaymentSchema._input;
type PaymentWithDetails = typeof schema.PaymentWithDetails;
type PurchaseInvoice = typeof schema.purchaseInvoices.$inferSelect;
type VendorPaymentDistributionResult = typeof schema.VendorPaymentDistributionResult;
import { withTenant, ensureTenantInsert } from '../../utils/tenant-scope';
import { BankAccountModel } from '../bank-accounts/model';
import { TenantModel } from '../tenants/model';
import { NotFoundError, ValidationError, BadRequestError, AppError } from '../../types';
import { handleDatabaseError } from '../../utils/database-errors';

export class PaymentModel {
  async getPayments(tenantId: string): Promise<PaymentWithDetails[]> {
    const paymentsList = await db.select().from(payments)
      .where(withTenant(payments, tenantId))
      .orderBy(desc(payments.createdAt));

    if (paymentsList.length === 0) {
      return [];
    }

    // Collect unique IDs for batch fetching
    const invoiceIdsSet = new Set(paymentsList.map(p => p.invoiceId));
    const vendorIdsSet = new Set(paymentsList.map(p => p.vendorId));
    const bankAccountIdsSet = new Set(paymentsList.filter(p => p.bankAccountId).map(p => p.bankAccountId!));
    
    const invoiceIds = Array.from(invoiceIdsSet);
    const vendorIds = Array.from(vendorIdsSet);
    const bankAccountIds = Array.from(bankAccountIdsSet);

    // Batch fetch related data with tenant filtering
    const [invoicesData, vendorsData, bankAccountsData] = await Promise.all([
      invoiceIds.length > 0 ? db.select().from(purchaseInvoices).where(withTenant(purchaseInvoices, tenantId, inArray(purchaseInvoices.id, invoiceIds))) : [],
      vendorIds.length > 0 ? db.select().from(vendors).where(withTenant(vendors, tenantId, inArray(vendors.id, vendorIds))) : [],
      bankAccountIds.length > 0 ? db.select().from(bankAccounts).where(withTenant(bankAccounts, tenantId, inArray(bankAccounts.id, bankAccountIds))) : []
    ]);

    // Create lookup maps
    const invoiceMap = new Map(invoicesData.map(i => [i.id, i]));
    const vendorMap = new Map(vendorsData.map(v => [v.id, v]));
    const bankAccountMap = new Map(bankAccountsData.map(b => [b.id, b]));

    // Assemble final data - filter out payments without required related entities
    const result = paymentsList
      .map(payment => {
        const invoice = invoiceMap.get(payment.invoiceId);
        const vendor = vendorMap.get(payment.vendorId);
        
        // Both invoice and vendor are required per PaymentWithDetails type
        if (!invoice || !vendor) {
          return null;
        }
        
        return {
          ...payment,
          invoice,
          vendor,
          bankAccount: payment.bankAccountId ? bankAccountMap.get(payment.bankAccountId) : undefined
        };
      })
      .filter(payment => payment !== null) as PaymentWithDetails[];

    return result;
  }

  async getPaymentsByInvoice(tenantId: string, invoiceId: string): Promise<PaymentWithDetails[]> {
    const paymentsList = await db.select().from(payments)
      .where(withTenant(payments, tenantId, eq(payments.invoiceId, invoiceId)))
      .orderBy(desc(payments.createdAt));

    if (paymentsList.length === 0) {
      return [];
    }

    // Collect unique IDs for batch fetching
    const invoiceIdsSet = new Set(paymentsList.map(p => p.invoiceId));
    const vendorIdsSet = new Set(paymentsList.map(p => p.vendorId));
    const bankAccountIdsSet = new Set(paymentsList.filter(p => p.bankAccountId).map(p => p.bankAccountId!));
    
    const invoiceIds = Array.from(invoiceIdsSet);
    const vendorIds = Array.from(vendorIdsSet);
    const bankAccountIds = Array.from(bankAccountIdsSet);

    // Batch fetch related data with tenant filtering
    const [invoicesData, vendorsData, bankAccountsData] = await Promise.all([
      invoiceIds.length > 0 ? db.select().from(purchaseInvoices).where(withTenant(purchaseInvoices, tenantId, inArray(purchaseInvoices.id, invoiceIds))) : [],
      vendorIds.length > 0 ? db.select().from(vendors).where(withTenant(vendors, tenantId, inArray(vendors.id, vendorIds))) : [],
      bankAccountIds.length > 0 ? db.select().from(bankAccounts).where(withTenant(bankAccounts, tenantId, inArray(bankAccounts.id, bankAccountIds))) : []
    ]);

    // Create lookup maps
    const invoiceMap = new Map(invoicesData.map(i => [i.id, i]));
    const vendorMap = new Map(vendorsData.map(v => [v.id, v]));
    const bankAccountMap = new Map(bankAccountsData.map(b => [b.id, b]));

    // Assemble final data - filter out payments without required related entities
    const result = paymentsList
      .map(payment => {
        const invoice = invoiceMap.get(payment.invoiceId);
        const vendor = vendorMap.get(payment.vendorId);
        
        // Both invoice and vendor are required per PaymentWithDetails type
        if (!invoice || !vendor) {
          return null;
        }
        
        return {
          ...payment,
          invoice,
          vendor,
          bankAccount: payment.bankAccountId ? bankAccountMap.get(payment.bankAccountId) : undefined
        };
      })
      .filter(payment => payment !== null) as PaymentWithDetails[];

    return result;
  }

  async createPayment(tenantId: string, paymentData: InsertPayment): Promise<PaymentWithDetails> {
    // Add business logic validation
    const paymentAmount = parseFloat(paymentData.amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      throw new ValidationError('Invalid payment amount', {
        amount: 'Payment amount must be a positive number'
      });
    }

    // Validate bankAccountId for non-cash payments
    if (['Bank', 'UPI', 'Cheque'].includes(paymentData.paymentMode) && !paymentData.bankAccountId) {
      throw new ValidationError('bankAccountId is required for non-cash payments', {
        bankAccountId: 'Bank account is required for Bank, UPI, or Cheque payment modes'
      });
    }
    
    try {
      return await db.transaction(async (tx) => {
      const paymentWithTenant = ensureTenantInsert(paymentData, tenantId);
      const [payment] = await tx.insert(payments).values(paymentWithTenant).returning();
      
      // Fetch and validate related entities with tenant filtering
      const [invoice] = await tx.select().from(purchaseInvoices)
        .where(withTenant(purchaseInvoices, tenantId, eq(purchaseInvoices.id, payment.invoiceId)));
      
      const [vendor] = await tx.select().from(vendors)
        .where(withTenant(vendors, tenantId, eq(vendors.id, payment.vendorId)));
      
      if (!invoice) {
        throw new NotFoundError('Purchase invoice');
      }
      
      if (!vendor) {
        throw new NotFoundError('Vendor');
      }
      
      // Update invoice amounts and status with overpayment protection
      const paymentAmount = parseFloat(payment.amount);
      const currentPaidAmount = parseFloat(invoice.paidAmount || '0');
      const totalAmount = parseFloat(invoice.netAmount);
      const currentInvoiceBalance = totalAmount - currentPaidAmount;
      const appliedAmount = Math.min(paymentAmount, currentInvoiceBalance);
      
      const newPaidAmount = currentPaidAmount + appliedAmount;
      const newBalanceAmount = Math.max(0, totalAmount - newPaidAmount);
      
      // Determine status using epsilon threshold for floating-point precision
      const epsilon = 0.005;
      let newStatus = 'Unpaid';
      if (newBalanceAmount <= epsilon) {
        newStatus = 'Paid';
      } else if (newPaidAmount > epsilon) {
        newStatus = 'Partially Paid';
      }
      
      await tx.update(purchaseInvoices)
        .set({
          paidAmount: newPaidAmount.toFixed(2),
          balanceAmount: newBalanceAmount.toFixed(2),
          status: newStatus
        })
        .where(withTenant(purchaseInvoices, tenantId, eq(purchaseInvoices.id, payment.invoiceId)));
      
      // Update vendor balance using applied amount
      const currentVendorBalance = parseFloat(vendor.balance || '0');
      const newVendorBalance = currentVendorBalance - appliedAmount;
      await tx.update(vendors)
        .set({ balance: newVendorBalance.toFixed(2) })
        .where(withTenant(vendors, tenantId, eq(vendors.id, payment.vendorId)));
      
      // Create cashbook entry for Cash payments using applied amount
      if (payment.paymentMode === 'Cash') {
        const lastCashEntry = await tx.select().from(cashbook)
          .where(withTenant(cashbook, tenantId))
          .orderBy(desc(cashbook.id))
          .limit(1)
          .for('update');

        const currentBalance = lastCashEntry.length > 0 ? parseFloat(lastCashEntry[0].balance) : 0;
        const newBalance = currentBalance - appliedAmount;

        await tx.insert(cashbook).values(ensureTenantInsert({
          date: payment.paymentDate,
          description: `Vendor Payment - ${vendor.name}`,
          outflow: appliedAmount.toFixed(2),
          inflow: '0.00',
          balance: newBalance.toFixed(2),
          referenceType: 'Payment',
          referenceId: payment.id,
        }, tenantId));

        // Update tenant cash balance
        await TenantModel.setCashBalance(tx, tenantId, newBalance.toFixed(2));
      }
      
      // Create bankbook entry for Bank/UPI/Cheque payments using applied amount
      else if ((payment.paymentMode === 'Bank' || payment.paymentMode === 'UPI' || payment.paymentMode === 'Cheque') && payment.bankAccountId) {
        const lastBankEntry = await tx.select().from(bankbook)
          .where(withTenant(bankbook, tenantId, eq(bankbook.bankAccountId, payment.bankAccountId)))
          .orderBy(desc(bankbook.date), desc(bankbook.id))
          .limit(1)
          .for('update');

        const currentBalance = lastBankEntry.length > 0 ? parseFloat(lastBankEntry[0].balance) : 0;
        const newBalance = currentBalance - appliedAmount;

        await tx.insert(bankbook).values(ensureTenantInsert({
          bankAccountId: payment.bankAccountId,
          date: payment.paymentDate,
          description: `Vendor Payment - ${vendor.name}`,
          credit: appliedAmount.toFixed(2),
          debit: '0.00',
          balance: newBalance.toFixed(2),
          referenceType: 'Payment',
          referenceId: payment.id,
        }, tenantId));

        // Update bank account balance
        await BankAccountModel.setBankAccountBalance(tx, tenantId, payment.bankAccountId, newBalance.toFixed(2));
      }
      
      // Fetch bank account data for response
      let bankAccount = null;
      if (payment.bankAccountId) {
        const [bankAccountData] = await tx.select().from(bankAccounts)
          .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.id, payment.bankAccountId)));
        bankAccount = bankAccountData || null;
      }
      
      // Return payment with related data
      const updatedInvoice = { ...invoice, paidAmount: newPaidAmount.toFixed(2), balanceAmount: newBalanceAmount.toFixed(2), status: newStatus };
      
      return {
        ...payment,
        invoice: updatedInvoice,
        vendor,
        bankAccount: bankAccount || undefined
      };
    });
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }

  async recordVendorPayment(
    tenantId: string, 
    vendorId: string, 
    paymentData: { 
      amount: string, 
      paymentMode: string, 
      paymentDate: Date, 
      bankAccountId?: string, 
      chequeNumber?: string, 
      upiReference?: string, 
      notes?: string 
    }
  ): Promise<VendorPaymentDistributionResult> {
    // Add business logic validation
    const totalPaymentAmount = parseFloat(paymentData.amount);
    if (isNaN(totalPaymentAmount) || totalPaymentAmount <= 0) {
      throw new ValidationError('Invalid payment amount', {
        amount: 'Payment amount must be a positive number'
      });
    }

    try {
      return await db.transaction(async (tx) => {
        // Validate vendor exists
        const vendor = await tx.select().from(vendors)
          .where(withTenant(vendors, tenantId, eq(vendors.id, vendorId)))
          .limit(1);

        if (vendor.length === 0) {
          throw new NotFoundError('Vendor');
        }

      // Fetch outstanding invoices (FIFO)
      const outstandingInvoices = await tx.select().from(purchaseInvoices)
        .where(withTenant(purchaseInvoices, tenantId, and(
          eq(purchaseInvoices.vendorId, vendorId),
          or(
            eq(purchaseInvoices.status, 'Unpaid'),
            eq(purchaseInvoices.status, 'Partially Paid')
          ),
          gt(purchaseInvoices.balanceAmount, '0')
        )))
        .orderBy(asc(purchaseInvoices.invoiceDate), asc(purchaseInvoices.createdAt));

      if (outstandingInvoices.length === 0) {
        throw new ValidationError('No outstanding invoices found for this vendor', {
          vendorId: 'This vendor has no unpaid or partially paid invoices'
        });
      }

      let remainingPaymentAmount = parseFloat(paymentData.amount);
      const distributedAmount = parseFloat(paymentData.amount);
      const paymentsCreated: Payment[] = [];
      const invoicesUpdated: string[] = [];

      // Distribute payment amount across invoices
      for (const invoice of outstandingInvoices) {
        if (remainingPaymentAmount <= 0) break;

        const invoiceBalance = parseFloat(invoice.balanceAmount);
        const allocation = Math.min(remainingPaymentAmount, invoiceBalance);

        // Create payment record
        const paymentInsert = ensureTenantInsert({
          invoiceId: invoice.id,
          vendorId: vendorId,
          amount: allocation.toFixed(2),
          paymentMode: paymentData.paymentMode,
          paymentDate: paymentData.paymentDate,
          bankAccountId: paymentData.bankAccountId,
          chequeNumber: paymentData.chequeNumber,
          upiReference: paymentData.upiReference,
          notes: paymentData.notes,
        }, tenantId);

        const [createdPayment] = await tx.insert(payments).values(paymentInsert).returning();
        paymentsCreated.push(createdPayment);

        // Update invoice
        const newPaidAmount = parseFloat(invoice.paidAmount || '0') + allocation;
        const newBalanceAmount = parseFloat(invoice.balanceAmount) - allocation;
        let newStatus = invoice.status;

        // Use epsilon threshold to handle floating-point precision issues
        const epsilon = 0.005; // Half a cent
        if (Math.abs(newBalanceAmount) < epsilon) {
          newStatus = 'Paid';
        } else if (newPaidAmount > 0) {
          newStatus = 'Partially Paid';
        } else {
          newStatus = 'Unpaid';
        }

        await tx.update(purchaseInvoices)
          .set({
            paidAmount: newPaidAmount.toFixed(2),
            balanceAmount: newBalanceAmount.toFixed(2),
            status: newStatus
          })
          .where(withTenant(purchaseInvoices, tenantId, eq(purchaseInvoices.id, invoice.id)));

        invoicesUpdated.push(invoice.id);
        remainingPaymentAmount -= allocation;
      }

      // Update vendor balance
      const newVendorBalance = parseFloat(vendor[0].balance || '0') - (distributedAmount - remainingPaymentAmount);
      await tx.update(vendors)
        .set({ balance: newVendorBalance.toFixed(2) })
        .where(withTenant(vendors, tenantId, eq(vendors.id, vendorId)));

      // Create cashbook/bankbook entry
      if (paymentsCreated.length > 0) {
        if (paymentData.paymentMode === 'Cash') {
          // Get current cashbook balance
          const lastCashEntry = await tx.select().from(cashbook)
            .where(withTenant(cashbook, tenantId))
            .orderBy(desc(cashbook.id))
            .limit(1)
            .for('update');

          const currentBalance = lastCashEntry.length > 0 ? parseFloat(lastCashEntry[0].balance) : 0;
          const newBalance = currentBalance - (distributedAmount - remainingPaymentAmount);

          await tx.insert(cashbook).values(ensureTenantInsert({
            date: paymentData.paymentDate,
            description: `Vendor Payment - ${vendor[0].name}`,
            outflow: (distributedAmount - remainingPaymentAmount).toFixed(2),
            inflow: '0.00',
            balance: newBalance.toFixed(2),
            referenceType: 'Payment',
            referenceId: paymentsCreated[0].id,
          }, tenantId));

          // Update tenant cash balance
          await TenantModel.setCashBalance(tx, tenantId, newBalance.toFixed(2));
        } else if ((paymentData.paymentMode === 'Bank' || paymentData.paymentMode === 'UPI' || paymentData.paymentMode === 'Cheque') && paymentData.bankAccountId) {
          // Get current bank balance
          const lastBankEntry = await tx.select().from(bankbook)
            .where(withTenant(bankbook, tenantId, eq(bankbook.bankAccountId, paymentData.bankAccountId)))
            .orderBy(desc(bankbook.date), desc(bankbook.id))
            .limit(1)
            .for('update');

          const currentBalance = lastBankEntry.length > 0 ? parseFloat(lastBankEntry[0].balance) : 0;
          const newBalance = currentBalance - (distributedAmount - remainingPaymentAmount);

          await tx.insert(bankbook).values(ensureTenantInsert({
            bankAccountId: paymentData.bankAccountId,
            date: paymentData.paymentDate,
            description: `Vendor Payment - ${vendor[0].name}`,
            credit: (distributedAmount - remainingPaymentAmount).toFixed(2),
            debit: '0.00',
            balance: newBalance.toFixed(2),
            referenceType: 'Payment',
            referenceId: paymentsCreated[0].id,
          }, tenantId));

          // Align bank account balance with bankbook running balance
          await BankAccountModel.setBankAccountBalance(tx, tenantId, paymentData.bankAccountId, newBalance.toFixed(2));
        }
      }

      return {
        totalAmount: paymentData.amount,
        distributedAmount: (distributedAmount - remainingPaymentAmount).toFixed(2),
        remainingAmount: remainingPaymentAmount.toFixed(2),
        paymentsCreated,
        invoicesUpdated,
        vendorBalanceAfter: newVendorBalance.toFixed(2),
      };
    });
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }

  async getOutstandingInvoicesForVendor(tenantId: string, vendorId: string): Promise<PurchaseInvoice[]> {
    return await db.select().from(purchaseInvoices)
      .where(withTenant(purchaseInvoices, tenantId, and(
        eq(purchaseInvoices.vendorId, vendorId),
        or(
          eq(purchaseInvoices.status, 'Unpaid'),
          eq(purchaseInvoices.status, 'Partially Paid')
        ),
        gt(purchaseInvoices.balanceAmount, '0')
      )))
      .orderBy(asc(purchaseInvoices.invoiceDate));
  }

  async deletePayment(tenantId: string, paymentId: string): Promise<boolean> {
    try {
      return await db.transaction(async (tx) => {
      // Fetch the payment record with tenant filtering
      const [payment] = await tx.select().from(payments)
        .where(withTenant(payments, tenantId, eq(payments.id, paymentId)));
      
      if (!payment) {
        return false;
      }

      // Comment 1: Batch detection for purchase payments
      // Find all payments that could be part of the same batch distribution
      // Payments in the same batch have same vendor, payment mode, date, and bank account
      const batchPayments = await tx.select().from(payments)
        .where(withTenant(payments, tenantId, and(
          eq(payments.vendorId, payment.vendorId),
          eq(payments.paymentMode, payment.paymentMode),
          eq(payments.paymentDate, payment.paymentDate),
          payment.bankAccountId ? eq(payments.bankAccountId, payment.bankAccountId) : sql`${payments.bankAccountId} IS NULL`
        )));

      let paymentsToDelete = [payment];
      let isBatchDistribution = false;
      let firstPaymentId = payment.id;

      if (batchPayments.length > 1) {
        // This is likely a batch distribution - check if they share a ledger entry
        const ledgerEntry = await tx.select().from(payment.paymentMode === 'Cash' ? cashbook : bankbook)
          .where(withTenant(
            payment.paymentMode === 'Cash' ? cashbook : bankbook, 
            tenantId, 
            and(
              eq((payment.paymentMode === 'Cash' ? cashbook : bankbook).referenceType, 'Payment'),
              inArray((payment.paymentMode === 'Cash' ? cashbook : bankbook).referenceId, batchPayments.map(p => p.id))
            )
          ));

        if (ledgerEntry.length === 1 && ledgerEntry[0].referenceId) {
          // Confirmed batch distribution - all payments share one ledger entry
          paymentsToDelete = batchPayments;
          isBatchDistribution = true;
          firstPaymentId = ledgerEntry[0].referenceId;
        }
      }

      // Store payment details for later use - sum up all amounts for batch
      const paymentAmount = paymentsToDelete.reduce((sum, p) => sum + parseFloat(p.amount), 0);
      const invoiceId = payment.invoiceId;
      const vendorId = payment.vendorId;
      const paymentMode = payment.paymentMode;
      const bankAccountId = payment.bankAccountId;

      // Fetch the invoice
      const [invoice] = await tx.select().from(purchaseInvoices)
        .where(withTenant(purchaseInvoices, tenantId, eq(purchaseInvoices.id, invoiceId)));
      
      if (!invoice) {
        throw new NotFoundError('Purchase invoice');
      }

      // Fetch the vendor
      const [vendor] = await tx.select().from(vendors)
        .where(withTenant(vendors, tenantId, eq(vendors.id, vendorId)));
      
      if (!vendor) {
        throw new NotFoundError('Vendor');
      }

      // Comment 1: Delete all payments in batch and handle affected invoices
      if (isBatchDistribution) {
        // Delete all payments in the batch
        await tx.delete(payments)
          .where(withTenant(payments, tenantId, inArray(payments.id, paymentsToDelete.map(p => p.id))));

        // Collect all affected invoices and update them
        const affectedInvoiceIds = Array.from(new Set(paymentsToDelete.map(p => p.invoiceId)));
        
        for (const affectedInvoiceId of affectedInvoiceIds) {
          // Fetch remaining payments for this invoice (after deletion)
          const remainingPayments = await tx.select().from(payments)
            .where(withTenant(payments, tenantId, eq(payments.invoiceId, affectedInvoiceId)));

          // Fetch the invoice  
          const [affectedInvoice] = await tx.select().from(purchaseInvoices)
            .where(withTenant(purchaseInvoices, tenantId, eq(purchaseInvoices.id, affectedInvoiceId)));
          
          if (affectedInvoice) {
            // Calculate new invoice amounts
            const newPaidAmount = remainingPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
            const newBalanceAmount = parseFloat(affectedInvoice.netAmount) - newPaidAmount;
            
            // Use epsilon (0.005) to determine new status
            const epsilon = 0.005;
            let newStatus: string;
            if (newBalanceAmount <= epsilon) {
              newStatus = 'Paid';
            } else if (newPaidAmount > epsilon) {
              newStatus = 'Partially Paid';
            } else {
              newStatus = 'Unpaid';
            }
            
            // Update the affected invoice
            await tx.update(purchaseInvoices)
              .set({
                paidAmount: newPaidAmount.toFixed(2),
                balanceAmount: Math.max(0, newBalanceAmount).toFixed(2),
                status: newStatus as any
              })
              .where(withTenant(purchaseInvoices, tenantId, eq(purchaseInvoices.id, affectedInvoiceId)));
          }
        }
      } else {
        // Single payment deletion (original logic)
        await tx.delete(payments)
          .where(withTenant(payments, tenantId, eq(payments.id, paymentId)));

        // Calculate new invoice amounts for single payment
        const remainingPayments = await tx.select().from(payments)
          .where(withTenant(payments, tenantId, eq(payments.invoiceId, invoiceId)));

        const newPaidAmount = remainingPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
        const newBalanceAmount = parseFloat(invoice.netAmount) - newPaidAmount;
        
        // Use epsilon (0.005) to determine new status
        const epsilon = 0.005;
        let newStatus: string;
        if (newBalanceAmount <= epsilon) {
          newStatus = 'Paid';
        } else if (newPaidAmount > epsilon) {
          newStatus = 'Partially Paid';
        } else {
          newStatus = 'Unpaid';
        }

        // Update the invoice with new amounts and status
        await tx.update(purchaseInvoices)
          .set({
            paidAmount: newPaidAmount.toFixed(2),
            balanceAmount: Math.max(0, newBalanceAmount).toFixed(2),
            status: newStatus as any
          })
          .where(withTenant(purchaseInvoices, tenantId, eq(purchaseInvoices.id, invoiceId)));
      }

      // Comment 2: Update vendor balance using applied amount from ledger entry
      let appliedAmount = paymentAmount; // Default fallback
      
      // Read the ledger entry to get the actual applied amount
      if (paymentMode === 'Cash') {
        const [ledgerEntry] = await tx.select().from(cashbook)
          .where(withTenant(cashbook, tenantId, and(
            eq(cashbook.referenceType, 'Payment'),
            eq(cashbook.referenceId, firstPaymentId)
          )));
        if (ledgerEntry && ledgerEntry.outflow) {
          appliedAmount = parseFloat(ledgerEntry.outflow);
        }
      } else if (paymentMode === 'Bank' || paymentMode === 'UPI' || paymentMode === 'Cheque') {
        const [ledgerEntry] = await tx.select().from(bankbook)
          .where(withTenant(bankbook, tenantId, and(
            eq(bankbook.referenceType, 'Payment'),
            eq(bankbook.referenceId, firstPaymentId)
          )));
        if (ledgerEntry && ledgerEntry.credit) {
          appliedAmount = parseFloat(ledgerEntry.credit);
        }
      }
      
      const newVendorBalance = parseFloat(vendor.balance || '0') + appliedAmount;
      await tx.update(vendors)
        .set({
          balance: newVendorBalance.toFixed(2)
        })
        .where(withTenant(vendors, tenantId, eq(vendors.id, vendorId)));

      // Comment 1: Delete ledger entry for batch (single entry references first payment)
      if (paymentMode === 'Cash') {
        await tx.delete(cashbook)
          .where(withTenant(cashbook, tenantId, and(
            eq(cashbook.referenceType, 'Payment'),
            eq(cashbook.referenceId, firstPaymentId)
          )));
      } else if (paymentMode === 'Bank' || paymentMode === 'UPI' || paymentMode === 'Cheque') {
        await tx.delete(bankbook)
          .where(withTenant(bankbook, tenantId, and(
            eq(bankbook.referenceType, 'Payment'),
            eq(bankbook.referenceId, firstPaymentId)
          )));
      }

      // Recalculate running balance
      if (paymentMode === 'Cash') {
        // For Cash: fetch last cashbook entry, get its balance, update tenant cash balance
        const [lastCashEntry] = await tx.select().from(cashbook)
          .where(withTenant(cashbook, tenantId))
          .orderBy(desc(cashbook.id))
          .limit(1);
        
        const newCashBalance = lastCashEntry ? lastCashEntry.balance : '0.00';
        await TenantModel.setCashBalance(tx, tenantId, newCashBalance);

        // Comment 3 Fix: Recalculate running balances for all subsequent cashbook entries
        const allCashEntries = await tx.select().from(cashbook)
          .where(withTenant(cashbook, tenantId))
          .orderBy(asc(cashbook.date), asc(cashbook.id));
        
        let runningBalance = 0.00;
        for (const entry of allCashEntries) {
          runningBalance += parseFloat(entry.inflow || '0') - parseFloat(entry.outflow || '0');
          
          await tx.update(cashbook)
            .set({ balance: runningBalance.toFixed(2) })
            .where(withTenant(cashbook, tenantId, eq(cashbook.id, entry.id)));
        }
        
      } else if (bankAccountId && (paymentMode === 'Bank' || paymentMode === 'UPI' || paymentMode === 'Cheque')) {
        // For Bank/UPI/Cheque: recalculate bankbook running balances
        await BankAccountModel.recalculateBankAccountBalance(tx, tenantId, bankAccountId);
      }

      return true;
    });
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }
}