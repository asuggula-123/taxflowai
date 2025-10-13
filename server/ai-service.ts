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
  form1099Payers?: Array<{
    name: string;
    type: string; // e.g., "1099-NEC", "1099-INT", "1099-DIV", "1099-R", "SSA-1099"
    amount: number;
    year: number;
  }>;
  scheduleC?: {
    businessName: string;
    hasIncome: boolean;
    year: number;
  };
  scheduleE?: {
    propertyAddress?: string;
    hasRentalIncome: boolean;
    year: number;
  };
  formK1?: Array<{
    entityName: string;
    entityType: string; // "Partnership", "S-Corp", "Estate", "Trust"
    year: number;
  }>;
  form1098?: {
    lenderName?: string;
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
- Extract EACH 1099 payer with specific type (1099-NEC, 1099-INT, 1099-DIV, 1099-R, SSA-1099, etc.), payer name, amount, year
- Extract Schedule C business info if present (business name, year)
- Extract Schedule E rental property info if present (property address, year)
- Extract K-1 info if present (entity name, type: Partnership/S-Corp/Estate/Trust, year)
- Extract Form 1098 mortgage interest if present (lender name, year)
- Extract personal info (taxpayer name, filing status, tax year)
- Extract itemized deductions if applicable

For W-2:
- Extract employer as single employer object

For 1099 (all types):
- Extract as single form1099Payers object with specific type (1099-NEC, 1099-INT, etc.)

For Schedule C:
- Extract as scheduleC object

For Schedule E:
- Extract as scheduleE object

For K-1:
- Extract as formK1 array item

For 1098:
- Extract as form1098 object

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
    "scheduleE": {"propertyAddress": "123 Main St", "hasRentalIncome": true, "year": 2024},
    "formK1": [{"entityName": "ABC Partnership", "entityType": "Partnership", "year": 2024}],
    "form1098": {"lenderName": "Chase Bank", "year": 2024},
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

    // Merge new entities with existing ones (accumulate across uploads)
    if (analysis.entities) {
      const existingEntitiesDetail = (await storage.getCustomerDetails(customerId))
        .find(d => d.category === "TaxEntities" && d.label === "StructuredEntities");
      
      // Start with existing entities to preserve all data, then overlay new data
      let mergedEntities: TaxEntities = {};
      
      if (existingEntitiesDetail && existingEntitiesDetail.value) {
        try {
          const existingEntities: TaxEntities = JSON.parse(existingEntitiesDetail.value);
          
          // Deep clone existing entities as the starting point
          mergedEntities = {
            employers: existingEntities.employers ? [...existingEntities.employers] : undefined,
            form1099Payers: existingEntities.form1099Payers ? [...existingEntities.form1099Payers] : undefined,
            formK1: existingEntities.formK1 ? [...existingEntities.formK1] : undefined,
            itemizedDeductions: existingEntities.itemizedDeductions ? [...existingEntities.itemizedDeductions] : undefined,
            scheduleC: existingEntities.scheduleC,
            scheduleE: existingEntities.scheduleE,
            form1098: existingEntities.form1098,
            personalInfo: existingEntities.personalInfo,
          };
          
          // Now overlay new entities from the AI analysis
          // Merge employers (avoid duplicates by name+year)
          if (analysis.entities.employers && analysis.entities.employers.length > 0) {
            type Employer = { name: string; wages: number; year: number };
            const employersMap = new Map<string, Employer>();
            
            // Start with existing
            (mergedEntities.employers || []).forEach(emp => {
              employersMap.set(`${emp.name}-${emp.year}`, emp);
            });
            
            // Add new
            analysis.entities.employers.forEach(emp => {
              employersMap.set(`${emp.name}-${emp.year}`, emp);
            });
            
            mergedEntities.employers = Array.from(employersMap.values());
          }
          
          // Merge 1099 payers (avoid duplicates by name+type+year)
          if (analysis.entities.form1099Payers && analysis.entities.form1099Payers.length > 0) {
            type Payer = { name: string; type: string; amount: number; year: number };
            const payersMap = new Map<string, Payer>();
            
            // Start with existing
            (mergedEntities.form1099Payers || []).forEach(payer => {
              payersMap.set(`${payer.name}-${payer.type}-${payer.year}`, payer);
            });
            
            // Add new
            analysis.entities.form1099Payers.forEach(payer => {
              payersMap.set(`${payer.name}-${payer.type}-${payer.year}`, payer);
            });
            
            mergedEntities.form1099Payers = Array.from(payersMap.values());
          }
          
          // Merge K-1 forms (avoid duplicates by entity name+type+year)
          if (analysis.entities.formK1 && analysis.entities.formK1.length > 0) {
            type K1 = { entityName: string; entityType: string; year: number };
            const k1Map = new Map<string, K1>();
            
            // Start with existing
            (mergedEntities.formK1 || []).forEach(k1 => {
              k1Map.set(`${k1.entityName}-${k1.entityType}-${k1.year}`, k1);
            });
            
            // Add new
            analysis.entities.formK1.forEach(k1 => {
              k1Map.set(`${k1.entityName}-${k1.entityType}-${k1.year}`, k1);
            });
            
            mergedEntities.formK1 = Array.from(k1Map.values());
          }
          
          // Merge itemized deductions (avoid duplicates)
          if (analysis.entities.itemizedDeductions && analysis.entities.itemizedDeductions.length > 0) {
            const deductionsSet = new Set([
              ...(mergedEntities.itemizedDeductions || []),
              ...analysis.entities.itemizedDeductions
            ]);
            mergedEntities.itemizedDeductions = Array.from(deductionsSet);
          }
          
          // Use latest personal info, Schedule C, Schedule E, and Form 1098 (don't merge these)
          mergedEntities.personalInfo = analysis.entities.personalInfo || existingEntities.personalInfo;
          mergedEntities.scheduleC = analysis.entities.scheduleC || existingEntities.scheduleC;
          mergedEntities.scheduleE = analysis.entities.scheduleE || mergedEntities.scheduleE;
          mergedEntities.form1098 = analysis.entities.form1098 || mergedEntities.form1098;
        } catch (error) {
          console.error("Error merging entities:", error);
          // On error, fall back to just the new entities
          mergedEntities = analysis.entities;
        }
      } else {
        // First upload - just use the new entities
        mergedEntities = analysis.entities;
      }
      
      await storage.upsertCustomerDetail({
        customerId,
        category: "TaxEntities",
        label: "StructuredEntities",
        value: JSON.stringify(mergedEntities),
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

  // Generate Schedule E request if rental income exists
  if (entities.scheduleE && entities.scheduleE.hasRentalIncome) {
    const property = entities.scheduleE.propertyAddress || 'rental property';
    requests.push(`Schedule E rental income/expense records for ${property} (${entities.scheduleE.year})`);
  }

  // Generate K-1 requests for each entity
  if (entities.formK1 && entities.formK1.length > 0) {
    entities.formK1.forEach(k1 => {
      requests.push(`Form K-1 from ${k1.entityName} (${k1.entityType}) for ${k1.year}`);
    });
  }

  // Generate Form 1098 request if mortgage interest exists
  if (entities.form1098) {
    const lender = entities.form1098.lenderName || 'mortgage lender';
    requests.push(`Form 1098 (Mortgage Interest) from ${lender} for ${entities.form1098.year}`);
  }

  // Generate itemized deduction requests
  if (entities.itemizedDeductions && entities.itemizedDeductions.length > 0) {
    entities.itemizedDeductions.forEach(deduction => {
      if (deduction.toLowerCase().includes('charitable')) {
        requests.push(`Charitable donation receipts for ${entities.personalInfo?.taxYear || 'current year'}`);
      } else if (!deduction.toLowerCase().includes('mortgage')) {
        // Skip mortgage interest if we already have form1098
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

  // Helper to check if a request is satisfied by completed documents
  const isRequestSatisfied = (request: string, completedDocs: Document[]): boolean => {
    const reqLower = request.toLowerCase();
    
    // Extract key components from request
    const isW2 = reqLower.includes('w-2') || reqLower.includes('w2');
    const is1099 = reqLower.includes('1099');
    const isScheduleC = reqLower.includes('schedule c');
    const isScheduleE = reqLower.includes('schedule e');
    const isK1 = reqLower.includes('k-1') || reqLower.includes('k1');
    const is1098 = reqLower.includes('1098');
    
    // Extract employer/payer name from request (between "from" and "for")
    const fromMatch = reqLower.match(/from\s+(.+?)\s+for/);
    const entityName = fromMatch ? fromMatch[1].toLowerCase() : '';
    
    // Extract full form type for 1099s (e.g., "1099-NEC", "SSA-1099")
    const form1099TypeMatch = reqLower.match(/(ssa-1099|1099-[a-z]+)/);
    const form1099Type = form1099TypeMatch ? form1099TypeMatch[1] : '';
    
    return completedDocs.some(doc => {
      const docLower = doc.name.toLowerCase();
      
      // W-2 matching
      if (isW2) {
        const hasW2 = docLower.includes('w-2') || docLower.includes('w2');
        if (!hasW2) return false;
        
        // If we have an entity name, check for it in the filename
        if (entityName) {
          // Check if any significant word from entity name appears in filename
          const entityWords = entityName.split(/\s+/).filter(w => w.length > 2);
          return entityWords.some(word => docLower.includes(word));
        }
        return true;
      }
      
      // 1099 matching
      if (is1099) {
        // Handle SSA-1099 specifically
        if (form1099Type === 'ssa-1099') {
          const hasSSA = docLower.includes('ssa-1099') || 
                         docLower.includes('ssa1099') || 
                         (docLower.includes('ssa') && docLower.includes('1099'));
          if (!hasSSA) return false;
        } else {
          const has1099 = docLower.includes('1099');
          if (!has1099) return false;
          
          // Check for specific 1099 type if specified (e.g., "1099-nec", "1099nec", "1099 nec")
          if (form1099Type) {
            // Extract the subtype (e.g., "nec" from "1099-nec")
            const subtypeMatch = form1099Type.match(/1099-([a-z]+)/);
            if (subtypeMatch) {
              const subtype = subtypeMatch[1];
              // Match specific 1099 filename patterns (be precise to avoid false positives)
              // Patterns: "1099-NEC", "1099NEC", "1099_NEC", "1099 NEC", "1099.NEC"
              // We check that 1099 and subtype are adjacent or separated by common delimiters only
              const hasType = docLower.includes(`1099-${subtype}`) || 
                             docLower.includes(`1099${subtype}`) ||
                             docLower.includes(`1099_${subtype}`) ||
                             docLower.includes(`1099 ${subtype}`) ||
                             docLower.includes(`1099.${subtype}`);
              if (!hasType) return false;
            }
          }
        }
        
        // Check for entity name
        if (entityName) {
          const entityWords = entityName.split(/\s+/).filter(w => w.length > 2);
          return entityWords.some(word => docLower.includes(word));
        }
        return true;
      }
      
      // Schedule C matching
      if (isScheduleC) {
        return docLower.includes('schedule') && docLower.includes('c');
      }
      
      // Schedule E matching
      if (isScheduleE) {
        return docLower.includes('schedule') && docLower.includes('e');
      }
      
      // K-1 matching
      if (isK1) {
        // Match various K-1 filename patterns: "K-1", "K1", "K 1", "Schedule K-1", "Form K1", etc.
        const hasK1 = docLower.includes('k-1') || 
                     docLower.includes('k1') || 
                     docLower.includes('k 1') ||
                     (docLower.includes('schedule') && docLower.includes('k'));
        if (!hasK1) return false;
        
        // Check for entity name if specified
        if (entityName) {
          const entityWords = entityName.split(/\s+/).filter(w => w.length > 2);
          return entityWords.some(word => docLower.includes(word));
        }
        return true;
      }
      
      // Form 1098 matching
      if (is1098) {
        return docLower.includes('1098');
      }
      
      // Generic matching for other types
      return false;
    });
  };

  // Filter out already satisfied requests
  const missingDocuments = requiredDocuments.filter(req => 
    !isRequestSatisfied(req, completedDocs)
  );

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
