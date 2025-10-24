import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import schema from '../../../shared/schema.js';

const { insertSalesInvoiceSchema, insertSalesInvoiceItemSchema, insertCrateTransactionSchema, INVOICE_STATUS } = schema;
import { BaseController } from '../../utils/base';
import { SalesInvoiceModel } from './model';
import { type AuthenticatedRequest, NotFoundError, ValidationError, BadRequestError, ForbiddenError } from '../../types';
import { invoiceGenerator } from '../../services/pdf';
import { TenantModel } from '../tenants/model';

// ✅ Define proper types for z.infer
type SalesInvoiceWithDetails = z.infer<typeof schema.SalesInvoiceWithDetails>;

const salesInvoiceValidation = {
  createSalesInvoice: z.object({
    invoice: insertSalesInvoiceSchema,
    items: z.array(insertSalesInvoiceItemSchema).min(1),
    crateTransaction: insertCrateTransactionSchema.optional(),
  }),
  updateSalesInvoice: z.object({
    invoice: insertSalesInvoiceSchema,
    items: z.array(insertSalesInvoiceItemSchema).min(1),
    crateTransaction: insertCrateTransactionSchema.optional(),
  }),
  getSalesInvoicesPaginated: z.object({
    page: z.string().optional().transform(val => val ? parseInt(val, 10) : undefined),
    limit: z.string().optional().transform(val => val ? parseInt(val, 10) : undefined),
    search: z.string().optional(),
    status: z.enum(['paid', 'unpaid']).optional(),
    retailerId: z.string().uuid().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    dateRange: z.object({
      from: z.string().optional(),
      to: z.string().optional()
    }).optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    paginated: z.string().optional()
  })
};

const shareInvoiceParamsSchema = z.object({
  id: z.string().uuid('Invalid invoice ID format')
});

export class SalesInvoiceController extends BaseController {
  private salesInvoiceModel: SalesInvoiceModel;

  constructor() {
    super();
    this.salesInvoiceModel = new SalesInvoiceModel();
  }

  async getSalesInvoices(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const salesInvoices = await this.salesInvoiceModel.getSalesInvoices(tenantId);
    res.json(salesInvoices);
  }

  async getSalesInvoice(req: AuthenticatedRequest<{}, {}, {}, { id: string }>, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const { id } = (req as any).params;
    
    if (!id) throw new BadRequestError('Sales invoice ID is required');

    this.validateUUID(id, 'Sales invoice ID');

    const salesInvoice = await this.salesInvoiceModel.getSalesInvoice(tenantId, id);
    this.ensureResourceExists(salesInvoice, 'Sales invoice');

    res.json(salesInvoice);
  }

  async createSalesInvoice(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Inject tenantId into invoice, items, and crateTransaction before validation
    const requestData = {
      invoice: { ...(req as any).body.invoice, tenantId },
      items: (req as any).body.items?.map((item: any) => ({ ...item, tenantId })) || [],
      crateTransaction: (req as any).body.crateTransaction ? { ...(req as any).body.crateTransaction, tenantId } : undefined,
    };
    
    const validatedData = this.validateZodSchema(salesInvoiceValidation.createSalesInvoice, requestData);

    const { invoice, items, crateTransaction } = validatedData;
    
    // Ensure invoiceDate is a Date object
    const processedInvoice = {
      ...invoice,
      invoiceDate: typeof invoice.invoiceDate === 'string' ? new Date(invoice.invoiceDate) : invoice.invoiceDate
    };
    
    // Ensure crateTransaction transactionDate is a Date object if present
    const processedCrateTransaction = crateTransaction ? {
      ...crateTransaction,
      transactionDate: typeof crateTransaction.transactionDate === 'string' 
        ? new Date(crateTransaction.transactionDate) 
        : crateTransaction.transactionDate
    } : crateTransaction;
    
    const result = await this.salesInvoiceModel.createSalesInvoice(tenantId, processedInvoice, items, processedCrateTransaction);
    
    res.status(201).json(result);
  }

  async updateSalesInvoice(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { id } = (req as any).params;
    if (!id) throw new BadRequestError('Sales invoice ID is required');
    this.validateUUID(id, 'Sales invoice ID');
    
    // Inject tenantId into invoice, items, and crateTransaction before validation
    const requestData = {
      invoice: { ...(req as any).body.invoice, tenantId },
      items: (req as any).body.items?.map((item: any) => ({ ...item, tenantId })) || [],
      crateTransaction: (req as any).body.crateTransaction ? { ...(req as any).body.crateTransaction, tenantId } : undefined,
    };
    
    const validatedData = this.validateZodSchema(salesInvoiceValidation.updateSalesInvoice, requestData);

    const { invoice, items, crateTransaction } = validatedData;
    
    // Ensure invoiceDate is a Date object
    const processedInvoice = {
      ...invoice,
      invoiceDate: typeof invoice.invoiceDate === 'string' ? new Date(invoice.invoiceDate) : invoice.invoiceDate
    };
    
    // Ensure crateTransaction transactionDate is a Date object if present
    const processedCrateTransaction = crateTransaction ? {
      ...crateTransaction,
      transactionDate: typeof crateTransaction.transactionDate === 'string' 
        ? new Date(crateTransaction.transactionDate) 
        : crateTransaction.transactionDate
    } : crateTransaction;
    
    const result = await this.salesInvoiceModel.updateSalesInvoice(tenantId, id, processedInvoice, items, processedCrateTransaction);
    
    res.status(200).json(result);
  }

  async markSalesInvoiceAsPaid(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    const { id } = (req as any).params;
    
    if (!id) throw new BadRequestError('Sales invoice ID is required');
    this.validateUUID(id, 'Sales invoice ID');

    const result = await this.salesInvoiceModel.markSalesInvoiceAsPaid(tenantId, id);
    
    res.json(result);
  }

  async getSalesInvoicesPaginated(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validationResult = salesInvoiceValidation.getSalesInvoicesPaginated.safeParse((req as any).query);
    if (!validationResult.success) {
      throw new ValidationError('Invalid query parameters', validationResult.error);
    }
    const validatedQuery = validationResult.data;

    const { dateFrom, dateTo, ...restOptions } = validatedQuery;
    
    // Map legacy dateFrom/dateTo to dateRange
    const options = {
      ...restOptions,
      dateRange: (dateFrom || dateTo) ? {
        from: dateFrom,
        to: dateTo
      } : restOptions.dateRange
    };
    
    // Check if this should return all invoices or paginated
    if (options.paginated === 'false' || (!options.page && !options.limit && !options.paginated)) {
      const allInvoices = await this.salesInvoiceModel.getSalesInvoices(tenantId);
      return res.json(allInvoices);
    }
    
    const result = await this.salesInvoiceModel.getSalesInvoicesPaginated(tenantId, options);
    
    // Ensure pagination metadata has all required fields
    const paginationMetadata = {
      page: result.pagination.page ?? 1,
      limit: result.pagination.limit ?? 10,
      total: result.pagination.total ?? 0,
      totalPages: result.pagination.totalPages ?? 0,
      hasNext: result.pagination.hasNext ?? false,
      hasPrevious: result.pagination.hasPrevious ?? false
    };
    
    return this.sendPaginatedResponse(res, result.data, paginationMetadata);
  }

  async createShareLink(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { id: invoiceId } = this.validateZodSchema(shareInvoiceParamsSchema, (req as any).params);
    
    const shareLink = await this.salesInvoiceModel.createShareLink(tenantId, invoiceId);
    
    res.status(201).json({
      success: true,
      data: {
        shareLink,
        publicUrl: `${(req as any).protocol}://${(req as any).get('host')}/api/public/invoices/${shareLink.token}`
      }
    });
  }

  async delete(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const { id } = (req as any).params;
    if (!id) throw new BadRequestError('Sales invoice ID is required');
    this.validateUUID(id, 'Sales Invoice ID');

    // Fetch invoice to validate existence and status
    const invoice = await this.wrapDatabaseOperation(() =>
      this.salesInvoiceModel.getSalesInvoice(tenantId, id)
    ) as SalesInvoiceWithDetails;
    
    if (!invoice) {
      throw new NotFoundError('Sales invoice not found');
    }

    if (invoice.status !== INVOICE_STATUS.UNPAID) {
      throw new BadRequestError('Cannot delete a paid or partially paid invoice. Only unpaid invoices can be deleted.');
    }

    const success = await this.wrapDatabaseOperation(() =>
      this.salesInvoiceModel.deleteSalesInvoice(tenantId, id)
    );
    
    if (!success) {
      // Race condition: re-fetch to determine if invoice was deleted or status changed
      const invoiceCheck = await this.wrapDatabaseOperation(() =>
        this.salesInvoiceModel.getSalesInvoice(tenantId, id)
      ) as SalesInvoiceWithDetails;
      
      if (invoiceCheck && invoiceCheck.status !== INVOICE_STATUS.UNPAID) {
        throw new BadRequestError('Cannot delete a paid or partially paid invoice. Only unpaid invoices can be deleted.');
      }
      
      throw new NotFoundError('Sales invoice not found');
    }

    res.status(204).send();
  }

  async downloadPDF(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const { id } = (req as any).params;
    if (!id) throw new BadRequestError('Sales invoice ID is required');
    this.validateUUID(id, 'Sales invoice ID');

    const salesInvoice = await this.wrapDatabaseOperation(() =>
      this.salesInvoiceModel.getSalesInvoice(tenantId, id)
    ) as SalesInvoiceWithDetails;
    this.ensureResourceExists(salesInvoice, 'Sales invoice');

    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) throw new NotFoundError('Tenant');

    const { doc, stream } = await invoiceGenerator.generateSalesInvoicePDF(salesInvoice!, tenant);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sales-invoice-${salesInvoice!.invoiceNumber}.pdf"`);

    stream.on('error', (err) => {
      if (!res.headersSent) return next(err);
      res.destroy(err);
    });

    stream.pipe(res);
  }
}