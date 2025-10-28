import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { BaseController } from '../../utils/base';
import { ReportModel } from './model';
import { type AuthenticatedRequest, ForbiddenError, BadRequestError, NotFoundError } from '../../types';
import schema from '../../../shared/schema.js';

const { reportDateRangeSchema } = schema;
import { TenantModel } from '../tenants/model';
import { invoiceGenerator } from '../../services/pdf';
import { excelGenerator } from '../../services/excel';
import { PassThrough } from 'stream';

const reportValidation = {
  getVendorsList: z.object({}),
  getRetailersList: z.object({})
};

export class ReportController extends BaseController {
  private reportModel: ReportModel;

  constructor() {
    super();
    this.reportModel = new ReportModel();
  }

  async getTurnoverReport(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const report = await this.reportModel.getTurnoverReport(tenantId, fromDate, toDate);
    res.json(report);
  }

  async getProfitLossReport(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const report = await this.reportModel.getProfitLossReport(tenantId, fromDate, toDate);
    res.json(report);
  }

  async getCommissionReport(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const report = await this.reportModel.getCommissionReport(tenantId, fromDate, toDate);
    res.json(report);
  }

  async getShortfallReport(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const report = await this.reportModel.getShortfallReport(tenantId, fromDate, toDate);
    res.json(report);
  }

  async getExpensesSummary(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { fromDate, toDate } = reportDateRangeSchema.parse(req.query);
    
    const report = await this.reportModel.getExpensesSummary(tenantId, fromDate, toDate);
    res.json(report);
  }

  async getVendorsList(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedQuery = reportValidation.getVendorsList.parse(req.query);
    
    const report = await this.reportModel.getVendorsList(tenantId);
    res.json(report);
  }

  async getRetailersList(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedQuery = reportValidation.getRetailersList.parse(req.query);
    
    const report = await this.reportModel.getRetailersList(tenantId);
    res.json(report);
  }

  async downloadTurnoverReportPdf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadTurnoverReportExcel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadProfitLossReportPdf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadProfitLossReportExcel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadCommissionReportPdf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadCommissionReportExcel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadShortfallReportPdf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadShortfallReportExcel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadExpensesSummaryPdf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadExpensesSummaryExcel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadVendorsListPdf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadVendorsListExcel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadRetailersListPdf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  async downloadRetailersListExcel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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