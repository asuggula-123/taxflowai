import OpenAI from "openai";
import { storage } from "./storage";
import type { Document, CustomerDetail } from "@shared/schema";
import fs from "fs";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface DocumentAnalysis {
  isValid: boolean;
  documentType?: string;
  missingInfo?: string[];
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
              text: `You are an expert tax preparation assistant. Analyze this tax document and extract all relevant information.

Based on the ACTUAL DOCUMENT CONTENT:
1. Identify the specific form type (Form 1040, W-2, 1099, Schedule C, etc.)
2. Extract all relevant customer details:
   - For Form 1040: Filing status, taxpayer names, SSN (last 4 digits only), address, tax year
   - For W-2: Employer name, employee name, wages, federal tax withheld
   - For 1099: Payer name, recipient name, income type, amount
   - For any form: Any other relevant tax information

Provide SPECIFIC, CONFIDENT feedback based on what you actually see in the document.

Respond in JSON format:
{
  "isValid": true,
  "documentType": "exact form name (e.g., 'Form 1040', 'Form W-2', 'Form 1099-MISC')",
  "missingInfo": ["list any missing or unclear information"],
  "extractedDetails": [{"category": "Personal Info|Income Sources|Deductions|Tax History", "label": "descriptive label", "value": "actual value from document"}],
  "feedback": "specific confirmation of what you found - reference actual details you extracted"
}`
            }
          ]
        }
      ],
      response_format: { type: "json_object" }
    });

    const analysis: DocumentAnalysis = JSON.parse(
      response.output_text || "{}"
    );
    
    // Clean up uploaded file from OpenAI
    if (uploadedFileId) {
      try {
        await openai.files.del(uploadedFileId);
      } catch (cleanupError) {
        console.error("Failed to delete uploaded file:", cleanupError);
      }
    }

    // Store extracted details in the database
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
        await openai.files.del(uploadedFileId);
      } catch (cleanupError) {
        console.error("Failed to delete uploaded file:", cleanupError);
      }
    }
    
    // Determine the type of error
    let errorMessage = "";
    if (error.status === 429 || error.code === 'insufficient_quota') {
      errorMessage = "⚠️ OpenAI API quota exceeded. Unable to analyze document at this time.";
    } else if (error.status === 401 || error.code === 'invalid_api_key') {
      errorMessage = "⚠️ OpenAI API key is invalid. Unable to analyze document at this time.";
    } else if (error.message?.includes('API key')) {
      errorMessage = "⚠️ OpenAI API configuration issue. Unable to analyze document at this time.";
    } else {
      errorMessage = "⚠️ AI analysis temporarily unavailable. Unable to analyze document at this time.";
    }
    
    return {
      isValid: false,
      documentType: undefined,
      extractedDetails: [],
      feedback: errorMessage,
    };
  }
}

export async function determineNextSteps(
  customerId: string
): Promise<NextStepsAnalysis> {
  const documents = await storage.getDocumentsByCustomer(customerId);
  const details = await storage.getCustomerDetails(customerId);

  const completedDocs = documents.filter((d) => d.status === "completed");
  const requestedDocs = documents.filter((d) => d.status === "requested");

  const prompt = `You are a tax preparation assistant. Analyze the current state and determine next steps.

Current documents completed: ${completedDocs.map((d) => d.name).join(", ") || "None"}
Documents still requested: ${requestedDocs.map((d) => d.name).join(", ") || "None"}
Customer details collected: ${details.filter((d) => d.value).length} fields filled

For a complete US tax return, we typically need:
- Last year's tax return (2023)
- W2 forms from all employers
- 1099 forms (if applicable)
- Business income/expense records (if self-employed)
- Deduction documentation (mortgage interest, charitable donations, etc.)
- Personal information (SSN, filing status, dependents)

Respond in JSON format:
{
  "missingDocuments": ["array of specific documents still needed"],
  "isComplete": boolean (true only if ALL necessary documents are collected),
  "message": "friendly message to the accountant about what's needed next or confirmation that everything is ready",
  "customerStatus": "Not Started" | "Incomplete" | "Ready"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: "You are an expert tax preparation assistant helping accountants track document collection progress.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const analysis: NextStepsAnalysis = JSON.parse(
      response.choices[0].message.content || "{}"
    );

    return analysis;
  } catch (error: any) {
    console.error("Error determining next steps:", error);
    
    // Determine error message based on error type
    let errorMessage = "";
    if (error.status === 429 || error.code === 'insufficient_quota') {
      console.log("⚠️ OpenAI API quota exceeded");
      errorMessage = "⚠️ OpenAI API quota exceeded. Unable to determine next steps at this time.";
    } else if (error.status === 401 || error.code === 'invalid_api_key') {
      console.log("⚠️ OpenAI API key invalid");
      errorMessage = "⚠️ OpenAI API key is invalid. Unable to determine next steps at this time.";
    } else {
      console.log("⚠️ OpenAI API error");
      errorMessage = "⚠️ AI temporarily unavailable. Unable to determine next steps at this time.";
    }
    
    // Return minimal response with just the error message
    let customerStatus: "Not Started" | "Incomplete" | "Ready" = "Incomplete";
    if (completedDocs.length === 0) {
      customerStatus = "Not Started";
    } else if (completedDocs.length > 0) {
      customerStatus = "Incomplete";
    }
    
    return {
      missingDocuments: [],
      isComplete: false,
      message: errorMessage,
      customerStatus,
    };
  }
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
