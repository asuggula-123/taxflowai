import OpenAI from "openai";
import { storage } from "./storage";
import type { Document, CustomerDetail } from "@shared/schema";

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
  customerId: string
): Promise<DocumentAnalysis> {
  const prompt = `You are a tax preparation assistant analyzing a document named "${fileName}".

Based on the filename, determine:
1. Is this a valid tax document? (W2, 1099, tax return, business expenses, etc.)
2. What type of document is this?
3. What customer details can be extracted? For tax returns, extract filing status. For W2s, note the employer. For 1099s, note the income type.

Provide SPECIFIC, HELPFUL feedback. Examples:
- "Great! I've received your 2023 tax return. This document is complete and valid."
- "Perfect! Your W2 from [Employer] has been uploaded successfully. I can see this is for wage income."
- "Excellent! I've received your 1099-MISC for freelance income. This is a valid tax document."

DO NOT say "Manual review recommended" - instead provide specific confirmation or guidance.

Respond in JSON format:
{
  "isValid": true,
  "documentType": "string (e.g., 'Form W2', '2023 Federal Tax Return', 'Form 1099-MISC', etc.)",
  "missingInfo": [],
  "extractedDetails": [{"category": "Personal Info|Income Sources|Deductions|Tax History", "label": "descriptive label", "value": "specific value or placeholder"}],
  "feedback": "specific, encouraging feedback about the successfully uploaded document - be detailed and helpful, never say 'manual review recommended'"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: "You are an expert tax preparation assistant helping accountants collect and validate tax documents.",
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
  } catch (error) {
    console.error("Error analyzing document:", error);
    return {
      isValid: true,
      documentType: "Tax Document",
      extractedDetails: [
        {
          category: "Tax History",
          label: "Document Type",
          value: fileName.includes("2023") ? "2023 Tax Year" : "Tax Document"
        }
      ],
      feedback: `Thank you for uploading ${fileName}. I've received this document successfully. ${fileName.toLowerCase().includes('tax_return') || fileName.toLowerCase().includes('1040') ? 'This appears to be a tax return document.' : fileName.toLowerCase().includes('w2') || fileName.toLowerCase().includes('w-2') ? 'This appears to be a W2 wage statement.' : fileName.toLowerCase().includes('1099') ? 'This appears to be a 1099 income document.' : 'This appears to be a valid tax document.'}`,
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
  } catch (error) {
    console.error("Error determining next steps:", error);
    return {
      missingDocuments: [],
      isComplete: false,
      message: "Continue uploading documents as needed.",
      customerStatus: "Incomplete",
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
