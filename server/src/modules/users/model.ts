import bcrypt from "bcrypt";
import { eq, asc } from "drizzle-orm";
import { db } from "../../../db";
import schema from '../../../shared/schema.js';
import { 
  applySorting,
  applySearchFilter,
  normalizePaginationOptions,
  getCountWithSearch,
  buildPaginationMetadata,
  withTenantPagination
} from "../../utils/pagination";
import { withTenant, ensureTenantInsert } from "../../utils/tenant-scope";

const { users } = schema;
type User = typeof schema.users.$inferSelect;
type InsertUser = typeof schema.insertUserSchema._input;
type PaginationOptions = typeof schema.PaginationOptions;
type PaginatedResult<T> = typeof schema.PaginatedResult<T>;

export class UserModel {
  async getUsers(tenantId: string): Promise<User[]> {
    return await db.select().from(users)
      .where(withTenant(users, tenantId))
      .orderBy(asc(users.createdAt));
  }

  async getUser(tenantId: string, id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users)
      .where(withTenant(users, tenantId, eq(users.id, id)));
    return user || undefined;
  }

  async getUserByUsername(tenantId: string, username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users)
      .where(withTenant(users, tenantId, eq(users.username, username)));
    return user || undefined;
  }

  async createUser(tenantId: string, insertUser: InsertUser): Promise<User> {
    const hashedPassword = await bcrypt.hash(insertUser.password, 10);
    const userWithTenant = ensureTenantInsert({ ...insertUser, password: hashedPassword }, tenantId);
    const [user] = await db
      .insert(users)
      .values(userWithTenant)
      .returning();
    return user;
  }

  async updateUser(tenantId: string, id: string, insertUser: Partial<InsertUser>): Promise<User | undefined> {
    const updateData = { ...insertUser };
    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }
    const [user] = await db
      .update(users)
      .set(updateData)
      .where(withTenant(users, tenantId, eq(users.id, id)))
      .returning();
    return user || undefined;
  }

  async updateUserPermissions(tenantId: string, id: string, permissions: string[]): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ permissions })
      .where(withTenant(users, tenantId, eq(users.id, id)))
      .returning();
    return user || undefined;
  }

  async deleteUser(tenantId: string, id: string): Promise<boolean> {
    const result = await db.delete(users)
      .where(withTenant(users, tenantId, eq(users.id, id)));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Special methods for authentication (no tenant filtering needed)
  async getUserByUsernameForAuth(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserForAuth(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUsersPaginated(tenantId: string, options: PaginationOptions): Promise<PaginatedResult<User>> {
    const { page, limit, offset, tenantCondition } = withTenantPagination(users, tenantId, options);
    
    // Define table columns for sorting and searching
    const tableColumns = {
      username: users.username,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt
    };
    
    const searchableColumns = [users.username, users.name];
    
    // Build base query with tenant filtering
    let query = db.select().from(users).where(tenantCondition);
    
    // Apply search filter using helper with tenant condition
    if (options.search) {
      query = applySearchFilter(query, options.search, searchableColumns, tenantCondition);
    }
    
    // Apply sorting using helper
    query = applySorting(query, options.sortBy || 'createdAt', options.sortOrder || 'asc', tableColumns);
    
    // Apply pagination and execute
    const data = await query.limit(limit).offset(offset);
    
    // Get total count with tenant filtering
    const total = await getCountWithSearch(
      users, 
      options.search ? searchableColumns : undefined, 
      options.search,
      tenantCondition
    );
    
    const pagination = buildPaginationMetadata(page, limit, total);
    
    return { data, pagination };
  }
}