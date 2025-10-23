import { eq, desc, and } from "drizzle-orm";
import { db } from "../../../db";
import schema from '../../../shared/schema.js';
import type { 
  WhatsAppMessage as WhatsAppMessageType, 
  InsertWhatsAppMessage as InsertWhatsAppMessageType, 
  PaginationOptions as PaginationOptionsType, 
  PaginatedResult as PaginatedResultType 
} from '../../../shared/schema';
import { 
  ensureTenantInsert, 
  withTenant, 
  withTenantPagination 
} from "../../utils/tenant-scope";
import { 
  applySorting,
  applySearchFilter,
  getCountWithSearch,
  buildPaginationMetadata
} from "../../utils/pagination";

const { whatsappMessages } = schema;

type WhatsAppMessage = WhatsAppMessageType;
type InsertWhatsAppMessage = InsertWhatsAppMessageType;
type PaginationOptions = PaginationOptionsType;
type PaginatedResult<T> = PaginatedResultType<T>;

export class WhatsAppMessageModel {
  /**
   * Create a new WhatsApp message record
   */
  static async createMessage(
    tenantId: string, 
    messageData: InsertWhatsAppMessage
  ): Promise<WhatsAppMessage> {
    const [message] = await db
      .insert(whatsappMessages)
      .values(ensureTenantInsert(messageData, tenantId))
      .returning<WhatsAppMessage>(); // Fixed TS typing
    
    return message;
  }

  /**
   * Update a WhatsApp message record
   */
  static async updateMessage(
    tenantId: string, 
    messageId: string, 
    updates: Partial<WhatsAppMessage>
  ): Promise<WhatsAppMessage | undefined> {
    const [updatedMessage] = await db
      .update(whatsappMessages)
      .set(updates)
      .where(withTenant(whatsappMessages, tenantId, eq(whatsappMessages.id, messageId)))
      .returning<WhatsAppMessage>(); // Fixed TS typing
    
    return updatedMessage;
  }

  /**
   * Get a single WhatsApp message by ID
   */
  static async getMessage(
    tenantId: string, 
    messageId: string
  ): Promise<WhatsAppMessage | undefined> {
    const [message] = await db
      .select<WhatsAppMessage>()
      .from(whatsappMessages)
      .where(withTenant(whatsappMessages, tenantId, eq(whatsappMessages.id, messageId)))
      .limit(1);
    
    return message;
  }

  /**
   * Get all WhatsApp messages for a tenant
   */
  static async getMessages(tenantId: string): Promise<WhatsAppMessage[]> {
    return await db
      .select<WhatsAppMessage>()
      .from(whatsappMessages)
      .where(withTenant(whatsappMessages, tenantId))
      .orderBy(desc(whatsappMessages.createdAt));
  }

  /**
   * Get paginated WhatsApp messages with optional filters
   */
  static async getMessagesPaginated(
    tenantId: string,
    options: PaginationOptions & {
      status?: string;
      messageType?: string;
      recipientType?: string;
      search?: string;
    }
  ): Promise<PaginatedResult<WhatsAppMessage>> {
    const { page, limit, offset, tenantCondition } = withTenantPagination(
      whatsappMessages, 
      tenantId, 
      options
    );
    
    const tableColumns = {
      createdAt: whatsappMessages.createdAt,
      status: whatsappMessages.status,
      messageType: whatsappMessages.messageType,
      recipientPhone: whatsappMessages.recipientPhone
    };
    
    const searchableColumns = [whatsappMessages.recipientPhone, whatsappMessages.referenceNumber];
    
    let combinedCondition = tenantCondition;
    
    if (options.status) {
      combinedCondition = and(combinedCondition, eq(whatsappMessages.status, options.status))!;
    }
    if (options.messageType) {
      combinedCondition = and(combinedCondition, eq(whatsappMessages.messageType, options.messageType))!;
    }
    if (options.recipientType) {
      combinedCondition = and(combinedCondition, eq(whatsappMessages.recipientType, options.recipientType))!;
    }
    
    let query = db.select<WhatsAppMessage>().from(whatsappMessages).where(combinedCondition);
    
    if (options.search) {
      query = applySearchFilter(query, options.search, searchableColumns, combinedCondition);
    }
    
    query = applySorting(query, options.sortBy || 'createdAt', options.sortOrder || 'desc', tableColumns);
    
    const data = await query.limit(limit).offset(offset);
    
    const total = await getCountWithSearch(
      whatsappMessages, 
      options.search ? searchableColumns : undefined, 
      options.search,
      combinedCondition
    );
    
    const pagination = buildPaginationMetadata(page, limit, total);
    
    return { data, pagination };
  }

  /**
   * Get messages by reference (invoice/payment)
   */
  static async getMessagesByReference(
    tenantId: string, 
    referenceType: string, 
    referenceId: string
  ): Promise<WhatsAppMessage[]> {
    return await db
      .select<WhatsAppMessage>()
      .from(whatsappMessages)
      .where(
        withTenant(
          whatsappMessages,
          tenantId,
          and(
            eq(whatsappMessages.referenceType, referenceType),
            eq(whatsappMessages.referenceId, referenceId)
          )
        )
      )
      .orderBy(desc(whatsappMessages.createdAt));
  }

  /**
   * Get a WhatsApp message by Twilio SID (for webhook processing)
   */
  static async getMessageByTwilioSid(twilioSid: string): Promise<WhatsAppMessage | undefined> {
    const [message] = await db
      .select<WhatsAppMessage>()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.twilioMessageSid, twilioSid))
      .limit(1);
    
    return message;
  }
}
