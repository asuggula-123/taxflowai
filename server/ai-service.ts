import OpenAI from "openai";
import { storage } from "./storage";
import type { Document, CustomerDetail } from "@shared/schema";
import fs from "fs";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Structured entities extracted from tax documents
interface TaxEntities {
  employers?: Array<{
    name: string;
    wages: number;
    year: number;
  }>;
  form1099Types?: string[]; // e.g., ["1099-NEC", "1099-INT"]
  form1099Payers?: Array<{
    name: string;
    type: string; // e.g., "1099-NEC"
    amount: number;
    year: number;
  }>;
  scheduleC?: {
    businessName: string;
    hasIncome: boolean;
    year: number;
  };
  personalInfo?: {
    taxpayerName?: string;
    filingStatus?: string;
    taxYear?: number;
  };
  itemizedDeductions?: string[]; // e.g., ["mortgage interest", "charitable donations"]
}

interface DocumentAnalysis {
  isValid: boolean;
  documentType?: string;
  missingInfo?: string[];
  entities?: TaxEntities;
  extractedDetails?: Array<{
    category: string;
    label: string;
    value: string;
  }>;
  feedback: string;
}

interface NextStepsAnalysis {
  missingDocuments: string[];
  isComplete: boolean;
  message: string;
  customerStatus: "Not Started" | "Incomplete" | "Ready";
}

export async function analyzeDocument(
  fileName: string,
  filePath: string,
  customerId: string
): Promise<DocumentAnalysis> {
  let uploadedFileId: string | null = null;
  
  try {
    // Validate file exists and size
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    
    if (fileSizeMB > 10) {
      throw new Error(`File size (${fileSizeMB.toFixed(2)}MB) exceeds 10MB limit`);
    }
    
    if (stats.size === 0) {
      throw new Error("File is empty");
    }

    // Upload PDF to OpenAI Files API
    const file = await openai.files.create({
      file: fs.createReadStream(filePath),
      purpose: "user_data",
    });
    
    uploadedFileId = file.id;

    // Analyze the uploaded PDF using Responses API
    const response = await openai.responses.create({
      model: "gpt-5",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              file_id: file.id,
            },
            {
              type: "input_text",
              text: `You are an expert tax preparation assistant. Analyze this tax document and extract STRUCTURED entities.

Based on the ACTUAL DOCUMENT CONTENT, extract structured data:

For Form 1040 (Tax Return):
- Extract EACH W-2 employer as separate object with name, wages, year
- Extract EACH 1099 payer with type (1099-NEC, 1099-INT, etc.), payer name, amount, year
- Extract Schedule C business info if present
- Extract personal info (taxpayer name, filing status, tax year)
- Extract itemized deductions if applicable

For W-2:
- Extract employer as single employer object

For 1099:
- Extract as single 1099 payer object

CRITICAL: Extract actual entities found in the document, not generic categories.

Respond in JSON format:
{
  "isValid": true,
  "documentType": "exact form name with year (e.g., 'Form 1040 (2023)', 'Form W-2 (2024)')",
  "missingInfo": ["list any missing information"],
  "entities": {
    "employers": [{"name": "Google LLC", "wages": 85000, "year": 2024}],
    "form1099Payers": [{"name": "Stripe Inc", "type": "1099-NEC", "amount": 15000, "year": 2024}],
    "scheduleC": {"businessName": "Acme Consulting", "hasIncome": true, "year": 2024},
    "personalInfo": {"taxpayerName": "John Doe", "filingStatus": "Married Filing Jointly", "taxYear": 2023},
    "itemizedDeductions": ["mortgage interest", "charitable donations"]
  },
  "extractedDetails": [{"category": "Personal Info|Income Sources|Deductions|Tax History", "label": "descriptive label", "value": "value"}],
  "feedback": "specific confirmation of what you found"
}

IMPORTANT: Only include entity fields that are actually found in the document. Leave arrays empty if no entities found.`
            }
          ]
        }
      ],
      text: { format: { type: "json_object" } }
    });

    const analysis: DocumentAnalysis = JSON.parse(
      response.output_text || "{}"
    );
    
    // Clean up uploaded file from OpenAI
    if (uploadedFileId) {
      try {
        await openai.files.delete(uploadedFileId);
      } catch (cleanupError) {
        console.error("Failed to delete uploaded file:", cleanupError);
      }
    }

    // Store extracted entities as a special detail record
    if (analysis.entities) {
      await storage.upsertCustomerDetail({
        customerId,
        category: "TaxEntities",
        label: "StructuredEntities",
        value: JSON.stringify(analysis.entities),
      });
    }

    // Store extracted details in the database (for display purposes)
    if (analysis.extractedDetails) {
      for (const detail of analysis.extractedDetails) {
        await storage.upsertCustomerDetail({
          customerId,
          category: detail.category,
          label: detail.label,
          value: detail.value,
        });
      }
    }

    return analysis;
  } catch (error: any) {
    console.error("Error analyzing document:", error);
    
    // Clean up uploaded file even on error
    if (uploadedFileId) {
      try {
        await openai.files.delete(uploadedFileId);
      } catch (cleanupError) {
        console.error("Failed to delete uploaded file:", cleanupError);
      }
    }
    
    // Determine the type of error
    let errorMessage = "";
    
    // Check for validation errors first (file size, empty file, etc.)
    if (error.message?.includes('exceeds 10MB limit')) {
      errorMessage = `File size exceeds 10MB limit. Please upload a smaller file.`;
    } else if (error.message?.includes('File is empty')) {
      errorMessage = `File is empty. Please upload a valid PDF document.`;
    } else if (error.message?.includes('ENOENT') || error.code === 'ENOENT') {
      errorMessage = `File not found. Please try uploading again.`;
    } else if (error.status === 429 || error.code === 'insufficient_quota') {
      errorMessage = "OpenAI API quota exceeded. Unable to analyze document at this time.";
    } else if (error.status === 401 || error.code === 'invalid_api_key') {
      errorMessage = "OpenAI API key is invalid. Unable to analyze document at this time.";
    } else if (error.message?.includes('API key')) {
      errorMessage = "OpenAI API configuration issue. Unable to analyze document at this time.";
    } else {
      errorMessage = "AI analysis temporarily unavailable. Unable to analyze document at this time.";
    }
    
    return {
      isValid: false,
      documentType: undefined,
      extractedDetails: [],
      feedback: errorMessage,
    };
  }
}

// Helper function to generate specific document requests from structured entities
function generateDocumentRequestsFromEntities(entities: TaxEntities): string[] {
  const requests: string[] = [];

  // Generate W-2 requests for each employer
  if (entities.employers && entities.employers.length > 0) {
    entities.employers.forEach(employer => {
      requests.push(`W-2 from ${employer.name} for ${employer.year}`);
    });
  }

  // Generate 1099 requests for each payer
  if (entities.form1099Payers && entities.form1099Payers.length > 0) {
    entities.form1099Payers.forEach(payer => {
      requests.push(`${payer.type} from ${payer.name} for ${payer.year}`);
    });
  }

  // Generate Schedule C request if business income exists
  if (entities.scheduleC && entities.scheduleC.hasIncome) {
    requests.push(`Schedule C business records for ${entities.scheduleC.businessName} (${entities.scheduleC.year})`);
  }

  // Generate itemized deduction requests
  if (entities.itemizedDeductions && entities.itemizedDeductions.length > 0) {
    entities.itemizedDeductions.forEach(deduction => {
      if (deduction.toLowerCase().includes('mortgage')) {
        requests.push(`Form 1098 (Mortgage Interest Statement) for ${entities.personalInfo?.taxYear || 'current year'}`);
      } else if (deduction.toLowerCase().includes('charitable')) {
        requests.push(`Charitable donation receipts for ${entities.personalInfo?.taxYear || 'current year'}`);
      } else {
        requests.push(`${deduction} documentation for ${entities.personalInfo?.taxYear || 'current year'}`);
      }
    });
  }

  return requests;
}

export async function determineNextSteps(
  customerId: string
): Promise<NextStepsAnalysis> {
  const documents = await storage.getDocumentsByCustomer(customerId);
  const details = await storage.getCustomerDetails(customerId);

  const completedDocs = documents.filter((d) => d.status === "completed");
  const requestedDocs = documents.filter((d) => d.status === "requested");

  // Retrieve structured entities
  const entitiesDetail = details.find(d => d.category === "TaxEntities" && d.label === "StructuredEntities");
  let entities: TaxEntities = {};
  
  if (entitiesDetail && entitiesDetail.value) {
    try {
      entities = JSON.parse(entitiesDetail.value);
    } catch (error) {
      console.error("Error parsing entities:", error);
    }
  }

  // Generate specific document requests from entities
  const requiredDocuments = generateDocumentRequestsFromEntities(entities);

  // Filter out already completed documents
  const completedDocNames = new Set(completedDocs.map(d => d.name.toLowerCase()));
  const missingDocuments = requiredDocuments.filter(req => {
    // Simple check: if any completed doc contains the main identifier
    return !Array.from(completedDocNames).some(completed => 
      completed.includes(req.toLowerCase().split(' ')[0])
    );
  });

  // Determine completion status
  const isComplete = missingDocuments.length === 0 && requiredDocuments.length > 0;
  
  let customerStatus: "Not Started" | "Incomplete" | "Ready" = "Incomplete";
  if (completedDocs.length === 0) {
    customerStatus = "Not Started";
  } else if (isComplete) {
    customerStatus = "Ready";
  }

  // Generate message
  let message = "";
  if (isComplete) {
    message = "All required documents have been collected. This customer is ready for tax preparation!";
  } else if (missingDocuments.length > 0) {
    message = `Please upload the following documents: ${missingDocuments.slice(0, 3).join(", ")}${missingDocuments.length > 3 ? `, and ${missingDocuments.length - 3} more` : ""}.`;
  } else if (completedDocs.length === 0) {
    message = "Please upload the customer's most recent tax return to get started.";
  } else {
    message = "Continue uploading required documents.";
  }

  return {
    missingDocuments,
    isComplete,
    message,
    customerStatus,
  };
}

export async function generateChatResponse(
  userMessage: string,
  customerId: string
): Promise<string> {
  const documents = await storage.getDocumentsByCustomer(customerId);
  const details = await storage.getCustomerDetails(customerId);
  const messages = await storage.getChatMessagesByCustomer(customerId);

  const context = `
Documents: ${documents.map((d) => `${d.name} (${d.status})`).join(", ")}
Customer Details: ${details.filter((d) => d.value).map((d) => `${d.label}: ${d.value}`).join(", ")}
Recent conversation: ${messages.slice(-5).map((m) => `${m.sender}: ${m.content}`).join("\n")}
`;

  const prompt = `You are a helpful tax preparation assistant. The accountant said: "${userMessage}"

Current context:
${context}

Provide a helpful, concise response. If they're providing information, acknowledge it and update your understanding. If they're asking a question, answer it based on tax preparation best practices.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: "You are a friendly, professional tax preparation assistant helping accountants collect tax documents and information.",
        },
        { role: "user", content: prompt },
      ],
    });

    return response.choices[0].message.content || "I'm here to help!";
  } catch (error) {
    console.error("Error generating chat response:", error);
    return "I understand. Please continue with the document upload process.";
  }
}
