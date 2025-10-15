import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import { insertCustomerSchema, insertTaxYearIntakeSchema, insertChatMessageSchema } from "@shared/schema";
import path from "path";
import { mkdir } from "fs/promises";
import { analyzeDocument, determineNextSteps, generateChatResponse, validateTaxReturn, quickExtractDocumentMetadata, generateDocumentName } from "./ai-service";
import { progressService } from "./progress-service";
import { randomUUID } from "crypto";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

      // If intake is awaiting tax return, validate the first upload BEFORE emitting progress
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
          
          // Create AI message with error
          await storage.createChatMessage({
            intakeId: req.params.intakeId,
            sender: "ai",
            content: `⚠️ ${errorMsg}\n\nPlease upload your complete ${expectedPriorYear} Form 1040 tax return to continue.`
          });

          // Return error immediately without WebSocket progress
          return res.status(400).json({ error: errorMsg });
        }

        // Validation passed - continue with normal upload processing
      }

      // Emit initial progress (after validation passes)
      progressService.sendProgress({
        customerId,
        uploadId,
        step: "uploading",
        message: "Uploading documents...",
        progress: 10
      });

      const uploadedDocs = [];
      const aiResponses = [];

      // Fetch requested documents once before processing files
      const allDocs = await storage.getDocumentsByIntake(req.params.intakeId);
      let availableRequestedDocs = allDocs.filter((d) => d.status === "requested");
      const matchedDocIds = new Set<string>();

      for (const file of files) {
        let openaiFileId: string | null = null;

        try {
          // Phase 1: Quick metadata extraction with gpt-4o-mini (uploads file once)
          progressService.sendProgress({
            customerId,
            uploadId,
            step: "analyzing",
            message: "Extracting document metadata...",
            progress: 20
          });

          const extraction = await quickExtractDocumentMetadata(file.path);
          const metadata = extraction.metadata;
          openaiFileId = extraction.fileId;
          const cleanName = generateDocumentName(metadata);
          
          // Emit matching progress
          progressService.sendProgress({
            customerId,
            uploadId,
            step: "matching",
            message: "Matching documents to requests...",
            progress: 40
          });

          // Find best matching requested document using AI-extracted metadata
          let bestMatch: typeof availableRequestedDocs[0] | null = null;
          let bestScore = 0;
          
          for (const requested of availableRequestedDocs) {
            // Skip if already matched in this batch
            if (matchedDocIds.has(requested.id)) continue;
            
            // Skip if requested doc doesn't have metadata
            if (!requested.documentType || !requested.year) continue;
            
            let score = 0;
            
            // Match on document type (most important)
            const normalizeDocType = (type: string) => 
              type.toLowerCase().replace(/[^a-z0-9]/g, '');
            
            if (normalizeDocType(metadata.documentType) === normalizeDocType(requested.documentType)) {
              score += 0.5; // 50% for matching document type
            }
            
            // Match on year (important)
            if (metadata.year === requested.year) {
              score += 0.3; // 30% for matching year
            }
            
            // Match on entity (if both have entity)
            if (metadata.entity && requested.entity) {
              const normalizeEntity = (entity: string) => 
                entity.toLowerCase().replace(/[^a-z0-9]/g, '');
              
              if (normalizeEntity(metadata.entity) === normalizeEntity(requested.entity)) {
                score += 0.2; // 20% for matching entity
              }
            } else if (!metadata.entity && !requested.entity) {
              // Both have no entity - slight bonus
              score += 0.1;
            }
            
            // Require at least document type and year match (80% score)
            if (score >= 0.8 && score > bestScore) {
              bestScore = score;
              bestMatch = requested;
            }
          }
          
          const matchingRequested = bestMatch;

          let document;
          if (matchingRequested) {
            // Update existing requested document with clean AI-generated name, metadata, and OpenAI file ID
            document = await storage.updateDocumentStatus(
              matchingRequested.id, 
              "completed", 
              file.path,
              cleanName,
              openaiFileId
            );
            // Mark as matched to prevent reuse in this batch
            matchedDocIds.add(matchingRequested.id);
          } else {
            // Create new document with clean AI-generated name, metadata, and OpenAI file ID
            document = await storage.createDocument({
              intakeId: req.params.intakeId,
              name: cleanName,
              documentType: metadata.documentType,
              year: metadata.year,
              entity: metadata.entity,
              status: "completed",
              filePath: file.path,
              openaiFileId: openaiFileId,
            });
          }
          
          if (document) {
            uploadedDocs.push(document);
          }
          
          // Phase 2: Deep analysis with gpt-5 (reuses uploaded file)
          progressService.sendProgress({
            customerId,
            uploadId,
            step: "analyzing",
            message: "Performing deep analysis...",
            progress: 60
          });

          const analysis = await analyzeDocument(
            file.originalname, 
            file.path, 
            req.params.intakeId, 
            uploadId,
            openaiFileId // Pass file_id to reuse
          );
          
          // If analysis failed, create error message but don't fail the upload (document is already created)
          if (!analysis.isValid) {
            await storage.createChatMessage({
              intakeId: req.params.intakeId,
              sender: "ai",
              content: `⚠️ ${cleanName}: ${analysis.feedback}`,
            });
          } else {
            // Create AI response message for successful analysis
            const aiMessage = await storage.createChatMessage({
              intakeId: req.params.intakeId,
              sender: "ai",
              content: analysis.feedback,
            });
            aiResponses.push(aiMessage);
          }
        } catch (error) {
          // Clean up OpenAI file if upload failed
          if (openaiFileId) {
            try {
              await openai.files.delete(openaiFileId);
            } catch (cleanupError) {
              console.error("Failed to delete OpenAI file on error:", cleanupError);
            }
          }
          throw error; // Re-throw to be handled by outer catch
        }
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

  // Bulk create documents from AI suggestions
  app.post("/api/intakes/:intakeId/documents/bulk-create", async (req, res) => {
    try {
      const { documents } = req.body;
      
      if (!Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({ error: "Expected array of documents" });
      }

      const createdDocuments = [];
      for (const doc of documents) {
        if (!doc.name || !doc.documentType || !doc.year) {
          console.warn("Skipping invalid document:", doc);
          continue;
        }

        const created = await storage.createDocument({
          intakeId: req.params.intakeId,
          name: doc.name,
          documentType: doc.documentType,
          year: doc.year,
          entity: doc.entity || null,
          status: "requested",
        });
        
        createdDocuments.push(created);
      }

      console.log(`Bulk created ${createdDocuments.length} documents from AI suggestions`);
      res.status(201).json({ documents: createdDocuments });
    } catch (error) {
      console.error("Bulk create documents error:", error);
      res.status(500).json({ error: "Failed to bulk create documents" });
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

      // Generate AI response first
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

      res.status(201).json({ 
        message, 
        aiMessage
      });
    } catch (error) {
      console.error("Message error:", error);
      res.status(400).json({ error: "Invalid message data" });
    }
  });

  // Streaming chat endpoint with SSE
  app.post("/api/intakes/:intakeId/messages/stream", async (req, res) => {
    try {
      // Check intake status before allowing chat
      const intake = await storage.getIntake(req.params.intakeId);
      if (!intake) {
        return res.status(404).json({ error: "Intake not found" });
      }

      // Enforce workflow gate
      if (intake.status === "Awaiting Tax Return") {
        const expectedPriorYear = parseInt(intake.year) - 1;
        return res.status(403).json({ 
          error: `Chat is disabled. Please upload and validate the customer's ${expectedPriorYear} tax return first.` 
        });
      }

      const { tempAccountantId, ...messageData } = req.body;
      const validatedData = insertChatMessageSchema.parse({
        ...messageData,
        intakeId: req.params.intakeId,
      });
      
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Create accountant message
      const message = await storage.createChatMessage(validatedData);

      // Emit accountant message with tempAccountantId for frontend correlation
      res.write(`event: accountant_message\n`);
      res.write(`data: ${JSON.stringify({ ...message, tempAccountantId })}\n\n`);

      // Start streaming chat response (memory detection will happen after)
      const customer = await storage.getCustomer(intake.customerId);
      const documents = await storage.getDocumentsByIntake(req.params.intakeId);
      const details = await storage.getCustomerDetailsByIntake(req.params.intakeId);
      const messages = await storage.getChatMessagesByIntake(req.params.intakeId);
      const firmSettings = await storage.getFirmSettings();
      const customerNotes = customer?.notes || "";

      const context = `
Customer: ${customer?.name}
Tax Year: ${intake.year}
Documents: ${documents.map((d) => `${d.name} (${d.status})`).join(", ")}
Customer Details: ${details.filter((d) => d.value).map((d) => `${d.label}: ${d.value}`).join(", ")}
Recent conversation: ${messages.slice(-5).map((m) => `${m.sender}: ${m.content}`).join("\n")}

Firm-level standing instructions:
${firmSettings?.notes || "None"}

Customer-specific notes:
${customerNotes || "None"}
`;

      const prompt = `You are a tax preparation AI assistant helping an ACCOUNTANT prepare their customer's tax returns.
  
IMPORTANT: You are talking TO THE ACCOUNTANT (not to the customer). The customer is ${customer?.name}.
Never address the accountant by the customer's name. The accountant is asking you about their customer.

We are preparing ${intake.year} tax returns for ${customer?.name}.

The accountant just said: "${validatedData.content}"

Current context:
${context}

Instructions:

1. Respond helpfully TO THE ACCOUNTANT (not to ${customer?.name}) in the "message" field

2. If they mention new income sources or tax obligations not in the document list, create specific document requests for ${intake.year} in the "requestedDocuments" array

3. Always refer to the taxpayer as "${customer?.name}" or "the customer" - never address them directly
`;

      // Define strict JSON schema for structured outputs
      const responseSchema = {
        type: "object" as const,
        properties: {
          message: {
            type: "string" as const,
            description: "Conversational response to the accountant"
          },
          requestedDocuments: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                name: { type: "string" as const },
                documentType: { type: "string" as const },
                year: { type: "string" as const },
                entity: { 
                  anyOf: [
                    { type: "string" as const },
                    { type: "null" as const }
                  ],
                  description: "Entity name if applicable"
                }
              },
              required: ["name", "documentType", "year", "entity"],
              additionalProperties: false
            }
          }
        },
        required: ["message", "requestedDocuments"],
        additionalProperties: false
      };

      const stream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a professional tax preparation AI assistant helping an accountant with their customer's taxes. You are speaking TO THE ACCOUNTANT, not to their customer. Always be clear about this distinction." },
          { role: "user", content: prompt },
        ],
        response_format: { 
          type: "json_schema",
          json_schema: {
            name: "chat_response",
            strict: true,
            schema: responseSchema
          }
        },
        stream: true,
      });

      let fullResponse = "";

      // Stream response chunks
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullResponse += content;
        }
      }

      // Parse the structured response
      const parsedResponse = JSON.parse(fullResponse);
      const fullMessage = parsedResponse.message;
      const requestedDocuments = parsedResponse.requestedDocuments || [];

      console.log("Streaming: AI generated message:", fullMessage.substring(0, 100) + "...");
      console.log("Streaming: Requested documents:", requestedDocuments);

      // Stream message content character by character for smooth UX
      for (const char of fullMessage) {
        res.write(`event: chunk\n`);
        res.write(`data: ${JSON.stringify({ content: char })}\n\n`);
      }

      // Save AI message
      const aiMessage = await storage.createChatMessage({
        intakeId: req.params.intakeId,
        sender: "ai",
        content: fullMessage,
      });

      // Create requested document entities if any
      if (requestedDocuments.length > 0) {
        const allExistingDocs = await storage.getDocumentsByIntake(req.params.intakeId);
        
        for (const docRequest of requestedDocuments) {
          const alreadyExists = allExistingDocs.some((d) => d.name === docRequest.name);
          
          if (!alreadyExists) {
            console.log("Streaming: Creating document:", docRequest.name);
            await storage.createDocument({
              intakeId: req.params.intakeId,
              name: docRequest.name,
              documentType: docRequest.documentType,
              year: docRequest.year,
              entity: docRequest.entity || null,
              status: "requested",
            });
          } else {
            console.log("Streaming: Skipping duplicate document:", docRequest.name);
          }
        }
      }

      // Emit complete event with AI message
      res.write(`event: complete\n`);
      res.write(`data: ${JSON.stringify({ aiMessage, requestedDocuments })}\n\n`);

      res.end();
    } catch (error) {
      console.error("Streaming message error:", error);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: "Failed to process message" })}\n\n`);
      res.end();
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
