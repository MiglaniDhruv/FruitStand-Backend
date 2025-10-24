import { Request, Response } from "express";
import { z } from "zod";
import { BaseController } from "../../utils/base";
import { ItemModel } from "./model";
import {
  ForbiddenError,
  BadRequestError,
  NotFoundError,
  ValidationError,
} from "../../types";
import schema from "../../../shared/schema.js";

const { insertItemSchema } = schema;

// ✅ Infer correct type directly from Zod
type InsertItemType = z.infer<typeof insertItemSchema>;

// Pagination validation
const itemValidation = {
  getItemsPaginated: z.object({
    page: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 1)),
    limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 10)),
    search: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    paginated: z.string().optional().transform((val) => val === "true"),
    isActive: z.enum(["true", "false"]).optional(),
  }),
};

export class ItemController extends BaseController {
  private itemModel: ItemModel;

  constructor() {
    super();
    this.itemModel = new ItemModel();
  }

  async getAll(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError("No tenant context found");
    const tenantId = req.tenantId;

    const validationResult = itemValidation.getItemsPaginated.safeParse(req.query);
    if (!validationResult.success) {
      throw new ValidationError("Invalid query parameters", validationResult.error);
    }

    const validatedQuery = validationResult.data;
    const { isActive } = validatedQuery;

    const isPaginated =
      req.query.paginated === "false"
        ? false
        : req.query.page || req.query.limit || req.query.paginated === "true";

    if (!isPaginated) {
      const items = await this.itemModel.getItems(tenantId, isActive);
      res.json(items);
      return;
    }

    const opts = this.getPaginationOptions(req.query);

    if (!req.query.sortBy) {
      opts.sortBy = "name";
    }

    const page = opts.page || 1;
    const limit = opts.limit || 10;

    if (page < 1) throw new BadRequestError("Page must be >= 1");
    if (limit < 1 || limit > 100)
      throw new BadRequestError("Limit must be between 1 and 100");

    const validSortFields = ["name", "quality", "unit", "createdAt"];
    if (opts.sortBy && !validSortFields.includes(opts.sortBy)) {
      throw new BadRequestError("Invalid sortBy field");
    }

    const result = await this.itemModel.getItemsPaginated(tenantId, { ...opts, isActive });
    res.json(result);
  }

  async getByVendor(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError("No tenant context found");
    const tenantId = req.tenantId;

    const validationResult = itemValidation.getItemsPaginated.safeParse(req.query);
    if (!validationResult.success) {
      throw new ValidationError("Invalid query parameters", validationResult.error);
    }
    const validatedQuery = validationResult.data;
    const { isActive } = validatedQuery;

    this.validateUUID(req.params.vendorId, "Vendor ID");
    const vendorId = req.params.vendorId;

    const items = await this.itemModel.getItemsByVendor(tenantId, vendorId, isActive);
    res.json(items);
  }

  async getById(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError("No tenant context found");
    const tenantId = req.tenantId;

    this.validateUUID(req.params.id, "Item ID");
    const itemId = req.params.id;

    const item = await this.itemModel.getItem(tenantId, itemId);
    this.ensureResourceExists(item, "Item");

    res.json(item);
  }

  async create(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError("No tenant context found");
    const tenantId = req.tenantId;

    // ✅ Zod validation + type-safe casting
    const parsed = insertItemSchema.safeParse({ ...req.body, tenantId });
    if (!parsed.success) throw new ValidationError("Invalid item data", parsed.error);

    const itemData: InsertItemType = parsed.data;

    const item = await this.wrapDatabaseOperation(() =>
      this.itemModel.createItem(tenantId, itemData)
    );

    res.status(201).json(item);
  }

  async update(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError("No tenant context found");
    const tenantId = req.tenantId;

    this.validateUUID(req.params.id, "Item ID");
    const itemId = req.params.id;

    // ✅ Zod partial validation + type-safe cast
    const parsed = insertItemSchema.partial().safeParse({ ...req.body, tenantId });
    if (!parsed.success) throw new ValidationError("Invalid item data", parsed.error);

    const itemData: Partial<InsertItemType> = parsed.data;

    const item = await this.wrapDatabaseOperation(() =>
      this.itemModel.updateItem(tenantId, itemId, itemData)
    );

    this.ensureResourceExists(item, "Item");

    res.json(item);
  }

  async delete(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError("No tenant context found");
    const tenantId = req.tenantId;

    this.validateUUID(req.params.id, "Item ID");
    const itemId = req.params.id;

    const result = await this.wrapDatabaseOperation(() =>
      this.itemModel.deleteItem(tenantId, itemId)
    );

    if (!result.success) {
      if (result.error) throw new BadRequestError(result.error);
      throw new NotFoundError("Item not found");
    }

    res.json({ message: "Item deleted successfully" });
  }
}
