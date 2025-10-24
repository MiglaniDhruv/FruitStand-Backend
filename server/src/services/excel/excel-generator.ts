import ExcelJS from 'exceljs';
import { z } from 'zod';
import schema from '../../../shared/schema';
import { Buffer } from 'node:buffer';

type Tenant = typeof schema.tenants.$inferSelect;

// ✅ Extract TypeScript types from Zod schemas
type TurnoverReportData = z.infer<typeof schema.TurnoverReportData>;
type ProfitLossReportData = z.infer<typeof schema.ProfitLossReportData>;
type CommissionReportData = z.infer<typeof schema.CommissionReportData>;
type ShortfallReportData = z.infer<typeof schema.ShortfallReportData>;
type ExpensesSummaryData = z.infer<typeof schema.ExpensesSummaryData>;
type VendorsListData = z.infer<typeof schema.VendorsListData>;
type RetailersListData = z.infer<typeof schema.RetailersListData>;

import {
  renderTurnoverReportTemplate,
  renderProfitLossReportTemplate,
  renderCommissionReportTemplate,
  renderShortfallReportTemplate,
  renderExpensesSummaryTemplate,
  renderVendorsListTemplate,
  renderRetailersListTemplate,
} from './excel-templates';

export class ExcelGenerator {
  private async generateReport<T>(
    renderFn: (
      workbook: ExcelJS.Workbook,
      data: T,
      tenant: Tenant,
      fromDate?: string,
      toDate?: string
    ) => void,
    reportData: T,
    tenant: Tenant,
    fromDate?: string,
    toDate?: string
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    renderFn(workbook, reportData, tenant, fromDate, toDate);

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  generateTurnoverReport(reportData: TurnoverReportData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(
      renderTurnoverReportTemplate,
      reportData,
      tenant,
      reportData.fromDate,
      reportData.toDate
    );
  }

  generateProfitLossReport(reportData: ProfitLossReportData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(
      renderProfitLossReportTemplate,
      reportData,
      tenant,
      reportData.fromDate,
      reportData.toDate
    );
  }

  generateCommissionReport(reportData: CommissionReportData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(
      renderCommissionReportTemplate,
      reportData,
      tenant,
      reportData.fromDate,
      reportData.toDate
    );
  }

  generateShortfallReport(reportData: ShortfallReportData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(
      renderShortfallReportTemplate,
      reportData,
      tenant,
      reportData.fromDate,
      reportData.toDate
    );
  }

  generateExpensesSummary(reportData: ExpensesSummaryData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(
      renderExpensesSummaryTemplate,
      reportData,
      tenant,
      reportData.fromDate,
      reportData.toDate
    );
  }

  generateVendorsList(reportData: VendorsListData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(renderVendorsListTemplate, reportData, tenant);
  }

  generateRetailersList(reportData: RetailersListData, tenant: Tenant): Promise<Buffer> {
    return this.generateReport(renderRetailersListTemplate, reportData, tenant);
  }
}

export const excelGenerator = new ExcelGenerator();