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
              text: `You are an expert tax preparation assistant. Analyze this tax document and extract SPECIFIC, DETAILED information.

Based on the ACTUAL DOCUMENT CONTENT:

1. Identify the exact form type and tax year
2. Extract DETAILED information with SPECIFIC NAMES and AMOUNTS:
   
   For Form 1040 (Tax Return):
   - Personal info: Taxpayer names, filing status, address, SSN (last 4 digits only)
   - Income sources: Extract EACH employer/payer name with amounts from:
     * W-2 wages (line 1): List each employer separately
     * 1099 income types (lines 2-9): Specify which types (1099-NEC, 1099-MISC, 1099-INT, etc.)
     * Business income (Schedule C): Note business name/type
     * Other income sources shown
   - Deductions: Itemized vs standard, specific deductions claimed
   - Tax year and filing period
   
   For W-2:
   - Employer name (Box b)
   - Employee name
   - Wages and withholding amounts
   - Tax year
   
   For 1099 forms:
   - Payer name (Box 1)
   - Type of 1099 (NEC, MISC, INT, DIV, etc.)
   - Income amounts
   - Tax year

Be SPECIFIC with names, amounts, and types. For example:
- Good: "W-2 income from Google LLC ($85,000) and Meta Platforms Inc ($12,000)"
- Bad: "W-2 income from employers"

Respond in JSON format:
{
  "isValid": true,
  "documentType": "exact form name with year (e.g., 'Form 1040 (2023)', 'Form W-2 (2024)')",
  "missingInfo": ["list any missing information"],
  "extractedDetails": [{"category": "Personal Info|Income Sources|Deductions|Tax History", "label": "descriptive label with specific names", "value": "actual value from document with amounts/details"}],
  "feedback": "specific confirmation mentioning actual employer names, income types, and amounts you found"
}`
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

export async function determineNextSteps(
  customerId: string
): Promise<NextStepsAnalysis> {
  const documents = await storage.getDocumentsByCustomer(customerId);
  const details = await storage.getCustomerDetails(customerId);

  const completedDocs = documents.filter((d) => d.status === "completed");
  const requestedDocs = documents.filter((d) => d.status === "requested");

  // Organize details by category for better analysis
  const detailsByCategory = details.reduce((acc, detail) => {
    if (!acc[detail.category]) {
      acc[detail.category] = [];
    }
    acc[detail.category].push(`${detail.label}: ${detail.value}`);
    return acc;
  }, {} as Record<string, string[]>);

  const detailsSummary = Object.entries(detailsByCategory)
    .map(([category, items]) => `${category}:\n  - ${items.join("\n  - ")}`)
    .join("\n\n");

  const prompt = `You are a tax preparation assistant. Based on the ACTUAL TAX RETURN ANALYSIS, determine what SPECIFIC documents are still needed.

COMPLETED DOCUMENTS:
${completedDocs.map((d) => d.name).join("\n") || "None yet"}

ALREADY REQUESTED DOCUMENTS:
${requestedDocs.map((d) => d.name).join("\n") || "None"}

INFORMATION EXTRACTED FROM TAX RETURN:
${detailsSummary || "No tax return uploaded yet"}

INSTRUCTIONS:
1. Analyze what income sources, deductions, and other items are shown in the extracted tax return details
2. Request SPECIFIC documents for those exact items (not generic categories)
3. Examples of SPECIFIC requests:
   - If W-2 income from "ABC Corp" is shown → request "W-2 from ABC Corp for 2024"
   - If 1099-NEC income shown → request "1099-NEC forms for 2024"
   - If Schedule C business income shown → request "Schedule C business income/expense records for 2024"
   - If specific deductions shown → request those exact supporting documents

DO NOT request generic "as applicable" documents. Only request documents for items that are SPECIFICALLY shown in the tax return or that are standard follow-up documents for items found.

Respond in JSON format:
{
  "missingDocuments": ["array of SPECIFIC documents with exact names/sources when known"],
  "isComplete": boolean (true only if ALL necessary documents are collected),
  "message": "friendly message to the accountant about what's needed next",
  "customerStatus": "Not Started" | "Incomplete" | "Ready"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: "You are an expert tax preparation assistant. Your job is to request SPECIFIC documents based on what you find in the tax return, not generic categories. Be precise and actionable.",
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
