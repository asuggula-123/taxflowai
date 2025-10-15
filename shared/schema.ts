import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const DOCUMENT_TYPES = {
  FORM_1040: "Form 1040",
  W2: "W-2",
  "1099_MISC": "1099-MISC",
  "1099_NEC": "1099-NEC",
  "1099_INT": "1099-INT",
  "1099_DIV": "1099-DIV",
  "1099_G": "1099-G",
  "1099_R": "1099-R",
  SCHEDULE_C: "Schedule C",
  SCHEDULE_E: "Schedule E",
  SCHEDULE_K1: "Schedule K-1",
  SCHEDULE_A: "Schedule A",
  FORM_1098: "Form 1098",
  FORM_8949: "Form 8949",
  FORM_2439: "Form 2439",
  OTHER: "Other",
} as const;

export const DOCUMENT_TYPE_VALUES = Object.values(DOCUMENT_TYPES);

export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull(),
  notes: text("notes"), // Customer-specific notes/memories (markdown)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const taxYearIntakes = pgTable("tax_year_intakes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  year: text("year").notNull(), // Tax year (e.g., "2024")
  notes: text("notes"),
  status: text("status").notNull().default("Awaiting Tax Return"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  intakeId: varchar("intake_id").notNull().references(() => taxYearIntakes.id),
  name: text("name").notNull(),
  documentType: text("document_type"),
  year: text("year"),
  entity: text("entity"),
  status: text("status").notNull().default("requested"),
  filePath: text("file_path"),
  provenance: text("provenance"), // JSON string: {page?: number, lineReference?: string, evidence: string}
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  intakeId: varchar("intake_id").notNull().references(() => taxYearIntakes.id),
  sender: text("sender").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customerDetails = pgTable("customer_details", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  intakeId: varchar("intake_id").notNull().references(() => taxYearIntakes.id),
  category: text("category").notNull(),
  label: text("label").notNull(),
  value: text("value"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const firmSettings = pgTable("firm_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  notes: text("notes"), // Firm-wide instructions/memories (markdown)
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCustomerSchema = createInsertSchema(customers).omit({
  id: true,
  createdAt: true,
});

export const insertTaxYearIntakeSchema = createInsertSchema(taxYearIntakes).omit({
  id: true,
  createdAt: true,
  status: true,
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

export const insertCustomerDetailSchema = createInsertSchema(customerDetails).omit({
  id: true,
  createdAt: true,
});

export const insertFirmSettingsSchema = createInsertSchema(firmSettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;
export type InsertTaxYearIntake = z.infer<typeof insertTaxYearIntakeSchema>;
export type TaxYearIntake = typeof taxYearIntakes.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertCustomerDetail = z.infer<typeof insertCustomerDetailSchema>;
export type CustomerDetail = typeof customerDetails.$inferSelect;
export type InsertFirmSettings = z.infer<typeof insertFirmSettingsSchema>;
export type FirmSettings = typeof firmSettings.$inferSelect;
