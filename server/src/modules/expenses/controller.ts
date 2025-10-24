import { Request, Response } from 'express';
import schema from '../../../shared/schema.js';
import { BaseController } from '../../utils/base';
import { ExpenseModel } from './model';
import {
  type AuthenticatedRequest,
  ForbiddenError,
  BadRequestError,
  NotFoundError,
  ValidationError
} from '../../types';

const { insertExpenseCategorySchema, insertExpenseSchema } = schema;

// Properly type AuthenticatedRequest
type ExpenseRequest<Params = {}, Body = {}, Query = {}> = AuthenticatedRequest<
  Params,
  any,
  Body,
  Query
> & {
  params: Params;
  body: Body;
  query: Query;
};

export class ExpenseController extends BaseController {
  private expenseModel: ExpenseModel;

  constructor() {
    super();
    this.expenseModel = new ExpenseModel();
  }

  // ===== CATEGORY =====

  async getAllCategories(req: ExpenseRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const categories = await this.expenseModel.getExpenseCategories(req.tenantId);
    res.json(categories);
  }

  async getCategoryById(req: ExpenseRequest<{ id: string }>, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const { id } = req.params;
    if (!id) throw new BadRequestError('Category ID is required');

    const category = await this.expenseModel.getExpenseCategory(req.tenantId, id);
    this.ensureResourceExists(category, 'Category');
    res.json(category);
  }

  async createCategory(
    req: ExpenseRequest<{}, { name: string; description?: string }>,
    res: Response
  ) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');

    const categoryData = this.validateZodSchema(insertExpenseCategorySchema, {
      ...req.body,
      tenantId: req.tenantId
    });

    const category = await this.wrapDatabaseOperation(() =>
      this.expenseModel.createExpenseCategory(req.tenantId, categoryData as any)
    );

    res.status(201).json(category);
  }

  async updateCategory(
    req: ExpenseRequest<{ id: string }, Partial<{ name: string; description: string }>>,
    res: Response
  ) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const { id } = req.params;
    if (!id) throw new BadRequestError('Category ID is required');

    const categoryData = this.validateZodSchema(insertExpenseCategorySchema.partial(), {
      ...req.body,
      tenantId: req.tenantId
    });

    const category = await this.wrapDatabaseOperation(() =>
      this.expenseModel.updateExpenseCategory(req.tenantId, id, categoryData)
    );
    this.ensureResourceExists(category, 'Category');
    res.json(category);
  }

  async deleteCategory(req: ExpenseRequest<{ id: string }>, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const { id } = req.params;
    if (!id) throw new BadRequestError('Category ID is required');

    const deleted = await this.wrapDatabaseOperation(() =>
      this.expenseModel.deleteExpenseCategory(req.tenantId, id)
    );

    if (!deleted) throw new NotFoundError('Category not found');
    res.status(204).send();
  }

  // ===== EXPENSE =====

  async getAllExpenses(
    req: ExpenseRequest<{}, {}, { categoryId?: string; paymentMode?: string }>,
    res: Response
  ) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');

    const opts = this.getPaginationOptions(req.query);
    const categoryId = req.query.categoryId;
    const paymentMode = req.query.paymentMode;

    const result = await this.expenseModel.getExpensesPaginated(
      req.tenantId,
      opts,
      categoryId,
      paymentMode
    );
    res.json(result);
  }

  async getExpenseById(req: ExpenseRequest<{ id: string }>, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const { id } = req.params;
    if (!id) throw new BadRequestError('Expense ID is required');

    const expense = await this.expenseModel.getExpense(req.tenantId, id);
    this.ensureResourceExists(expense, 'Expense');
    res.json(expense);
  }

  async createExpense(
    req: ExpenseRequest<
      {},
      {
        amount: string;
        paymentMode: string;
        paymentDate: string | Date;
        description: string;
        categoryId: string;
        chequeNumber?: string;
        upiReference?: string;
        notes?: string;
      }
    >,
    res: Response
  ) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');

    const validatedData = this.validateZodSchema(insertExpenseSchema, {
      ...req.body,
      tenantId: req.tenantId
    });

    // Ensure paymentDate is a Date
    const expenseData = {
      ...validatedData,
      paymentDate:
        typeof validatedData.paymentDate === 'string'
          ? new Date(validatedData.paymentDate)
          : validatedData.paymentDate
    };

    try {
      const expense = await this.wrapDatabaseOperation(() =>
        this.expenseModel.createExpense(req.tenantId, expenseData as any)
      );
      res.status(201).json(expense);
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid category') {
        throw new ValidationError('Invalid category', { categoryId: 'Invalid category' });
      }
      if (error instanceof Error && error.message === 'Invalid bank account') {
        throw new ValidationError('Invalid bank account', { bankAccountId: 'Invalid bank account' });
      }
      throw error;
    }
  }
}