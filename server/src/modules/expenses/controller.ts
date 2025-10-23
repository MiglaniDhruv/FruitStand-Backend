import { Request, Response } from 'express';
import schema from '../../../shared/schema.js';

const { insertExpenseCategorySchema, insertExpenseSchema } = schema;
import { BaseController } from '../../utils/base';
import { ExpenseModel } from './model';
import { type AuthenticatedRequest, ForbiddenError, BadRequestError, NotFoundError, ValidationError } from '../../types';

export class ExpenseController extends BaseController {
  private expenseModel: ExpenseModel;

  constructor() {
    super();
    this.expenseModel = new ExpenseModel();
  }

  async getAllCategories(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const categories = await this.expenseModel.getExpenseCategories(tenantId);
    res.json(categories);
  }

  async getCategoryById(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { id } = req.params;
    if (!id) {
      throw new BadRequestError('Category ID is required');
    }

    const category = await this.expenseModel.getExpenseCategory(tenantId, id);
    this.ensureResourceExists(category, 'Category');

    res.json(category);
  }

  async createCategory(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const categoryData = this.validateZodSchema(insertExpenseCategorySchema, { ...req.body, tenantId });
    
    const category = await this.wrapDatabaseOperation(() =>
      this.expenseModel.createExpenseCategory(tenantId, categoryData)
    );
    
    res.status(201).json(category);
  }

  async updateCategory(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { id } = req.params;
    if (!id) {
      throw new BadRequestError('Category ID is required');
    }

    const categoryData = this.validateZodSchema(insertExpenseCategorySchema.partial(), { ...req.body, tenantId });
    
    const category = await this.wrapDatabaseOperation(() =>
      this.expenseModel.updateExpenseCategory(tenantId, id, categoryData)
    );
    
    this.ensureResourceExists(category, 'Category');

    res.json(category);
  }

  async deleteCategory(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { id } = req.params;
    if (!id) {
      throw new BadRequestError('Category ID is required');
    }

    const deleted = await this.wrapDatabaseOperation(() =>
      this.expenseModel.deleteExpenseCategory(tenantId, id)
    );
    
    if (!deleted) {
      throw new NotFoundError('Category not found');
    }

    return res.status(204).send();
  }

  async getAllExpenses(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Get pagination options from query parameters
    const opts = this.getPaginationOptions(req.query);
    
    // Get filter parameters
    const categoryId = req.query.categoryId as string | undefined;
    const paymentMode = req.query.paymentMode as string | undefined;
    
    const result = await this.expenseModel.getExpensesPaginated(tenantId, opts, categoryId, paymentMode);
    res.json(result);
  }

  async getExpenseById(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const { id } = req.params;
    if (!id) {
      throw new BadRequestError('Expense ID is required');
    }

    const expense = await this.expenseModel.getExpense(tenantId, id);
    this.ensureResourceExists(expense, 'Expense');

    res.json(expense);
  }

  async createExpense(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedData = this.validateZodSchema(insertExpenseSchema, { ...req.body, tenantId });
    
    // Ensure paymentDate is a Date object
    const expenseData = {
      ...validatedData,
      paymentDate: typeof validatedData.paymentDate === 'string' 
        ? new Date(validatedData.paymentDate) 
        : validatedData.paymentDate
    };
    
    try {
      const expense = await this.wrapDatabaseOperation(() =>
        this.expenseModel.createExpense(tenantId, expenseData)
      );
      
      res.status(201).json(expense);
    } catch (error) {
      // Handle validation errors for invalid category/bank account
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