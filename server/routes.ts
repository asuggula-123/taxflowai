import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import { insertCustomerSchema, insertChatMessageSchema } from "@shared/schema";
import path from "path";
import { mkdir } from "fs/promises";
import { analyzeDocument, determineNextSteps, generateChatResponse } from "./ai-service";

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
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const uploadedDocs = [];
      const aiResponses = [];

      for (const file of files) {
        // Create document
        const document = await storage.createDocument({
          customerId: req.params.customerId,
          name: file.originalname,
          status: "completed",
          filePath: file.path,
        });
        uploadedDocs.push(document);

        // Analyze document with AI
        const analysis = await analyzeDocument(file.originalname, req.params.customerId);
        
        // Create AI response message
        const aiMessage = await storage.createChatMessage({
          customerId: req.params.customerId,
          sender: "ai",
          content: analysis.feedback,
        });
        aiResponses.push(aiMessage);

        // Mark requested document as completed if it matches
        const requestedDocs = await storage.getDocumentsByCustomer(req.params.customerId);
        const matchingRequested = requestedDocs.find(
          (d) => d.status === "requested" && d.name.toLowerCase().includes(file.originalname.toLowerCase().split('.')[0])
        );
        if (matchingRequested) {
          await storage.updateDocumentStatus(matchingRequested.id, "completed", file.path);
        }
      }

      // Determine next steps after all documents are analyzed
      const nextSteps = await determineNextSteps(req.params.customerId);
      
      // Update customer status
      await storage.updateCustomerStatus(req.params.customerId, nextSteps.customerStatus);

      // Add next steps message if there are missing documents
      if (nextSteps.missingDocuments.length > 0) {
        await storage.createChatMessage({
          customerId: req.params.customerId,
          sender: "ai",
          content: nextSteps.message,
        });

        // Create requested documents
        for (const docName of nextSteps.missingDocuments.slice(0, 3)) {
          const existingDoc = uploadedDocs.find((d) => d.name.includes(docName));
          if (!existingDoc) {
            await storage.createDocument({
              customerId: req.params.customerId,
              name: docName,
              status: "requested",
            });
          }
        }
      } else if (nextSteps.isComplete) {
        await storage.createChatMessage({
          customerId: req.params.customerId,
          sender: "ai",
          content: nextSteps.message,
        });
      }

      res.status(201).json({ documents: uploadedDocs, aiResponses });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to upload documents" });
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
      const validatedData = insertChatMessageSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
      });
      
      // Create accountant message
      const message = await storage.createChatMessage(validatedData);

      // Generate AI response
      const aiResponseContent = await generateChatResponse(validatedData.content, req.params.customerId);
      const aiMessage = await storage.createChatMessage({
        customerId: req.params.customerId,
        sender: "ai",
        content: aiResponseContent,
      });

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
