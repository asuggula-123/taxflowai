import OpenAI from "openai";
import { storage } from "./storage";
import type { Document, CustomerDetail } from "@shared/schema";
import fs from "fs";
import pdfParse from "pdf-parse";

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
  // Extract text from PDF
  let documentText = "";
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    documentText = pdfData.text;
  } catch (error) {
    console.error("Error parsing PDF:", error);
    documentText = "[Unable to extract text from PDF]";
  }

  const prompt = `You are a tax preparation assistant analyzing a tax document.

Document filename: "${fileName}"
Document content (text extracted from PDF):
"""
${documentText.slice(0, 4000)}
"""

Based on the ACTUAL DOCUMENT CONTENT, analyze:
1. Is this a valid tax document? What specific form is it (Form 1040, W-2, 1099, Schedule C, etc.)?
2. Extract all relevant customer details:
   - For Form 1040: Filing status, taxpayer names, SSN (last 4 digits only), address, tax year
   - For W-2: Employer name, employee name, wages, federal tax withheld
   - For 1099: Payer name, recipient name, income type, amount
   - For any form: Any other relevant tax information

Provide SPECIFIC, CONFIDENT feedback based on what you actually see in the document.

Respond in JSON format:
{
  "isValid": true,
  "documentType": "string (exact form name like 'Form 1040', 'Form W-2', 'Form 1099-MISC', etc.)",
  "missingInfo": ["list any missing or unclear information"],
  "extractedDetails": [{"category": "Personal Info|Income Sources|Deductions|Tax History", "label": "descriptive label", "value": "actual value from document"}],
  "feedback": "specific confirmation of what you found in the document - reference actual details you extracted"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: "You are an expert tax preparation assistant. You analyze actual tax documents and extract precise information from them.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const analysis: DocumentAnalysis = JSON.parse(
      response.choices[0].message.content || "{}"
    );

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
