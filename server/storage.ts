import {
  type Customer,
  type InsertCustomer,
  type Document,
  type InsertDocument,
  type ChatMessage,
  type InsertChatMessage,
  type CustomerDetail,
  type InsertCustomerDetail,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Customer operations
  getCustomers(): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomerStatus(id: string, status: string): Promise<Customer | undefined>;
  deleteCustomer(id: string): Promise<boolean>;

  // Document operations
  getDocumentsByCustomer(customerId: string): Promise<Document[]>;
  createDocument(document: InsertDocument): Promise<Document>;
  updateDocumentStatus(id: string, status: string, filePath?: string, name?: string): Promise<Document | undefined>;

  // Chat message operations
  getChatMessagesByCustomer(customerId: string): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;

  // Customer detail operations
  getCustomerDetails(customerId: string): Promise<CustomerDetail[]>;
  upsertCustomerDetail(detail: InsertCustomerDetail): Promise<CustomerDetail>;
}

export class MemStorage implements IStorage {
  private customers: Map<string, Customer>;
  private documents: Map<string, Document>;
  private chatMessages: Map<string, ChatMessage>;
  private customerDetails: Map<string, CustomerDetail>;

  constructor() {
    this.customers = new Map();
    this.documents = new Map();
    this.chatMessages = new Map();
    this.customerDetails = new Map();
  }

  async getCustomers(): Promise<Customer[]> {
    return Array.from(this.customers.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getCustomer(id: string): Promise<Customer | undefined> {
    return this.customers.get(id);
  }

  async createCustomer(insertCustomer: InsertCustomer): Promise<Customer> {
    const id = randomUUID();
    const customer: Customer = {
      ...insertCustomer,
      id,
      status: "Awaiting Tax Return",
      createdAt: new Date(),
    };
    this.customers.set(id, customer);

    return customer;
  }

  async updateCustomerStatus(id: string, status: string): Promise<Customer | undefined> {
    const customer = this.customers.get(id);
    if (!customer) return undefined;
    
    const updated = { ...customer, status };
    this.customers.set(id, updated);
    return updated;
  }

  async deleteCustomer(id: string): Promise<boolean> {
    const customer = this.customers.get(id);
    if (!customer) return false;

    // Delete all related data
    this.customers.delete(id);
    
    // Delete all documents for this customer
    Array.from(this.documents.values())
      .filter((d) => d.customerId === id)
      .forEach((d) => this.documents.delete(d.id));
    
    // Delete all chat messages for this customer
    Array.from(this.chatMessages.values())
      .filter((m) => m.customerId === id)
      .forEach((m) => this.chatMessages.delete(m.id));
    
    // Delete all customer details
    Array.from(this.customerDetails.values())
      .filter((d) => d.customerId === id)
      .forEach((d) => this.customerDetails.delete(d.id));

    return true;
  }

  async getDocumentsByCustomer(customerId: string): Promise<Document[]> {
    return Array.from(this.documents.values())
      .filter((d) => d.customerId === customerId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async createDocument(insertDocument: InsertDocument): Promise<Document> {
    const id = randomUUID();
    const document: Document = {
      ...insertDocument,
      id,
      status: insertDocument.status || "requested",
      filePath: insertDocument.filePath || null,
      createdAt: new Date(),
    };
    this.documents.set(id, document);
    return document;
  }

  async updateDocumentStatus(
    id: string,
    status: string,
    filePath?: string,
    name?: string
  ): Promise<Document | undefined> {
    const document = this.documents.get(id);
    if (!document) return undefined;

    const updated = { 
      ...document, 
      status, 
      filePath: filePath || document.filePath,
      name: name || document.name
    };
    this.documents.set(id, updated);
    return updated;
  }

  async getChatMessagesByCustomer(customerId: string): Promise<ChatMessage[]> {
    return Array.from(this.chatMessages.values())
      .filter((m) => m.customerId === customerId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async createChatMessage(insertMessage: InsertChatMessage): Promise<ChatMessage> {
    const id = randomUUID();
    const message: ChatMessage = {
      ...insertMessage,
      id,
      createdAt: new Date(),
    };
    this.chatMessages.set(id, message);
    return message;
  }

  async getCustomerDetails(customerId: string): Promise<CustomerDetail[]> {
    return Array.from(this.customerDetails.values())
      .filter((d) => d.customerId === customerId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async upsertCustomerDetail(insertDetail: InsertCustomerDetail): Promise<CustomerDetail> {
    // Find existing detail with same customer, category, and label
    const existing = Array.from(this.customerDetails.values()).find(
      (d) =>
        d.customerId === insertDetail.customerId &&
        d.category === insertDetail.category &&
        d.label === insertDetail.label
    );

    if (existing) {
      const updated = { ...existing, value: insertDetail.value || null };
      this.customerDetails.set(existing.id, updated);
      return updated;
    }

    const id = randomUUID();
    const detail: CustomerDetail = {
      ...insertDetail,
      id,
      value: insertDetail.value || null,
      createdAt: new Date(),
    };
    this.customerDetails.set(id, detail);
    return detail;
  }
}

export const storage = new MemStorage();
