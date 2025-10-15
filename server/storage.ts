import {
  type Customer,
  type InsertCustomer,
  type TaxYearIntake,
  type InsertTaxYearIntake,
  type Document,
  type InsertDocument,
  type ChatMessage,
  type InsertChatMessage,
  type CustomerDetail,
  type InsertCustomerDetail,
  type FirmSettings,
  type InsertFirmSettings,
  type Memory,
  type InsertMemory,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Customer operations
  getCustomers(): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  deleteCustomer(id: string): Promise<boolean>;

  // Tax year intake operations
  getIntakesByCustomer(customerId: string): Promise<TaxYearIntake[]>;
  getIntake(id: string): Promise<TaxYearIntake | undefined>;
  createIntake(intake: InsertTaxYearIntake): Promise<TaxYearIntake>;
  updateIntakeStatus(id: string, status: string): Promise<TaxYearIntake | undefined>;
  deleteIntake(id: string): Promise<boolean>;

  // Document operations
  getDocumentsByIntake(intakeId: string): Promise<Document[]>;
  createDocument(document: InsertDocument): Promise<Document>;
  updateDocument(id: string, updates: Partial<Omit<Document, 'id' | 'intakeId' | 'createdAt'>>): Promise<Document | undefined>;
  updateDocumentStatus(id: string, status: string, filePath?: string, name?: string): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<boolean>;

  // Chat message operations
  getChatMessagesByIntake(intakeId: string): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;

  // Customer detail operations
  getCustomerDetailsByIntake(intakeId: string): Promise<CustomerDetail[]>;
  upsertCustomerDetail(detail: InsertCustomerDetail): Promise<CustomerDetail>;

  // Firm settings operations
  getFirmSettings(): Promise<FirmSettings | undefined>;
  updateFirmSettings(notes: string): Promise<FirmSettings>;

  // Customer notes operations
  updateCustomerNotes(customerId: string, notes: string): Promise<Customer | undefined>;

  // Memory operations
  getMemories(type?: 'firm' | 'customer', customerId?: string): Promise<Memory[]>;
  createMemory(memory: InsertMemory): Promise<Memory>;
  deleteMemory(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private customers: Map<string, Customer>;
  private taxYearIntakes: Map<string, TaxYearIntake>;
  private documents: Map<string, Document>;
  private chatMessages: Map<string, ChatMessage>;
  private customerDetails: Map<string, CustomerDetail>;
  private firmSettings: FirmSettings | undefined;
  private memories: Map<string, Memory>;

  constructor() {
    this.customers = new Map();
    this.taxYearIntakes = new Map();
    this.documents = new Map();
    this.chatMessages = new Map();
    this.customerDetails = new Map();
    this.firmSettings = undefined;
    this.memories = new Map();
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
      notes: insertCustomer.notes || null,
      createdAt: new Date(),
    };
    this.customers.set(id, customer);

    return customer;
  }

  async deleteCustomer(id: string): Promise<boolean> {
    const customer = this.customers.get(id);
    if (!customer) return false;

    // Get all intakes for this customer
    const intakes = Array.from(this.taxYearIntakes.values())
      .filter((i) => i.customerId === id);
    
    // Delete all intakes and their related data
    for (const intake of intakes) {
      await this.deleteIntake(intake.id);
    }
    
    // Delete the customer
    this.customers.delete(id);

    return true;
  }

  async getIntakesByCustomer(customerId: string): Promise<TaxYearIntake[]> {
    return Array.from(this.taxYearIntakes.values())
      .filter((i) => i.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getIntake(id: string): Promise<TaxYearIntake | undefined> {
    return this.taxYearIntakes.get(id);
  }

  async createIntake(insertIntake: InsertTaxYearIntake): Promise<TaxYearIntake> {
    const id = randomUUID();
    const intake: TaxYearIntake = {
      ...insertIntake,
      id,
      status: "Awaiting Tax Return",
      notes: insertIntake.notes || null,
      createdAt: new Date(),
    };
    this.taxYearIntakes.set(id, intake);
    return intake;
  }

  async updateIntakeStatus(id: string, status: string): Promise<TaxYearIntake | undefined> {
    const intake = this.taxYearIntakes.get(id);
    if (!intake) return undefined;
    
    const updated = { ...intake, status };
    this.taxYearIntakes.set(id, updated);
    return updated;
  }

  async deleteIntake(id: string): Promise<boolean> {
    const intake = this.taxYearIntakes.get(id);
    if (!intake) return false;

    // Delete all related data
    this.taxYearIntakes.delete(id);
    
    // Delete all documents for this intake
    Array.from(this.documents.values())
      .filter((d) => d.intakeId === id)
      .forEach((d) => this.documents.delete(d.id));
    
    // Delete all chat messages for this intake
    Array.from(this.chatMessages.values())
      .filter((m) => m.intakeId === id)
      .forEach((m) => this.chatMessages.delete(m.id));
    
    // Delete all customer details for this intake
    Array.from(this.customerDetails.values())
      .filter((d) => d.intakeId === id)
      .forEach((d) => this.customerDetails.delete(d.id));

    return true;
  }

  async getDocumentsByIntake(intakeId: string): Promise<Document[]> {
    return Array.from(this.documents.values())
      .filter((d) => d.intakeId === intakeId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async createDocument(insertDocument: InsertDocument): Promise<Document> {
    const id = randomUUID();
    const document: Document = {
      ...insertDocument,
      id,
      status: insertDocument.status || "requested",
      filePath: insertDocument.filePath || null,
      documentType: insertDocument.documentType || null,
      year: insertDocument.year || null,
      entity: insertDocument.entity || null,
      provenance: insertDocument.provenance || null,
      createdAt: new Date(),
    };
    this.documents.set(id, document);
    return document;
  }

  async updateDocument(
    id: string,
    updates: Partial<Omit<Document, 'id' | 'intakeId' | 'createdAt'>>
  ): Promise<Document | undefined> {
    const document = this.documents.get(id);
    if (!document) return undefined;

    const updated = { ...document, ...updates };
    this.documents.set(id, updated);
    return updated;
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

  async deleteDocument(id: string): Promise<boolean> {
    const document = this.documents.get(id);
    if (!document) return false;
    
    this.documents.delete(id);
    return true;
  }

  async getChatMessagesByIntake(intakeId: string): Promise<ChatMessage[]> {
    return Array.from(this.chatMessages.values())
      .filter((m) => m.intakeId === intakeId)
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

  async getCustomerDetailsByIntake(intakeId: string): Promise<CustomerDetail[]> {
    return Array.from(this.customerDetails.values())
      .filter((d) => d.intakeId === intakeId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async upsertCustomerDetail(insertDetail: InsertCustomerDetail): Promise<CustomerDetail> {
    // Find existing detail with same intake, category, and label
    const existing = Array.from(this.customerDetails.values()).find(
      (d) =>
        d.intakeId === insertDetail.intakeId &&
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

  async getFirmSettings(): Promise<FirmSettings | undefined> {
    return this.firmSettings;
  }

  async updateFirmSettings(notes: string): Promise<FirmSettings> {
    if (!this.firmSettings) {
      const id = randomUUID();
      this.firmSettings = {
        id,
        notes,
        updatedAt: new Date(),
      };
    } else {
      this.firmSettings = {
        ...this.firmSettings,
        notes,
        updatedAt: new Date(),
      };
    }
    return this.firmSettings;
  }

  async updateCustomerNotes(customerId: string, notes: string): Promise<Customer | undefined> {
    const customer = this.customers.get(customerId);
    if (!customer) return undefined;

    const updated = { ...customer, notes };
    this.customers.set(customerId, updated);
    return updated;
  }

  async getMemories(type?: 'firm' | 'customer', customerId?: string): Promise<Memory[]> {
    let memories = Array.from(this.memories.values());
    
    if (type) {
      memories = memories.filter(m => m.type === type);
    }
    
    // For firm memories, we need to filter where customerId is null
    // For customer memories, we need to filter where customerId matches
    if (type === 'firm') {
      memories = memories.filter(m => m.customerId === null);
    } else if (type === 'customer' && customerId) {
      memories = memories.filter(m => m.customerId === customerId);
    } else if (customerId) {
      // If no type specified but customerId provided, filter by customerId
      memories = memories.filter(m => m.customerId === customerId);
    }
    
    return memories.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async createMemory(insertMemory: InsertMemory): Promise<Memory> {
    const id = randomUUID();
    const memory: Memory = {
      ...insertMemory,
      id,
      customerId: insertMemory.customerId || null,
      intakeId: insertMemory.intakeId || null,
      createdAt: new Date(),
    };
    this.memories.set(id, memory);
    return memory;
  }

  async deleteMemory(id: string): Promise<boolean> {
    const memory = this.memories.get(id);
    if (!memory) return false;
    
    this.memories.delete(id);
    return true;
  }
}

export const storage = new MemStorage();
