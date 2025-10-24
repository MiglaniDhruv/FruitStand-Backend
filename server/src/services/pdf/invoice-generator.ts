import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import { z } from 'zod';
import schema from '../../../shared/schema.js';

// Properly infer types from Zod schemas using z.infer
type SalesInvoiceWithDetails = z.infer<typeof schema.SalesInvoiceWithDetails>;
type ShortfallReportData = z.infer<typeof schema.ShortfallReportData>;
type ExpensesSummaryData = z.infer<typeof schema.ExpensesSummaryData>;
type VendorsListData = z.infer<typeof schema.VendorsListData>;
type RetailersListData = z.infer<typeof schema.RetailersListData>;

// For Drizzle table, use $inferSelect (if available) or define manually
type Tenant = typeof schema.tenants.$inferSelect extends infer T ? T : {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  settings: unknown;
  createdAt: Date;
};

import { 
  renderSalesInvoiceTemplate,
  renderPurchaseInvoiceTemplate,
  renderTurnoverReportTemplate,
  renderProfitLossReportTemplate,
  renderCommissionReportTemplate,
  renderShortfallReportTemplate,
  renderExpensesSummaryTemplate,
  renderVendorsListTemplate,
  renderRetailersListTemplate,
  type PurchaseInvoiceWithPayments
} from './pdf-templates.js';

// Import the shared report types
import type { TurnoverReportData, ProfitLossReportData, CommissionReportData } from '@shared/schema';

export class InvoiceGenerator {
  /**
   * Generate PDF for sales invoice
   */
  async generateSalesInvoicePDF(invoice: any, tenant: any): Promise<{ doc: InstanceType<typeof PDFDocument>; stream: PassThrough }> {
    try {
      // Validate required data
      if (!invoice) {
        throw new Error('Invoice data is required');
      }
      if (!tenant) {
        throw new Error('Tenant data is required');
      }
      if (!invoice.items || invoice.items.length === 0) {
        throw new Error('Invoice must have at least one item');
      }

      // Create new PDF document with bufferPages for page numbering
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        info: {
          Title: `Sales Invoice ${invoice.invoiceNumber}`,
          Author: tenant.name || 'FruitStand',
          Subject: 'Sales Invoice',
          Keywords: 'invoice, sales'
        }
      });

      // Create stream and pipe before rendering
      const stream = new PassThrough();
      doc.pipe(stream);

      // Render the template (no await, no end)
      renderSalesInvoiceTemplate(doc, invoice, tenant);

      // End the document after rendering
      doc.end();

      return { doc, stream };
    } catch (error) {
      throw new Error(`Failed to generate sales invoice PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate PDF for purchase invoice
   */
  async generatePurchaseInvoicePDF(invoice: any, tenant: any): Promise<{ doc: InstanceType<typeof PDFDocument>; stream: PassThrough }> {
    try {
      // Validate required data
      if (!invoice) {
        throw new Error('Invoice data is required');
      }
      if (!tenant) {
        throw new Error('Tenant data is required');
      }
      if (!invoice.items || invoice.items.length === 0) {
        throw new Error('Invoice must have at least one item');
      }

      // Create new PDF document with bufferPages for page numbering
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        info: {
          Title: `Purchase Invoice ${invoice.invoiceNumber}`,
          Author: tenant.name || 'FruitStand',
          Subject: 'Purchase Invoice',
          Keywords: 'invoice, purchase'
        }
      });

      // Create stream and pipe before rendering
      const stream = new PassThrough();
      doc.pipe(stream);

      // Render the template (no await, no end)
      renderPurchaseInvoiceTemplate(doc, invoice, tenant);

      // End the document after rendering
      doc.end();

      return { doc, stream };
    } catch (error) {
      throw new Error(`Failed to generate purchase invoice PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate PDF for turnover report
   */
  async generateTurnoverReportPDF(reportData: any, tenant: any): Promise<{ doc: InstanceType<typeof PDFDocument>; stream: PassThrough }> {
    try {
      if (!reportData) {
        throw new Error('Report data is required');
      }
      if (!tenant) {
        throw new Error('Tenant data is required');
      }

      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        info: {
          Title: 'Turnover Report',
          Author: tenant.name || 'FruitStand',
          Subject: 'Turnover Report',
          Keywords: 'report, turnover'
        }
      });

      const stream = new PassThrough();
      doc.pipe(stream);

      renderTurnoverReportTemplate(doc, reportData, tenant);
      doc.end();

      return { doc, stream };
    } catch (error) {
      throw new Error(`Failed to generate turnover report PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate PDF for profit & loss report
   */
  async generateProfitLossReportPDF(reportData: any, tenant: any): Promise<{ doc: InstanceType<typeof PDFDocument>; stream: PassThrough }> {
    try {
      if (!reportData) {
        throw new Error('Report data is required');
      }
      if (!tenant) {
        throw new Error('Tenant data is required');
      }

      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        info: {
          Title: 'Profit & Loss Report',
          Author: tenant.name || 'FruitStand',
          Subject: 'Profit & Loss Report',
          Keywords: 'report, profit, loss'
        }
      });

      const stream = new PassThrough();
      doc.pipe(stream);

      renderProfitLossReportTemplate(doc, reportData, tenant);
      doc.end();

      return { doc, stream };
    } catch (error) {
      throw new Error(`Failed to generate profit & loss report PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate PDF for commission report
   */
  async generateCommissionReportPDF(reportData: any, tenant: any): Promise<{ doc: InstanceType<typeof PDFDocument>; stream: PassThrough }> {
    try {
      if (!reportData) {
        throw new Error('Report data is required');
      }
      if (!tenant) {
        throw new Error('Tenant data is required');
      }

      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        info: {
          Title: 'Commission Report',
          Author: tenant.name || 'FruitStand',
          Subject: 'Commission Report',
          Keywords: 'report, commission'
        }
      });

      const stream = new PassThrough();
      doc.pipe(stream);

      renderCommissionReportTemplate(doc, reportData, tenant);
      doc.end();

      return { doc, stream };
    } catch (error) {
      throw new Error(`Failed to generate commission report PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateShortfallReportPDF(reportData: any, tenant: any): Promise<{ doc: InstanceType<typeof PDFDocument>; stream: PassThrough }> {
    try {
      if (!reportData || !tenant) {
        throw new Error('Report data and tenant information are required');
      }

      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        info: {
          Title: 'Shortfall Report',
          Author: tenant.name,
          Subject: 'Shortfall Report',
          Keywords: 'report, shortfall'
        }
      });

      const stream = new PassThrough();
      doc.pipe(stream);

      renderShortfallReportTemplate(doc, reportData, tenant);
      doc.end();

      return { doc, stream };
    } catch (error) {
      throw new Error(`Failed to generate shortfall report PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateExpensesSummaryPDF(reportData: any, tenant: any): Promise<{ doc: InstanceType<typeof PDFDocument>; stream: PassThrough }> {
    try {
      if (!reportData || !tenant) {
        throw new Error('Report data and tenant information are required');
      }

      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        info: {
          Title: 'Expenses Summary',
          Author: tenant.name,
          Subject: 'Expenses Summary',
          Keywords: 'report, expenses, summary'
        }
      });

      const stream = new PassThrough();
      doc.pipe(stream);

      renderExpensesSummaryTemplate(doc, reportData, tenant);
      doc.end();

      return { doc, stream };
    } catch (error) {
      throw new Error(`Failed to generate expenses summary PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateVendorsListPDF(reportData: any, tenant: any): Promise<{ doc: InstanceType<typeof PDFDocument>; stream: PassThrough }> {
    try {
      if (!reportData || !tenant) {
        throw new Error('Report data and tenant information are required');
      }

      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        info: {
          Title: 'Vendors List',
          Author: tenant.name,
          Subject: 'Vendors List - Amount Payable',
          Keywords: 'report, vendors, payable'
        }
      });

      const stream = new PassThrough();
      doc.pipe(stream);

      renderVendorsListTemplate(doc, reportData, tenant);
      doc.end();

      return { doc, stream };
    } catch (error) {
      throw new Error(`Failed to generate vendors list PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateRetailersListPDF(reportData: any, tenant: any): Promise<{ doc: InstanceType<typeof PDFDocument>; stream: PassThrough }> {
    try {
      if (!reportData || !tenant) {
        throw new Error('Report data and tenant information are required');
      }

      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        info: {
          Title: 'Retailers List',
          Author: tenant.name,
          Subject: 'Retailers List - Amount Receivable',
          Keywords: 'report, retailers, receivable'
        }
      });

      const stream = new PassThrough();
      doc.pipe(stream);

      renderRetailersListTemplate(doc, reportData, tenant);
      doc.end();

      return { doc, stream };
    } catch (error) {
      throw new Error(`Failed to generate retailers list PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Export singleton instance for convenience
export const invoiceGenerator = new InvoiceGenerator();