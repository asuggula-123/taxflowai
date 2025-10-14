import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import { insertCustomerSchema, insertTaxYearIntakeSchema, insertChatMessageSchema } from "@shared/schema";
import path from "path";
import { mkdir } from "fs/promises";
import { analyzeDocument, determineNextSteps, generateChatResponse, validateTaxReturn } from "./ai-service";
import { progressService } from "./progress-service";
import { randomUUID } from "crypto";

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const uploadDir = path.join(process.cwd(), "uploads");
      await mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + "-" + file.originalname);
    },
  }),
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Customer routes
  app.get("/api/customers", async (req, res) => {
    try {
      const customers = await storage.getCustomers();
      res.json(customers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customer" });
    }
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const validatedData = insertCustomerSchema.parse(req.body);
      const customer = await storage.createCustomer(validatedData);
      res.status(201).json(customer);
    } catch (error) {
      res.status(400).json({ error: "Invalid customer data" });
    }
  });

  app.delete("/api/customers/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteCustomer(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Customer not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete customer" });
    }
  });

  // Customer notes routes
  app.get("/api/customers/:id/notes", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      res.json({ notes: customer.notes || "" });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customer notes" });
    }
  });

  app.put("/api/customers/:id/notes", async (req, res) => {
    try {
      const { notes } = req.body;
      const customer = await storage.updateCustomerNotes(req.params.id, notes);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      res.json({ notes: customer.notes || "" });
    } catch (error) {
      res.status(500).json({ error: "Failed to update customer notes" });
    }
  });

  // Firm settings routes
  app.get("/api/firm/settings", async (req, res) => {
    try {
      const settings = await storage.getFirmSettings();
      res.json({ notes: settings?.notes || "" });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch firm settings" });
    }
  });

  app.put("/api/firm/settings", async (req, res) => {
    try {
      const { notes } = req.body;
      const settings = await storage.updateFirmSettings(notes);
      res.json({ notes: settings?.notes || "" });
    } catch (error) {
      res.status(500).json({ error: "Failed to update firm settings" });
    }
  });

  // Memory routes
  app.get("/api/memories", async (req, res) => {
    try {
      const type = req.query.type as 'firm' | 'customer' | undefined;
      const customerId = req.query.customerId as string | undefined;
      const memories = await storage.getMemories(type, customerId);
      res.json(memories);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch memories" });
    }
  });

  app.post("/api/memories", async (req, res) => {
    try {
      const memory = await storage.createMemory(req.body);
      res.status(201).json(memory);
    } catch (error) {
      res.status(400).json({ error: "Invalid memory data" });
    }
  });

  app.delete("/api/memories/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteMemory(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Memory not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete memory" });
    }
  });

  // Tax year intake routes
  app.get("/api/customers/:id/intakes", async (req, res) => {
    try {
      const intakes = await storage.getIntakesByCustomer(req.params.id);
      res.json(intakes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch intakes" });
    }
  });

  app.get("/api/intakes/:id", async (req, res) => {
    try {
      const intake = await storage.getIntake(req.params.id);
      if (!intake) {
        return res.status(404).json({ error: "Intake not found" });
      }
      res.json(intake);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch intake" });
    }
  });

  app.post("/api/customers/:id/intakes", async (req, res) => {
    try {
      const validatedData = insertTaxYearIntakeSchema.parse({
        customerId: req.params.id,
        ...req.body
      });
      const intake = await storage.createIntake(validatedData);
      
      // Create initial AI message prompting for tax return upload
      const previousYear = parseInt(intake.year) - 1;
      await storage.createChatMessage({
        intakeId: intake.id,
        sender: "ai",
        content: `Hello! To begin preparing your ${intake.year} tax return, please upload your complete ${previousYear} tax return (Form 1040). I'll review it to understand your tax situation and determine which supporting documents we'll need to collect.`
      });
      
      res.status(201).json(intake);
    } catch (error) {
      res.status(400).json({ error: "Invalid intake data" });
    }
  });

  app.patch("/api/intakes/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      const intake = await storage.updateIntakeStatus(req.params.id, status);
      if (!intake) {
        return res.status(404).json({ error: "Intake not found" });
      }
      res.json(intake);
    } catch (error) {
      res.status(500).json({ error: "Failed to update intake status" });
    }
  });

  app.delete("/api/intakes/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteIntake(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Intake not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete intake" });
    }
  });

  // Document routes
  app.get("/api/intakes/:intakeId/documents", async (req, res) => {
    try {
      const documents = await storage.getDocumentsByIntake(req.params.intakeId);
      res.json(documents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.post("/api/intakes/:intakeId/documents/upload", upload.array("files"), async (req, res) => {
    // Generate unique upload ID for progress tracking (declared outside try-catch for error handling)
    const uploadId = randomUUID();
    const intakeId = req.params.intakeId;
    
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      // Check if intake exists and get customer info for progress tracking
      const intake = await storage.getIntake(intakeId);
      if (!intake) {
        return res.status(404).json({ error: "Intake not found" });
      }

      const customerId = intake.customerId;
      const customer = await storage.getCustomer(customerId);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }

      // Emit initial progress
      progressService.sendProgress({
        customerId,
        uploadId,
        step: "uploading",
        message: "Uploading documents...",
        progress: 10
      });

      // If intake is awaiting tax return, validate the first upload
      if (intake.status === "Awaiting Tax Return") {
        // Only validate the first file
        const firstFile = files[0];
        const validation = await validateTaxReturn(
          firstFile.originalname,
          firstFile.path,
          customer.name,
          intake.year
        );

        if (!validation.isValid) {
          // Calculate expected prior year dynamically
          const expectedPriorYear = parseInt(intake.year) - 1;
          
          // Create error message based on what failed
          let errorMsg = "Tax return validation failed: ";
          if (!validation.isForm1040) {
            errorMsg += `This appears to be ${validation.extractedTaxYear ? 'a' : 'an'} ${validation.extractedTaxYear || ''} document, but we need a complete ${expectedPriorYear} Form 1040 tax return. `;
          }
          if (!validation.isTaxYear2023) {
            errorMsg += `The tax year is ${validation.extractedTaxYear || 'unknown'}, but we need the ${expectedPriorYear} tax return. `;
          }
          if (!validation.taxpayerNameMatches) {
            errorMsg += `The taxpayer name "${validation.extractedTaxpayerName || 'unknown'}" does not match the customer name "${customer.name}". `;
          }
          
          // Emit error progress
          progressService.sendProgress({
            customerId,
            uploadId,
            step: "error",
            message: errorMsg,
            progress: 0
          });
          
          // Create AI message with error
          await storage.createChatMessage({
            intakeId: req.params.intakeId,
            sender: "ai",
            content: `⚠️ ${errorMsg}\n\nPlease upload your complete ${expectedPriorYear} Form 1040 tax return to continue.`
          });

          return res.status(400).json({ error: errorMsg });
        }

        // Validation passed - continue with normal upload processing
      }

      const uploadedDocs = [];
      const aiResponses = [];

      // Helper function to normalize and tokenize document names
      const normalizeToTokens = (name: string): Set<string> => {
        // Generic filler words to exclude
        const fillerWords = new Set(['form', 'document', 'documents', 'file', 'copy', 'final', 'draft', 'the', 'a', 'an']);
        
        let normalized = name.toLowerCase();
        
        // Remove file extension
        normalized = normalized.replace(/\.(pdf|jpg|jpeg|png|doc|docx)$/i, '');
        
        // Preserve common tax form identifiers by removing hyphens within them
        // W-2 -> w2, 1099-MISC -> 1099misc, etc.
        normalized = normalized.replace(/\b(w)-?(2)\b/g, 'w2');
        normalized = normalized.replace(/\b(1099)-?([a-z]*)\b/g, '1099$2');
        normalized = normalized.replace(/\b(1040)-?([a-z]*)\b/g, '1040$2');
        normalized = normalized.replace(/\b(1098)-?([a-z]*)\b/g, '1098$2');
        
        // Now replace remaining punctuation with spaces
        normalized = normalized.replace(/[_\-.,;:()\[\]{}]/g, ' ');
        normalized = normalized.replace(/\s+/g, ' ').trim();
        
        // Split into tokens, filter out short words and filler words
        const tokens = normalized.split(' ')
          .filter(t => t.length > 1 && !fillerWords.has(t));
        
        return new Set(tokens);
      };

      // Calculate similarity score between two token sets
      const calculateSimilarity = (requested: Set<string>, upload: Set<string>): number => {
        if (requested.size === 0 || upload.size === 0) return 0;
        
        // Count how many requested tokens appear in upload
        let matches = 0;
        const requestedTokens = Array.from(requested);
        for (const token of requestedTokens) {
          if (upload.has(token)) matches++;
        }
        
        // Return ratio of matched requested tokens (0.0 to 1.0)
        return matches / requested.size;
      };

      // Fetch requested documents once before processing files
      const allDocs = await storage.getDocumentsByIntake(req.params.intakeId);
      let availableRequestedDocs = allDocs.filter((d) => d.status === "requested");
      const matchedDocIds = new Set<string>();

      for (const file of files) {
        // Emit analyzing progress
        progressService.sendProgress({
          customerId,
          uploadId,
          step: "analyzing",
          message: "Analyzing document with AI...",
          progress: 30
        });

        // Analyze document with AI first
        const analysis = await analyzeDocument(file.originalname, file.path, req.params.intakeId, uploadId);
        
        // If analysis failed, create error message and return error
        if (!analysis.isValid) {
          // Emit error progress
          progressService.sendProgress({
            customerId,
            uploadId,
            step: "error",
            message: analysis.feedback,
            progress: 0
          });
          
          await storage.createChatMessage({
            intakeId: req.params.intakeId,
            sender: "ai",
            content: `⚠️ Failed to analyze ${file.originalname}: ${analysis.feedback}`,
          });
          return res.status(400).json({ error: analysis.feedback });
        }
        
        const uploadTokens = normalizeToTokens(file.originalname);
        
        // Emit matching progress
        progressService.sendProgress({
          customerId,
          uploadId,
          step: "matching",
          message: "Matching documents to requests...",
          progress: 60
        });

        // Find best matching requested document from available (unmatched) requests
        let bestMatch: typeof availableRequestedDocs[0] | null = null;
        let bestScore = 0;
        
        for (const requested of availableRequestedDocs) {
          // Skip if already matched in this batch
          if (matchedDocIds.has(requested.id)) continue;
          
          const requestedTokens = normalizeToTokens(requested.name);
          
          // Skip if no tokens to compare
          if (requestedTokens.size === 0 || uploadTokens.size === 0) continue;
          
          const score = calculateSimilarity(requestedTokens, uploadTokens);
          
          // Boost score if there's a year match (indicates same tax period)
          const hasYearMatch = Array.from(requestedTokens).some(t => 
            /^\d{4}$/.test(t) && uploadTokens.has(t)
          );
          const boostedScore = hasYearMatch ? Math.min(score + 0.3, 1.0) : score;
          
          // Lower threshold: at least 30% of requested tokens must be present
          // or if there's a year match with any other token overlap
          if (boostedScore >= 0.3 && boostedScore > bestScore) {
            bestScore = boostedScore;
            bestMatch = requested;
          }
        }
        
        const matchingRequested = bestMatch;

        let document;
        if (matchingRequested) {
          // Update existing requested document with actual uploaded filename
          document = await storage.updateDocumentStatus(
            matchingRequested.id, 
            "completed", 
            file.path,
            file.originalname
          );
          // Mark as matched to prevent reuse in this batch
          matchedDocIds.add(matchingRequested.id);
        } else {
          // Create new document
          document = await storage.createDocument({
            intakeId: req.params.intakeId,
            name: file.originalname,
            status: "completed",
            filePath: file.path,
          });
        }
        
        if (document) {
          uploadedDocs.push(document);
        }
        
        // Create AI response message for successful analysis
        const aiMessage = await storage.createChatMessage({
          intakeId: req.params.intakeId,
          sender: "ai",
          content: analysis.feedback,
        });
        aiResponses.push(aiMessage);
      }

      // Emit generating progress
      progressService.sendProgress({
        customerId,
        uploadId,
        step: "generating",
        message: "Generating recommendations...",
        progress: 80
      });

      // Determine next steps after all documents are analyzed
      const nextSteps = await determineNextSteps(req.params.intakeId);
      
      // Update intake status
      await storage.updateIntakeStatus(req.params.intakeId, nextSteps.customerStatus);

      // Always create next steps message
      await storage.createChatMessage({
        intakeId: req.params.intakeId,
        sender: "ai",
        content: nextSteps.message,
      });

      // Create requested documents for missing items
      if (nextSteps.missingDocuments.length > 0) {
        // Get all existing documents to check for duplicates
        const allExistingDocs = await storage.getDocumentsByIntake(req.params.intakeId);
        
        for (const docRequest of nextSteps.missingDocuments) {
          // Check if this requested document already exists
          const alreadyExists = allExistingDocs.some((d) => 
            d.name === docRequest.name && d.status === "requested"
          );
          
          if (!alreadyExists) {
            await storage.createDocument({
              intakeId: req.params.intakeId,
              name: docRequest.name,
              documentType: docRequest.documentType,
              year: docRequest.year,
              entity: docRequest.entity || null,
              provenance: docRequest.provenance ? JSON.stringify(docRequest.provenance) : null,
              status: "requested",
            });
          }
        }
      }

      // Emit complete progress
      progressService.sendProgress({
        customerId,
        uploadId,
        step: "complete",
        message: "Analysis complete!",
        progress: 100
      });

      res.status(201).json({ documents: uploadedDocs, aiResponses });
    } catch (error) {
      console.error("Upload error:", error);
      
      // Always emit error progress to show accountants what went wrong
      const intake = await storage.getIntake(req.params.intakeId);
      const customerId = intake?.customerId || req.params.intakeId;
      const errorMessage = error instanceof Error ? error.message : "An error occurred during upload";
      
      progressService.sendProgress({
        customerId,
        uploadId,
        step: "error",
        message: errorMessage,
        progress: 0
      });
      
      res.status(500).json({ error: errorMessage });
    }
  });

  // Manual document request creation (for accountants to add documents)
  app.post("/api/intakes/:intakeId/documents", async (req, res) => {
    try {
      const { name, documentType, year, entity } = req.body;
      
      if (!name || !documentType || !year) {
        return res.status(400).json({ error: "Missing required fields: name, documentType, year" });
      }

      const document = await storage.createDocument({
        intakeId: req.params.intakeId,
        name,
        documentType,
        year,
        entity: entity || null,
        status: "requested",
      });

      res.status(201).json(document);
    } catch (error) {
      console.error("Create document error:", error);
      res.status(500).json({ error: "Failed to create document" });
    }
  });

  // Update document
  app.patch("/api/documents/:id", async (req, res) => {
    try {
      const { name, documentType, year, entity } = req.body;
      
      const document = await storage.updateDocument(req.params.id, {
        ...(name && { name }),
        ...(documentType && { documentType }),
        ...(year && { year }),
        ...(entity !== undefined && { entity: entity || null }),
      });

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      res.json(document);
    } catch (error) {
      console.error("Update document error:", error);
      res.status(500).json({ error: "Failed to update document" });
    }
  });

  // Delete document
  app.delete("/api/documents/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteDocument(req.params.id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Document not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Delete document error:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  // Chat message routes
  app.get("/api/intakes/:intakeId/messages", async (req, res) => {
    try {
      const messages = await storage.getChatMessagesByIntake(req.params.intakeId);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.post("/api/intakes/:intakeId/messages", async (req, res) => {
    try {
      // Check intake status before allowing chat
      const intake = await storage.getIntake(req.params.intakeId);
      if (!intake) {
        return res.status(404).json({ error: "Intake not found" });
      }

      // Enforce workflow gate: chat is only available after tax return validation
      if (intake.status === "Awaiting Tax Return") {
        const expectedPriorYear = parseInt(intake.year) - 1;
        return res.status(403).json({ 
          error: `Chat is disabled. Please upload and validate the customer's ${expectedPriorYear} tax return first.` 
        });
      }

      const validatedData = insertChatMessageSchema.parse({
        ...req.body,
        intakeId: req.params.intakeId,
      });
      
      // Create accountant message
      const message = await storage.createChatMessage(validatedData);

      // Generate AI response (returns structured data with message and requested documents)
      const aiResponse = await generateChatResponse(validatedData.content, req.params.intakeId);
      const aiMessage = await storage.createChatMessage({
        intakeId: req.params.intakeId,
        sender: "ai",
        content: aiResponse.message,
      });

      // Create requested document entities if any
      if (aiResponse.requestedDocuments.length > 0) {
        // Get all existing documents to check for duplicates
        const allExistingDocs = await storage.getDocumentsByIntake(req.params.intakeId);
        
        for (const docRequest of aiResponse.requestedDocuments) {
          // Check if a document with this name already exists (in any status)
          const alreadyExists = allExistingDocs.some((d) => d.name === docRequest.name);
          
          if (!alreadyExists) {
            await storage.createDocument({
              intakeId: req.params.intakeId,
              name: docRequest.name,
              documentType: docRequest.documentType,
              year: docRequest.year,
              entity: docRequest.entity || null,
              provenance: docRequest.provenance ? JSON.stringify(docRequest.provenance) : null,
              status: "requested",
            });
          }
        }
      }

      res.status(201).json({ message, aiMessage });
    } catch (error) {
      console.error("Message error:", error);
      res.status(400).json({ error: "Invalid message data" });
    }
  });

  // Customer details routes
  app.get("/api/intakes/:intakeId/details", async (req, res) => {
    try {
      const details = await storage.getCustomerDetailsByIntake(req.params.intakeId);
      res.json(details);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customer details" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
