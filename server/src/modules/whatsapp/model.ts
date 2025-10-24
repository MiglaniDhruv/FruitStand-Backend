import { eq, desc, and } from "drizzle-orm";
import { db } from "../../../db";
import schema from "../../../shared/schema.js";
import type {
  WhatsAppMessage as WhatsAppMessageType,
  PaginationOptions as PaginationOptionsType,
  PaginatedResult as PaginatedResultType,
} from "../../../shared/schema";
import {
  ensureTenantInsert,
  withTenant,
  withTenantPagination,
} from "../../utils/tenant-scope";
import {
  applySorting,
  applySearchFilter,
  getCountWithSearch,
  buildPaginationMetadata,
} from "../../utils/pagination";

const { whatsappMessages } = schema;

type WhatsAppMessage = WhatsAppMessageType;
type PaginationOptions = PaginationOptionsType;
type PaginatedResult<T> = PaginatedResultType<T>;

// ✅ Fix: define Insert type with all expected fields
type InsertWhatsAppMessage = {
  referenceType: string;
  referenceId: string;
  referenceNumber?: string;
  messageType: string;
  recipientType: "vendor" | "retailer" | "customer";
  recipientId: string | null;
  recipientPhone: string;
  templateId?: string | null;
  templateVariables?: Record<string, any>;
  errorMessage?: string | null;
  status?: string;
  createdAt?: Date;
};

export class WhatsAppMessageModel {
  /**
   * Create a new WhatsApp message record
   */
  static async createMessage(
    tenantId: string,
    messageData: InsertWhatsAppMessage
  ): Promise<WhatsAppMessage> {
    // Add missing fields safely
    const safeData = ensureTenantInsert(
      {
        tenantId,
        referenceType: messageData.referenceType ?? "generic",
        referenceId: messageData.referenceId ?? "unknown",
        referenceNumber: messageData.referenceNumber ?? "",
        messageType: messageData.messageType ?? "notification",
        recipientType: messageData.recipientType ?? "customer",
        recipientId: messageData.recipientId ?? null,
        recipientPhone: messageData.recipientPhone ?? "",
        templateId: messageData.templateId ?? null,
        templateVariables: messageData.templateVariables ?? {},
        errorMessage: messageData.errorMessage ?? null,
        status: messageData.status ?? "pending",
        createdAt: messageData.createdAt ?? new Date(),
      } as any, // cast to any to satisfy TS
      tenantId
    );

    const [message] = await db
      .insert(whatsappMessages)
      .values(safeData)
      .returning();

    return message as WhatsAppMessage;
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
      .set(updates as any)
      .where(
        withTenant(
          whatsappMessages,
          tenantId,
          eq(whatsappMessages.id, messageId)
        )
      )
      .returning();
    return updatedMessage as WhatsAppMessage | undefined;
  }

  /**
   * Get a single WhatsApp message by ID
   */
  static async getMessage(
    tenantId: string,
    messageId: string
  ): Promise<WhatsAppMessage | undefined> {
    const [message] = await db
      .select()
      .from(whatsappMessages)
      .where(
        withTenant(
          whatsappMessages,
          tenantId,
          eq(whatsappMessages.id, messageId)
        )
      )
      .limit(1);
    return message as WhatsAppMessage | undefined;
  }

  /**
   * Get all WhatsApp messages for a tenant
   */
  static async getMessages(tenantId: string): Promise<WhatsAppMessage[]> {
    const messages = await db
      .select()
      .from(whatsappMessages)
      .where(withTenant(whatsappMessages, tenantId))
      .orderBy(desc(whatsappMessages.createdAt));
    return messages as WhatsAppMessage[];
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
      recipientPhone: whatsappMessages.recipientPhone,
    };

    const searchableColumns = [
      whatsappMessages.recipientPhone,
      whatsappMessages.referenceNumber,
    ];

    let combinedCondition = tenantCondition;

    if (options.status) {
      combinedCondition = and(
        combinedCondition,
        eq(whatsappMessages.status, options.status)
      )!;
    }
    if (options.messageType) {
      combinedCondition = and(
        combinedCondition,
        eq(whatsappMessages.messageType, options.messageType)
      )!;
    }
    if (options.recipientType) {
      combinedCondition = and(
        combinedCondition,
        eq(whatsappMessages.recipientType, options.recipientType)
      )!;
    }

    let query = db.select().from(whatsappMessages).where(combinedCondition);

    if (options.search) {
      query = applySearchFilter(
        query,
        options.search,
        searchableColumns,
        combinedCondition
      );
    }

    query = applySorting(
      query,
      options.sortBy || "createdAt",
      options.sortOrder || "desc",
      tableColumns
    );

    const data = (await query.limit(limit).offset(offset)) as WhatsAppMessage[];

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
    const messages = await db
      .select()
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
    return messages as WhatsAppMessage[];
  }

  /**
   * Get a WhatsApp message by Twilio SID (for webhook processing)
   */
  static async getMessageByTwilioSid(
    twilioSid: string
  ): Promise<WhatsAppMessage | undefined> {
    const [message] = await db
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.twilioMessageSid, twilioSid))
      .limit(1);
    return message as WhatsAppMessage | undefined;
  }
}
