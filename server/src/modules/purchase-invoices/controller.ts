import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { BaseController } from '../../utils/base';
import { PurchaseInvoiceModel } from './model';
import schema from '../../../shared/schema.js';
import { ForbiddenError, BadRequestError, NotFoundError } from '../../types';
import { invoiceGenerator } from '../../services/pdf';
import { TenantModel } from '../tenants/model';
import { db } from '../../../db';
import { and, eq } from 'drizzle-orm';

const { 
  insertPurchaseInvoiceSchema, 
  insertInvoiceItemSchema, 
  insertCrateTransactionSchema, 
  payments, 
  INVOICE_STATUS 
} = schema;

// Type inference for body using Zod
type PurchaseInvoiceBody = z.infer<typeof purchaseInvoiceBodySchema>;

// Define the purchase invoice body schema
const purchaseInvoiceBodySchema = z.object({
  invoice: insertPurchaseInvoiceSchema.omit({ tenantId: true }),
  items: z.array(insertInvoiceItemSchema.omit({ invoiceId: true, tenantId: true })),
  crateTransaction: z.object({
    partyType: z.enum(['retailer', 'vendor']),
    vendorId: z.string().uuid().optional(),
    retailerId: z.string().uuid().optional(),
    transactionType: z.enum(['Given', 'Received']),
    quantity: z.coerce.number(),
    transactionDate: z.union([z.string(), z.date()]).transform((val) => 
      typeof val === 'string' ? new Date(val) : val
    ),
    notes: z.string().optional(),
  }).optional(),
  stockOutEntryIds: z.array(z.string().uuid()).optional(),
});

const shareInvoiceParamsSchema = z.object({
  id: z.string().uuid('Invalid invoice ID format')
});

export class PurchaseInvoiceController extends BaseController {
  private purchaseInvoiceModel: PurchaseInvoiceModel;

  constructor() {
    super();
    this.purchaseInvoiceModel = new PurchaseInvoiceModel();
  }

  async getAll(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { page, limit, search, sortBy, sortOrder, status, vendorId, dateFrom, dateTo, paginated } = req.query;

    const validSortFields = ['invoiceDate', 'invoiceNumber', 'totalAmount', 'status', 'createdAt'];
    const sortByValue = typeof sortBy === 'string' && validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortOrderValue = sortOrder === 'asc' ? 'asc' : 'desc';
    const doPaginate = paginated === 'true';

    if (doPaginate) {
      const options = {
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 10,
        search: search as string,
        sortBy: sortByValue,
        sortOrder: sortOrderValue as 'asc' | 'desc',
        status: status as 'paid' | 'unpaid' | undefined,
        vendorId: vendorId as string,
        dateRange: { from: dateFrom as string, to: dateTo as string }
      };

      const result = await this.purchaseInvoiceModel.getPurchaseInvoicesPaginated(tenantId, options);
      return this.sendPaginatedResponse(res, result.data, result.pagination);
    } else {
      const invoices = await this.purchaseInvoiceModel.getPurchaseInvoices(tenantId);
      res.json(invoices);
    }
  }

  async getById(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { id } = req.params;
    if (!id) throw new BadRequestError('Invoice ID is required');

    const invoice = await this.purchaseInvoiceModel.getPurchaseInvoice(tenantId, id);
    this.ensureResourceExists(invoice, 'Invoice');

    res.json(invoice);
  }

  async create(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const validatedData = this.validateZodSchema(purchaseInvoiceBodySchema, req.body) as PurchaseInvoiceBody;
    const { invoice: invoiceData, items: itemsData, crateTransaction, stockOutEntryIds } = validatedData;

    const invoiceWithTenant = { 
      ...invoiceData, 
      tenantId,
      invoiceDate: new Date(invoiceData.invoiceDate)
    };
    const itemsWithTenant = itemsData.map(item => ({ ...item, tenantId }));
    const crateTransactionWithTenant = crateTransaction ? { 
      ...crateTransaction, 
      tenantId,
      transactionDate: new Date(crateTransaction.transactionDate)
    } : undefined;

    const invoice = await this.wrapDatabaseOperation(() =>
      this.purchaseInvoiceModel.createPurchaseInvoice(
        tenantId, 
        invoiceWithTenant, 
        itemsWithTenant as any,
        crateTransactionWithTenant,
        stockOutEntryIds
      )
    );

    res.status(201).json(invoice);
  }

  async update(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { id } = req.params;
    if (!id) throw new BadRequestError('Purchase invoice ID is required');
    this.validateUUID(id, 'Purchase invoice ID');

    const validatedData = this.validateZodSchema(purchaseInvoiceBodySchema, req.body) as PurchaseInvoiceBody;
    const { invoice: invoiceData, items: itemsData, crateTransaction, stockOutEntryIds } = validatedData;

    const invoiceWithTenant = { 
      ...invoiceData, 
      tenantId,
      invoiceDate: new Date(invoiceData.invoiceDate)
    };
    const itemsWithTenant = itemsData.map(item => ({ ...item, tenantId }));
    const crateTransactionWithTenant = crateTransaction ? { 
      ...crateTransaction, 
      tenantId,
      transactionDate: new Date(crateTransaction.transactionDate)
    } : undefined;

    const invoice = await this.wrapDatabaseOperation(() =>
      this.purchaseInvoiceModel.updatePurchaseInvoice(
        tenantId, 
        id,
        invoiceWithTenant, 
        itemsWithTenant as any,
        crateTransactionWithTenant,
        stockOutEntryIds
      )
    );

    res.status(200).json(invoice);
  }

  async createShareLink(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { id: invoiceId } = this.validateZodSchema(shareInvoiceParamsSchema, req.params);

    const shareLink = await this.purchaseInvoiceModel.createShareLink(tenantId, invoiceId);

    res.status(201).json({
      success: true,
      data: {
        shareLink,
        publicUrl: `${req.protocol}://${req.get('host')}/api/public/invoices/${shareLink.token}`
      }
    });
  }

  async delete(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { id } = req.params;
    if (!id) throw new BadRequestError('Invoice ID is required');
    this.validateUUID(id, 'Purchase invoice ID');

    const invoice = await this.wrapDatabaseOperation(() =>
      this.purchaseInvoiceModel.getPurchaseInvoice(tenantId, id)
    );
    if (!invoice) throw new NotFoundError('Purchase invoice');

    if (invoice.status !== INVOICE_STATUS.UNPAID) {
      throw new BadRequestError('Only unpaid invoices can be deleted.');
    }

    const success = await this.wrapDatabaseOperation(() =>
      this.purchaseInvoiceModel.deletePurchaseInvoice(tenantId, id)
    );

    if (!success) throw new NotFoundError('Invoice not found');

    res.status(204).send();
  }

  async downloadPDF(req: Request, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const { id } = req.params;
    if (!id) throw new BadRequestError('Purchase invoice ID is required');
    this.validateUUID(id, 'Purchase invoice ID');

    const invoice = await this.wrapDatabaseOperation(() =>
      this.purchaseInvoiceModel.getPurchaseInvoice(tenantId, id)
    );
    this.ensureResourceExists(invoice, 'Purchase invoice');

    const paymentsData = await db.select().from(payments).where(
      and(eq(payments.tenantId, tenantId), eq(payments.invoiceId, id))
    );

    const invoiceWithPayments = { ...invoice!, payments: paymentsData };
    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) throw new NotFoundError('Tenant');

    const { doc, stream } = await invoiceGenerator.generatePurchaseInvoicePDF(invoiceWithPayments, tenant);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="purchase-invoice-${invoice!.invoiceNumber}.pdf"`);

    stream.on('error', (err) => {
      if (!res.headersSent) return next(err);
      res.destroy(err);
    });

    stream.pipe(res);
  }
}
