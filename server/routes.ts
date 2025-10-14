import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import { insertCustomerSchema, insertChatMessageSchema } from "@shared/schema";
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
      
      // Create initial AI message prompting for tax return upload
      await storage.createChatMessage({
        customerId: customer.id,
        sender: "ai",
        content: "Hello! To begin preparing your 2024 tax return, please upload your complete 2023 tax return (Form 1040). I'll review it to understand your tax situation and determine which supporting documents we'll need to collect."
      });
      
      res.status(201).json(customer);
    } catch (error) {
      res.status(400).json({ error: "Invalid customer data" });
    }
  });

  app.patch("/api/customers/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      const customer = await storage.updateCustomerStatus(req.params.id, status);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      res.status(500).json({ error: "Failed to update customer status" });
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

  // Document routes
  app.get("/api/customers/:customerId/documents", async (req, res) => {
    try {
      const documents = await storage.getDocumentsByCustomer(req.params.customerId);
      res.json(documents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.post("/api/customers/:customerId/documents/upload", upload.array("files"), async (req, res) => {
    // Generate unique upload ID for progress tracking (declared outside try-catch for error handling)
    const uploadId = randomUUID();
    const customerId = req.params.customerId;
    
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      // Emit initial progress
      progressService.sendProgress({
        customerId,
        uploadId,
        step: "uploading",
        message: "Uploading documents...",
        progress: 10
      });

      // Check if customer is awaiting tax return validation
      const customer = await storage.getCustomer(customerId);
      if (!customer) {
        // Emit error progress
        progressService.sendProgress({
          customerId,
          uploadId,
          step: "error",
          message: "Customer not found",
          progress: 0
        });
        return res.status(404).json({ error: "Customer not found" });
      }

      // If customer is awaiting tax return, validate the first upload
      if (customer.status === "Awaiting Tax Return") {
        // Only validate the first file
        const firstFile = files[0];
        const validation = await validateTaxReturn(
          firstFile.originalname,
          firstFile.path,
          customer.name
        );

        if (!validation.isValid) {
          // Create error message based on what failed
          let errorMsg = "Tax return validation failed: ";
          if (!validation.isForm1040) {
            errorMsg += `This appears to be ${validation.extractedTaxYear ? 'a' : 'an'} ${validation.extractedTaxYear || ''} document, but we need a complete 2023 Form 1040 tax return. `;
          }
          if (!validation.isTaxYear2023) {
            errorMsg += `The tax year is ${validation.extractedTaxYear || 'unknown'}, but we need the 2023 tax return. `;
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
            customerId: req.params.customerId,
            sender: "ai",
            content: `⚠️ ${errorMsg}\n\nPlease upload your complete 2023 Form 1040 tax return to continue.`
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
      const allDocs = await storage.getDocumentsByCustomer(req.params.customerId);
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
        const analysis = await analyzeDocument(file.originalname, file.path, customerId, uploadId);
        
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
            customerId: req.params.customerId,
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
            customerId: req.params.customerId,
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
          customerId: req.params.customerId,
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
      const nextSteps = await determineNextSteps(req.params.customerId);
      
      // Update customer status
      await storage.updateCustomerStatus(req.params.customerId, nextSteps.customerStatus);

      // Always create next steps message
      await storage.createChatMessage({
        customerId: req.params.customerId,
        sender: "ai",
        content: nextSteps.message,
      });

      // Create requested documents for missing items
      if (nextSteps.missingDocuments.length > 0) {
        // Get all existing documents to check for duplicates
        const allExistingDocs = await storage.getDocumentsByCustomer(req.params.customerId);
        
        for (const docRequest of nextSteps.missingDocuments) {
          // Check if this requested document already exists
          const alreadyExists = allExistingDocs.some((d) => 
            d.name === docRequest.name && d.status === "requested"
          );
          
          if (!alreadyExists) {
            await storage.createDocument({
              customerId: req.params.customerId,
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
      const customerId = req.params.customerId;
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
  app.post("/api/customers/:customerId/documents", async (req, res) => {
    try {
      const { name, documentType, year, entity } = req.body;
      
      if (!name || !documentType || !year) {
        return res.status(400).json({ error: "Missing required fields: name, documentType, year" });
      }

      const document = await storage.createDocument({
        customerId: req.params.customerId,
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
  app.get("/api/customers/:customerId/messages", async (req, res) => {
    try {
      const messages = await storage.getChatMessagesByCustomer(req.params.customerId);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.post("/api/customers/:customerId/messages", async (req, res) => {
    try {
      // Check customer status before allowing chat
      const customer = await storage.getCustomer(req.params.customerId);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }

      // Enforce workflow gate: chat is only available after tax return validation
      if (customer.status === "Awaiting Tax Return") {
        return res.status(403).json({ 
          error: "Chat is disabled. Please upload and validate the customer's 2023 tax return first." 
        });
      }

      const validatedData = insertChatMessageSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
      });
      
      // Create accountant message
      const message = await storage.createChatMessage(validatedData);

      // Generate AI response (returns structured data with message and requested documents)
      const aiResponse = await generateChatResponse(validatedData.content, req.params.customerId);
      const aiMessage = await storage.createChatMessage({
        customerId: req.params.customerId,
        sender: "ai",
        content: aiResponse.message,
      });

      // Create requested document entities if any
      if (aiResponse.requestedDocuments.length > 0) {
        // Get all existing documents to check for duplicates
        const allExistingDocs = await storage.getDocumentsByCustomer(req.params.customerId);
        
        for (const docRequest of aiResponse.requestedDocuments) {
          // Check if a document with this name already exists (in any status)
          const alreadyExists = allExistingDocs.some((d) => d.name === docRequest.name);
          
          if (!alreadyExists) {
            await storage.createDocument({
              customerId: req.params.customerId,
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
  app.get("/api/customers/:customerId/details", async (req, res) => {
    try {
      const details = await storage.getCustomerDetails(req.params.customerId);
      res.json(details);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customer details" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
