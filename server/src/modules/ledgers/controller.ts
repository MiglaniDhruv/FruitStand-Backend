import { Request, Response } from 'express';
import { z } from 'zod';
import { BaseController } from '../../utils/base';
import { LedgerModel } from './model';
import { TenantModel } from '../tenants/model';
import { type AuthenticatedRequest, ForbiddenError, BadRequestError, NotFoundError } from '../../types';

const ledgerValidation = {
  getCashbook: z.object({
    fromDate: z.string().optional().refine(val => {
      if (!val) return true;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format for fromDate'),
    toDate: z.string().optional().refine(val => {
      if (!val) return true;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format for toDate'),
  }).refine(({fromDate, toDate}) => !fromDate || !toDate || new Date(fromDate) <= new Date(toDate), {
    message: 'fromDate must be before or equal to toDate'
  }),
  getBankbook: z.object({
    bankAccountId: z.string().uuid().optional(),
    fromDate: z.string().optional().refine(val => {
      if (!val) return true;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format for fromDate'),
    toDate: z.string().optional().refine(val => {
      if (!val) return true;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format for toDate'),
  }).refine(({fromDate, toDate}) => !fromDate || !toDate || new Date(fromDate) <= new Date(toDate), {
    message: 'fromDate must be before or equal to toDate'
  }),
  getVendorLedger: z.object({
    vendorId: z.string().uuid().optional(),
    fromDate: z.string().optional().refine(val => {
      if (!val) return true;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format for fromDate'),
    toDate: z.string().optional().refine(val => {
      if (!val) return true;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format for toDate'),
  }).refine(({fromDate, toDate}) => !fromDate || !toDate || new Date(fromDate) <= new Date(toDate), {
    message: 'fromDate must be before or equal to toDate'
  }),
  getRetailerLedger: z.object({
    retailerId: z.string().uuid().optional(),
    fromDate: z.string().optional().refine(val => {
      if (!val) return true;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format for fromDate'),
    toDate: z.string().optional().refine(val => {
      if (!val) return true;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format for toDate'),
  }).refine(({fromDate, toDate}) => !fromDate || !toDate || new Date(fromDate) <= new Date(toDate), {
    message: 'fromDate must be before or equal to toDate'
  }),
  getCrateLedger: z.object({
    retailerId: z.string().uuid().optional(),
    fromDate: z.string().optional().refine(val => {
      if (!val) return true;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format for fromDate'),
    toDate: z.string().optional().refine(val => {
      if (!val) return true;
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Invalid date format for toDate'),
  }).refine(({fromDate, toDate}) => !fromDate || !toDate || new Date(fromDate) <= new Date(toDate), {
    message: 'fromDate must be before or equal to toDate'
  })
};

export class LedgerController extends BaseController {
  private ledgerModel: LedgerModel;

  constructor() {
    super();
    this.ledgerModel = new LedgerModel();
  }

  async getCashbook(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedQuery = ledgerValidation.getCashbook.parse((req as any).query);
    const { fromDate, toDate } = validatedQuery;
    
    const cashbook = await this.ledgerModel.getCashbook(tenantId, fromDate, toDate);
    res.json(cashbook);
  }

  async getBankbook(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedQuery = ledgerValidation.getBankbook.parse((req as any).query);
    const { bankAccountId, fromDate, toDate } = validatedQuery;
    
    // If bankAccountId is provided, return individual transactions
    // Otherwise, return summary of all bank accounts
    if (bankAccountId) {
      const bankbook = await this.ledgerModel.getBankbook(tenantId, bankAccountId, fromDate, toDate);
      res.json(bankbook);
    } else {
      const summary = await this.ledgerModel.getAllBankAccountsSummary(tenantId, fromDate, toDate);
      res.json(summary);
    }
  }

  async getVendorLedger(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedQuery = ledgerValidation.getVendorLedger.parse((req as any).query);
    const { vendorId, fromDate, toDate } = validatedQuery;
    
    if (vendorId) {
      this.validateUUID(vendorId, 'Vendor ID');

      // Check if vendor exists
      const vendor = await this.ledgerModel.getVendorById(tenantId, vendorId);
      this.ensureResourceExists(vendor, 'Vendor');

      const ledger = await this.ledgerModel.getVendorLedger(tenantId, vendorId, fromDate, toDate);
      res.json(ledger);
    } else {
      const summary = await this.ledgerModel.getAllVendorsSummary(tenantId, fromDate, toDate);
      res.json(summary);
    }
  }

  async getRetailerLedger(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedQuery = ledgerValidation.getRetailerLedger.parse((req as any).query);
    const { retailerId, fromDate, toDate } = validatedQuery;
    
    if (retailerId) {
      this.validateUUID(retailerId, 'Retailer ID');

      // Check if retailer exists
      const retailer = await this.ledgerModel.getRetailerById(tenantId, retailerId);
      this.ensureResourceExists(retailer, 'Retailer');

      const ledger = await this.ledgerModel.getRetailerLedger(tenantId, retailerId, fromDate, toDate);
      res.json(ledger);
    } else {
      const summary = await this.ledgerModel.getAllRetailersSummary(tenantId, fromDate, toDate);
      res.json(summary);
    }
  }

  async getUdhaaarBook(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const udhaaarBook = await this.ledgerModel.getUdhaaarBook(tenantId);
    res.json(udhaaarBook);
  }

  async getCrateLedger(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedQuery = ledgerValidation.getCrateLedger.parse((req as any).query);
    const { retailerId, fromDate, toDate } = validatedQuery;
    
    // If retailerId is provided, validate UUID format and existence
    if (retailerId) {
      this.validateUUID(retailerId, 'Retailer ID');
      const retailer = await this.ledgerModel.getRetailerById(tenantId, retailerId);
      this.ensureResourceExists(retailer, 'Retailer');
    }
    
    const crateLedger = await this.ledgerModel.getCrateLedger(tenantId, retailerId, fromDate, toDate);
    res.json(crateLedger);
  }

  async getCashbookStatus(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const latestEntry = await this.ledgerModel.getLatestCashbookEntry(tenantId);
    const hasEntries = latestEntry !== null;
    const currentBalance = await TenantModel.getCashBalance(tenantId);
    
    res.json({
      hasEntries,
      currentBalance
    });
  }

  async getKpi(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const cashBalance = await TenantModel.getCashBalance(tenantId);
    const bankStats = await this.ledgerModel.getBankAccountStats(tenantId);
    
    res.json({
      cashBalance: typeof cashBalance === 'string' ? parseFloat(cashBalance) : cashBalance,
      totalBankBalance: parseFloat(bankStats.totalBalance)
    });
  }
}