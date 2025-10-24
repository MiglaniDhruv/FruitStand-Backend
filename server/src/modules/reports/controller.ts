import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { BaseController } from '../../utils/base';
import { ReportModel } from './model';
import { AuthenticatedRequest, ForbiddenError, BadRequestError, NotFoundError } from '../../types';
import schema from '../../../shared/schema.js';
import { TenantModel } from '../tenants/model';
import { invoiceGenerator } from '../../services/pdf';
import { excelGenerator } from '../../services/excel';
import { PassThrough } from 'stream';

const { reportDateRangeSchema } = schema;

const reportValidation = {
  getVendorsList: z.object({}),
  getRetailersList: z.object({})
};

// Define query type for date range reports
type DateRangeQuery = {
  fromDate?: string;
  toDate?: string;
};

// Extend Express Request to include query
interface RequestWithQuery<Q> extends AuthenticatedRequest<any, any, any, Q> {
  query: Q;
}

export class ReportController extends BaseController {
  private reportModel: ReportModel;

  constructor() {
    super();
    this.reportModel = new ReportModel();
  }

  async getTurnoverReport(req: RequestWithQuery<DateRangeQuery>, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);

    const report = await this.reportModel.getTurnoverReport(tenantId, fromDate, toDate);
    res.json(report);
  }

  async getProfitLossReport(req: RequestWithQuery<DateRangeQuery>, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const report = await this.reportModel.getProfitLossReport(tenantId, fromDate, toDate);
    res.json(report);
  }

  async getCommissionReport(req: RequestWithQuery<DateRangeQuery>, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const report = await this.reportModel.getCommissionReport(tenantId, fromDate, toDate);
    res.json(report);
  }

  async getShortfallReport(req: RequestWithQuery<DateRangeQuery>, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const report = await this.reportModel.getShortfallReport(tenantId, fromDate, toDate);
    res.json(report);
  }

  async getExpensesSummary(req: RequestWithQuery<DateRangeQuery>, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const report = await this.reportModel.getExpensesSummary(tenantId, fromDate, toDate);
    res.json(report);
  }

  async getVendorsList(req: RequestWithQuery<any>, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedQuery = reportValidation.getVendorsList.parse(req.query);
    
    const report = await this.reportModel.getVendorsList(tenantId);
    res.json(report);
  }

  async getRetailersList(req: RequestWithQuery<any>, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedQuery = reportValidation.getRetailersList.parse(req.query);
    
    const report = await this.reportModel.getRetailersList(tenantId);
    res.json(report);
  }

  async downloadTurnoverReportPdf(req: RequestWithQuery<DateRangeQuery>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found');
    
    const reportData = await this.reportModel.getTurnoverReport(tenantId, fromDate, toDate);
    
    // Add date range to report data
    const pdfData = {
      ...reportData,
      fromDate: fromDate || '',
      toDate: toDate || ''
    };
    
    const { stream } = await invoiceGenerator.generateTurnoverReportPDF(pdfData, tenant);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="turnover-report.pdf"');
    
    stream.on('error', (err: Error) => {
      if (!res.headersSent) return next(err);
      res.destroy(err);
    });
    
    stream.pipe(res);
  }

  async downloadTurnoverReportExcel(req: RequestWithQuery<DateRangeQuery>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found');
    
    const reportData = await this.reportModel.getTurnoverReport(tenantId, fromDate, toDate);
    
    // Add date range to report data for Excel
    const excelData = {
      ...reportData,
      fromDate: fromDate || '',
      toDate: toDate || ''
    };
    
    const buffer = await excelGenerator.generateTurnoverReport(excelData, tenant);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="turnover-report.xlsx"');
    
    res.send(buffer);
  }

  async downloadProfitLossReportPdf(req: RequestWithQuery<DateRangeQuery>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found');
    
    const reportData = await this.reportModel.getProfitLossReport(tenantId, fromDate, toDate);
    
    // Add date range to report data
    const pdfData = {
      ...reportData,
      fromDate: fromDate || '',
      toDate: toDate || ''
    };
    
    const { stream } = await invoiceGenerator.generateProfitLossReportPDF(pdfData, tenant);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="profit-loss-report.pdf"');
    
    stream.on('error', (err: Error) => {
      if (!res.headersSent) return next(err);
      res.destroy(err);
    });
    
    stream.pipe(res);
  }

  async downloadProfitLossReportExcel(req: RequestWithQuery<DateRangeQuery>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found');
    
    const reportData = await this.reportModel.getProfitLossReport(tenantId, fromDate, toDate);
    
    // Add date range to report data for Excel
    const excelData = {
      ...reportData,
      fromDate: fromDate || '',
      toDate: toDate || ''
    };
    
    const buffer = await excelGenerator.generateProfitLossReport(excelData, tenant);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="profit-loss-report.xlsx"');
    
    res.send(buffer);
  }

  async downloadCommissionReportPdf(req: RequestWithQuery<DateRangeQuery>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found');
    
    const reportData = await this.reportModel.getCommissionReport(tenantId, fromDate, toDate);
    
    // Add date range to report data
    const pdfData = {
      ...reportData,
      fromDate: fromDate || '',
      toDate: toDate || ''
    };
    
    const { stream } = await invoiceGenerator.generateCommissionReportPDF(pdfData, tenant);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="commission-report.pdf"');
    
    stream.on('error', (err: Error) => {
      if (!res.headersSent) return next(err);
      res.destroy(err);
    });
    
    stream.pipe(res);
  }

  async downloadCommissionReportExcel(req: RequestWithQuery<DateRangeQuery>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found');
    
    const reportData = await this.reportModel.getCommissionReport(tenantId, fromDate, toDate);
    
    // Add date range to report data for Excel
    const excelData = {
      ...reportData,
      fromDate: fromDate || '',
      toDate: toDate || ''
    };
    
    const buffer = await excelGenerator.generateCommissionReport(excelData, tenant);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="commission-report.xlsx"');
    
    res.send(buffer);
  }

  async downloadShortfallReportPdf(req: RequestWithQuery<DateRangeQuery>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const reportData = await this.reportModel.getShortfallReport(tenantId, fromDate, toDate);
    const pdfData = { ...reportData, fromDate: fromDate || '', toDate: toDate || '' };
    
    const { stream } = await invoiceGenerator.generateShortfallReportPDF(pdfData, tenant);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="shortfall-report.pdf"');
    
    stream.on('error', (err) => {
      if (!res.headersSent) return next(err);
      res.destroy(err);
    });
    
    stream.pipe(res);
  }

  async downloadShortfallReportExcel(req: RequestWithQuery<DateRangeQuery>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const reportData = await this.reportModel.getShortfallReport(tenantId, fromDate, toDate);
    const excelData = { ...reportData, fromDate: fromDate || '', toDate: toDate || '' };
    
    const buffer = await excelGenerator.generateShortfallReport(excelData, tenant);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="shortfall-report.xlsx"');
    
    res.send(buffer);
  }

  async downloadExpensesSummaryPdf(req: RequestWithQuery<DateRangeQuery>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const reportData = await this.reportModel.getExpensesSummary(tenantId, fromDate, toDate);
    const pdfData = { ...reportData, fromDate: fromDate || '', toDate: toDate || '' };
    
    const { stream } = await invoiceGenerator.generateExpensesSummaryPDF(pdfData, tenant);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="expenses-summary.pdf"');
    
    stream.on('error', (err) => {
      if (!res.headersSent) return next(err);
      res.destroy(err);
    });
    
    stream.pipe(res);
  }

  async downloadExpensesSummaryExcel(req: RequestWithQuery<DateRangeQuery>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const reportData = await this.reportModel.getExpensesSummary(tenantId, fromDate, toDate);
    const excelData = { ...reportData, fromDate: fromDate || '', toDate: toDate || '' };
    
    const buffer = await excelGenerator.generateExpensesSummary(excelData, tenant);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="expenses-summary.xlsx"');
    
    res.send(buffer);
  }

  async downloadVendorsListPdf(req: RequestWithQuery<any>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const reportData = await this.reportModel.getVendorsList(tenantId);
    
    const { stream } = await invoiceGenerator.generateVendorsListPDF(reportData, tenant);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="vendors-list.pdf"');
    
    stream.on('error', (err) => {
      if (!res.headersSent) return next(err);
      res.destroy(err);
    });
    
    stream.pipe(res);
  }

  async downloadVendorsListExcel(req: RequestWithQuery<any>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const reportData = await this.reportModel.getVendorsList(tenantId);
    
    const buffer = await excelGenerator.generateVendorsList(reportData, tenant);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="vendors-list.xlsx"');
    
    res.send(buffer);
  }

  async downloadRetailersListPdf(req: RequestWithQuery<any>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const reportData = await this.reportModel.getRetailersList(tenantId);
    
    const { stream } = await invoiceGenerator.generateRetailersListPDF(reportData, tenant);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="retailers-list.pdf"');
    
    stream.on('error', (err) => {
      if (!res.headersSent) return next(err);
      res.destroy(err);
    });
    
    stream.pipe(res);
  }

  async downloadRetailersListExcel(req: RequestWithQuery<any>, res: Response, next: NextFunction) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const tenant = await TenantModel.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const reportData = await this.reportModel.getRetailersList(tenantId);
    
    const buffer = await excelGenerator.generateRetailersList(reportData, tenant);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="retailers-list.xlsx"');
    
    res.send(buffer);
  }
}