import OpenAI from "openai";
import { storage } from "./storage";
import type { Document, CustomerDetail } from "@shared/schema";
import fs from "fs";
import { progressService } from "./progress-service";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Provenance information for entities
interface Provenance {
  page?: number;
  lineReference?: string;
  evidence: string;
}

// Structured entities extracted from tax documents
interface TaxEntities {
  employers?: Array<{
    name: string;
    wages: number;
    year: number;
    provenance?: Provenance;
  }>;
  form1099Payers?: Array<{
    name: string;
    type: string; // e.g., "1099-NEC", "1099-INT", "1099-DIV", "1099-R", "SSA-1099"
    amount: number;
    year: number;
    provenance?: Provenance;
  }>;
  scheduleC?: {
    businessName: string;
    hasIncome: boolean;
    year: number;
    provenance?: Provenance;
  };
  scheduleE?: {
    propertyAddress?: string;
    hasRentalIncome: boolean;
    year: number;
    provenance?: Provenance;
  };
  formK1?: Array<{
    entityName: string;
    entityType: string; // "Partnership", "S-Corp", "Estate", "Trust"
    year: number;
    provenance?: Provenance;
  }>;
  form1098?: {
    lenderName?: string;
    year: number;
    provenance?: Provenance;
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
  missingDocuments: StructuredDocumentRequest[];
  isComplete: boolean;
  message: string;
  customerStatus: "Awaiting Tax Return" | "Incomplete" | "Ready";
}

export interface StructuredDocumentRequest {
  name: string;
  documentType: string;
  year: string;
  entity?: string;
  provenance?: Provenance;
}

interface TaxReturnValidation {
  isValid: boolean;
  isForm1040: boolean;
  isTaxYear2023: boolean;
  taxpayerNameMatches: boolean;
  extractedTaxpayerName?: string;
  extractedTaxYear?: number;
  errorMessage?: string;
}

export async function validateTaxReturn(
  fileName: string,
  filePath: string,
  customerName: string,
  intakeYear: string
): Promise<TaxReturnValidation> {
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

    // Calculate the expected prior year (intake year - 1)
    const expectedPriorYear = parseInt(intakeYear) - 1;

    // Validate the tax return using Responses API
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
              text: `You are a tax document validator. Analyze this document and validate it as a ${expectedPriorYear} Form 1040 tax return.

Customer name to match: "${customerName}"

Validation criteria:
1. Is this a Form 1040 (U.S. Individual Income Tax Return)?
2. Is the tax year ${expectedPriorYear}?
3. Does the taxpayer name on the return match "${customerName}"? (Be flexible with name matching - accept partial matches, different name orders, or middle name variations)

Extract:
- Document type (exact form name)
- Tax year from the document
- Taxpayer name(s) from the document

Respond in JSON format:
{
  "isForm1040": true/false,
  "isTaxYear2023": true/false,
  "taxpayerNameMatches": true/false,
  "extractedTaxpayerName": "Name as shown on form",
  "extractedTaxYear": ${expectedPriorYear},
  "documentType": "Form 1040 or other",
  "errorMessage": "Specific reason if validation fails (e.g., 'This is a Form W-2, not Form 1040', 'Tax year is ${expectedPriorYear + 1}, not ${expectedPriorYear}', 'Taxpayer name John Smith does not match ${customerName}')"
}

Be precise and validate against actual document content.`
            }
          ]
        }
      ],
      text: { format: { type: "json_object" } }
    });

    const validation = JSON.parse(response.output_text || "{}");
    
    return {
      isValid: validation.isForm1040 && validation.isTaxYear2023 && validation.taxpayerNameMatches,
      isForm1040: validation.isForm1040 || false,
      isTaxYear2023: validation.isTaxYear2023 || false,
      taxpayerNameMatches: validation.taxpayerNameMatches || false,
      extractedTaxpayerName: validation.extractedTaxpayerName,
      extractedTaxYear: validation.extractedTaxYear,
      errorMessage: validation.errorMessage
    };
  } catch (error: any) {
    console.error("Tax return validation error:", error);
    return {
      isValid: false,
      isForm1040: false,
      isTaxYear2023: false,
      taxpayerNameMatches: false,
      errorMessage: error.message || "Failed to validate tax return"
    };
  } finally {
    // Clean up uploaded file
    if (uploadedFileId) {
      try {
        await openai.files.delete(uploadedFileId);
      } catch (error) {
        console.error("Failed to delete uploaded file:", uploadedFileId);
      }
    }
  }
}

export async function analyzeDocument(
  fileName: string,
  filePath: string,
  intakeId: string,
  uploadId?: string
): Promise<DocumentAnalysis> {
  let uploadedFileId: string | null = null;
  
  try {
    // Get intake and customer for progress tracking
    const intake = await storage.getIntake(intakeId);
    if (!intake) {
      throw new Error("Intake not found");
    }
    const customerId = intake.customerId;
    
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
              text: `You are an expert tax preparation assistant. Analyze this tax document and extract STRUCTURED entities with PROVENANCE.

Based on the ACTUAL DOCUMENT CONTENT, extract structured data:

For Form 1040 (Tax Return):
- Extract EACH W-2 employer as separate object with name, wages, year, AND provenance
- Extract EACH 1099 payer with specific type (1099-NEC, 1099-INT, 1099-DIV, 1099-R, SSA-1099, etc.), payer name, amount, year, AND provenance
- Extract Schedule C business info if present (business name, year, provenance)
- Extract Schedule E rental property info if present (property address, year, provenance)
- Extract K-1 info if present (entity name, type: Partnership/S-Corp/Estate/Trust, year, provenance)
- Extract Form 1098 mortgage interest if present (lender name, year, provenance)
- Extract personal info (taxpayer name, filing status, tax year)
- Extract itemized deductions if applicable

For W-2:
- Extract employer as single employer object with provenance

For 1099 (all types):
- Extract as single form1099Payers object with specific type and provenance

For Schedule C:
- Extract as scheduleC object with provenance

For Schedule E:
- Extract as scheduleE object with provenance

For K-1:
- Extract as formK1 array item with provenance

For 1098:
- Extract as form1098 object with provenance

PROVENANCE REQUIREMENTS:
For EACH entity, include:
- page: The page number where you found this information (if available)
- lineReference: The specific line number or section (e.g., "Line 1a", "Schedule 1 Line 3")
- evidence: A brief description of what you saw (e.g., "W-2 wages of $125,000 from Acme Corp", "1099-R retirement distribution of $45,000 from Fidelity")

CRITICAL: Extract actual entities found in the document, not generic categories.

Respond in JSON format:
{
  "isValid": true,
  "documentType": "exact form name with year (e.g., 'Form 1040 (2023)', 'Form W-2 (2024)')",
  "missingInfo": ["list any missing information"],
  "entities": {
    "employers": [{"name": "Google LLC", "wages": 85000, "year": 2024, "provenance": {"page": 12, "lineReference": "Line 1a", "evidence": "W-2 wages of $85,000 from Google LLC"}}],
    "form1099Payers": [{"name": "Stripe Inc", "type": "1099-NEC", "amount": 15000, "year": 2024, "provenance": {"page": 13, "lineReference": "Schedule 1 Line 3", "evidence": "1099-NEC income of $15,000 from Stripe Inc"}}],
    "scheduleC": {"businessName": "Acme Consulting", "hasIncome": true, "year": 2024, "provenance": {"lineReference": "Schedule C", "evidence": "Business income from Acme Consulting"}},
    "scheduleE": {"propertyAddress": "123 Main St", "hasRentalIncome": true, "year": 2024, "provenance": {"lineReference": "Schedule E", "evidence": "Rental income from 123 Main St"}},
    "formK1": [{"entityName": "ABC Partnership", "entityType": "Partnership", "year": 2024, "provenance": {"lineReference": "Schedule E Line 28", "evidence": "K-1 income from ABC Partnership (Partnership)"}}],
    "form1098": {"lenderName": "Chase Bank", "year": 2024, "provenance": {"lineReference": "Schedule A Line 8a", "evidence": "Mortgage interest from Chase Bank"}},
    "personalInfo": {"taxpayerName": "John Doe", "filingStatus": "Married Filing Jointly", "taxYear": 2023},
    "itemizedDeductions": ["mortgage interest", "charitable donations"]
  },
  "extractedDetails": [{"category": "Personal Info|Income Sources|Deductions|Tax History", "label": "descriptive label", "value": "value"}],
  "feedback": "specific confirmation of what you found"
}

IMPORTANT: 
- Only include entity fields that are actually found in the document. Leave arrays empty if no entities found.
- ALWAYS include provenance for every entity you extract (except personalInfo and itemizedDeductions).
- If you cannot determine the page number, omit the "page" field but always include "lineReference" and "evidence".`
            }
          ]
        }
      ],
      text: { format: { type: "json_object" } }
    });

    const analysis: DocumentAnalysis = JSON.parse(
      response.output_text || "{}"
    );
    
    // Emit extracting progress
    if (uploadId) {
      progressService.sendProgress({
        customerId,
        uploadId,
        step: "extracting",
        message: "Extracting tax information...",
        progress: 50
      });
    }
    
    // VALIDATION PASS: Check for missed entities (2nd pass for accuracy)
    if (analysis.entities && uploadedFileId) {
      try {
        const missedEntities = await validateExtractedEntities(uploadedFileId, analysis.entities);
        
        // Merge missed entities with original extraction
        if (missedEntities && Object.keys(missedEntities).length > 0) {
          console.log("Validation pass found additional entities:", JSON.stringify(missedEntities));
          
          // Merge employers
          if (missedEntities.employers && missedEntities.employers.length > 0) {
            analysis.entities.employers = [
              ...(analysis.entities.employers || []),
              ...missedEntities.employers
            ];
          }
          
          // Merge 1099 payers
          if (missedEntities.form1099Payers && missedEntities.form1099Payers.length > 0) {
            analysis.entities.form1099Payers = [
              ...(analysis.entities.form1099Payers || []),
              ...missedEntities.form1099Payers
            ];
          }
          
          // Merge K-1 forms
          if (missedEntities.formK1 && missedEntities.formK1.length > 0) {
            analysis.entities.formK1 = [
              ...(analysis.entities.formK1 || []),
              ...missedEntities.formK1
            ];
          }
          
          // Use missed entities for singleton fields if original was empty
          if (missedEntities.scheduleC && !analysis.entities.scheduleC) {
            analysis.entities.scheduleC = missedEntities.scheduleC;
          }
          if (missedEntities.scheduleE && !analysis.entities.scheduleE) {
            analysis.entities.scheduleE = missedEntities.scheduleE;
          }
          if (missedEntities.form1098 && !analysis.entities.form1098) {
            analysis.entities.form1098 = missedEntities.form1098;
          }
        }
      } catch (validationError) {
        console.error("Validation pass failed, continuing with original extraction:", validationError);
      }
    }
    
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
      const existingEntitiesDetail = (await storage.getCustomerDetailsByIntake(intakeId))
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
          // Merge employers (avoid duplicates by name+year, preserve provenance)
          if (analysis.entities.employers && analysis.entities.employers.length > 0) {
            type Employer = { name: string; wages: number; year: number; provenance?: Provenance };
            const employersMap = new Map<string, Employer>();
            
            // Start with existing
            (mergedEntities.employers || []).forEach(emp => {
              employersMap.set(`${emp.name}-${emp.year}`, emp);
            });
            
            // Add new (overwrites existing with same key, keeping new provenance)
            analysis.entities.employers.forEach(emp => {
              employersMap.set(`${emp.name}-${emp.year}`, emp);
            });
            
            mergedEntities.employers = Array.from(employersMap.values());
          }
          
          // Merge 1099 payers (avoid duplicates by name+type+year, preserve provenance)
          if (analysis.entities.form1099Payers && analysis.entities.form1099Payers.length > 0) {
            type Payer = { name: string; type: string; amount: number; year: number; provenance?: Provenance };
            const payersMap = new Map<string, Payer>();
            
            // Start with existing
            (mergedEntities.form1099Payers || []).forEach(payer => {
              payersMap.set(`${payer.name}-${payer.type}-${payer.year}`, payer);
            });
            
            // Add new (overwrites existing with same key, keeping new provenance)
            analysis.entities.form1099Payers.forEach(payer => {
              payersMap.set(`${payer.name}-${payer.type}-${payer.year}`, payer);
            });
            
            mergedEntities.form1099Payers = Array.from(payersMap.values());
          }
          
          // Merge K-1 forms (avoid duplicates by entity name+type+year, preserve provenance)
          if (analysis.entities.formK1 && analysis.entities.formK1.length > 0) {
            type K1 = { entityName: string; entityType: string; year: number; provenance?: Provenance };
            const k1Map = new Map<string, K1>();
            
            // Start with existing
            (mergedEntities.formK1 || []).forEach(k1 => {
              k1Map.set(`${k1.entityName}-${k1.entityType}-${k1.year}`, k1);
            });
            
            // Add new (overwrites existing with same key, keeping new provenance)
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
        intakeId,
        category: "TaxEntities",
        label: "StructuredEntities",
        value: JSON.stringify(mergedEntities),
      });
    }

    // Store extracted details in the database (for display purposes)
    if (analysis.extractedDetails) {
      for (const detail of analysis.extractedDetails) {
        await storage.upsertCustomerDetail({
          intakeId,
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

// Validation pass: Review extracted entities and catch any missed items
async function validateExtractedEntities(
  fileId: string,
  extractedEntities: TaxEntities
): Promise<TaxEntities> {
  try {
    // Create a summary of what we found
    const summary = {
      employers: extractedEntities.employers?.map(e => e.name) || [],
      form1099Payers: extractedEntities.form1099Payers?.map(p => `${p.type} from ${p.name}`) || [],
      scheduleC: extractedEntities.scheduleC?.businessName || null,
      scheduleE: extractedEntities.scheduleE?.propertyAddress || null,
      formK1: extractedEntities.formK1?.map(k => `${k.entityName} (${k.entityType})`) || [],
      form1098: extractedEntities.form1098?.lenderName || null,
    };

    const response = await openai.responses.create({
      model: "gpt-5",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              file_id: fileId,
            },
            {
              type: "input_text",
              text: `You are validating a tax document extraction. I already found these entities:

EMPLOYERS (W-2): ${summary.employers.join(', ') || 'None'}
1099 PAYERS: ${summary.form1099Payers.join(', ') || 'None'}
SCHEDULE C BUSINESS: ${summary.scheduleC || 'None'}
SCHEDULE E PROPERTY: ${summary.scheduleE || 'None'}
K-1 ENTITIES: ${summary.formK1.join(', ') || 'None'}
FORM 1098 LENDER: ${summary.form1098 || 'None'}

VALIDATION TASK:
1. Review the document carefully
2. Check if I MISSED any income sources, entities, or deductions
3. Return ONLY the MISSING entities with provenance

If you find missing entities, return them in the same JSON format as the extraction, including provenance:
{
  "employers": [{"name": "...", "wages": 0, "year": 2024, "provenance": {"page": 12, "lineReference": "Line 1a", "evidence": "..."}}],
  "form1099Payers": [{"name": "...", "type": "1099-R", "amount": 0, "year": 2024, "provenance": {"lineReference": "...", "evidence": "..."}}],
  "scheduleC": {"businessName": "...", "hasIncome": true, "year": 2024, "provenance": {"lineReference": "...", "evidence": "..."}},
  "scheduleE": {"propertyAddress": "...", "hasRentalIncome": true, "year": 2024, "provenance": {"lineReference": "...", "evidence": "..."}},
  "formK1": [{"entityName": "...", "entityType": "Partnership", "year": 2024, "provenance": {"lineReference": "...", "evidence": "..."}}],
  "form1098": {"lenderName": "...", "year": 2024, "provenance": {"lineReference": "...", "evidence": "..."}}
}

If nothing was missed, return an empty object: {}

CRITICAL: 
- ONLY return entities that were MISSED in the first extraction
- DO NOT repeat entities I already found
- ALWAYS include provenance (page, lineReference, evidence) for any missing entities you find
- Focus on income sources and major deductions`
            }
          ]
        }
      ],
      text: { format: { type: "json_object" } }
    });

    const missedEntities: TaxEntities = JSON.parse(response.output_text || "{}");
    return missedEntities;
  } catch (error) {
    console.error("Error in validation pass:", error);
    return {}; // Return empty on error, don't fail the whole process
  }
}

// Helper function to generate specific document requests from structured entities
// If entities are from prior year (2023), request current year (2024) equivalents
function generateDocumentRequestsFromEntities(entities: TaxEntities): StructuredDocumentRequest[] {
  const requests: StructuredDocumentRequest[] = [];
  
  // Determine target year: if entities are from prior year (2023), request 2024 docs
  const getTargetYear = (entityYear?: number): string => {
    if (entityYear === 2023) return "2024";
    return entityYear?.toString() || "2024";
  };

  // Generate W-2 requests for each employer
  if (entities.employers && entities.employers.length > 0) {
    entities.employers.forEach(employer => {
      const targetYear = getTargetYear(employer.year);
      requests.push({
        name: `W-2 from ${employer.name} for ${targetYear}`,
        documentType: "W-2",
        year: targetYear,
        entity: employer.name,
        provenance: employer.provenance
      });
    });
  }

  // Generate 1099 requests for each payer
  if (entities.form1099Payers && entities.form1099Payers.length > 0) {
    entities.form1099Payers.forEach(payer => {
      const targetYear = getTargetYear(payer.year);
      requests.push({
        name: `${payer.type} from ${payer.name} for ${targetYear}`,
        documentType: payer.type,
        year: targetYear,
        entity: payer.name,
        provenance: payer.provenance
      });
    });
  }

  // Generate Schedule C request if business income exists
  if (entities.scheduleC && entities.scheduleC.hasIncome) {
    const targetYear = getTargetYear(entities.scheduleC.year);
    requests.push({
      name: `Schedule C for ${entities.scheduleC.businessName} (${targetYear})`,
      documentType: "Schedule C",
      year: targetYear,
      entity: entities.scheduleC.businessName,
      provenance: entities.scheduleC.provenance
    });
  }

  // Generate Schedule E request if rental income exists
  if (entities.scheduleE && entities.scheduleE.hasRentalIncome) {
    const property = entities.scheduleE.propertyAddress || 'rental property';
    const targetYear = getTargetYear(entities.scheduleE.year);
    requests.push({
      name: `Schedule E for ${property} (${targetYear})`,
      documentType: "Schedule E",
      year: targetYear,
      entity: property,
      provenance: entities.scheduleE.provenance
    });
  }

  // Generate K-1 requests for each entity
  if (entities.formK1 && entities.formK1.length > 0) {
    entities.formK1.forEach(k1 => {
      const targetYear = getTargetYear(k1.year);
      requests.push({
        name: `Schedule K-1 from ${k1.entityName} (${k1.entityType}) for ${targetYear}`,
        documentType: "Schedule K-1",
        year: targetYear,
        entity: `${k1.entityName} (${k1.entityType})`,
        provenance: k1.provenance
      });
    });
  }

  // Generate Form 1098 request if mortgage interest exists
  if (entities.form1098) {
    const lender = entities.form1098.lenderName || 'mortgage lender';
    const targetYear = getTargetYear(entities.form1098.year);
    requests.push({
      name: `Form 1098 from ${lender} for ${targetYear}`,
      documentType: "Form 1098",
      year: targetYear,
      entity: lender,
      provenance: entities.form1098.provenance
    });
  }

  return requests;
}

export async function determineNextSteps(
  intakeId: string
): Promise<NextStepsAnalysis> {
  const documents = await storage.getDocumentsByIntake(intakeId);
  const details = await storage.getCustomerDetailsByIntake(intakeId);

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
  const isRequestSatisfied = (request: StructuredDocumentRequest, completedDocs: Document[]): boolean => {
    const reqLower = request.name.toLowerCase();
    const docType = request.documentType.toLowerCase();
    const entityName = request.entity?.toLowerCase() || '';
    
    // Extract key components from document type
    const isW2 = docType.includes('w-2') || docType.includes('w2');
    const is1099 = docType.includes('1099');
    const isScheduleC = docType.includes('schedule c');
    const isScheduleE = docType.includes('schedule e');
    const isK1 = docType.includes('k-1') || docType.includes('k1') || docType.includes('schedule k-1');
    const is1098 = docType.includes('1098');
    
    // Extract full form type for 1099s (e.g., "1099-NEC", "SSA-1099")
    const form1099TypeMatch = docType.match(/(ssa-1099|1099-[a-z]+)/);
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
  
  let customerStatus: "Awaiting Tax Return" | "Incomplete" | "Ready" = "Incomplete";
  if (completedDocs.length === 0) {
    customerStatus = "Awaiting Tax Return";
  } else if (isComplete) {
    customerStatus = "Ready";
  }

  // Generate message
  let message = "";
  if (isComplete) {
    message = "All required documents have been collected. This customer is ready for tax preparation!";
  } else if (missingDocuments.length > 0) {
    const docNames = missingDocuments.slice(0, 3).map(d => d.name).join(", ");
    message = `Please upload the following documents: ${docNames}${missingDocuments.length > 3 ? `, and ${missingDocuments.length - 3} more` : ""}.`;
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

export interface DetectedMemory {
  type: 'firm' | 'customer';
  content: string;
  reason: string;
}

interface ChatResponseResult {
  message: string;
  requestedDocuments: StructuredDocumentRequest[];
}

export async function synthesizeMemoriesIntoNotes(
  memories: { content: string; createdAt: Date }[]
): Promise<string> {
  if (memories.length === 0) {
    return "";
  }

  try {
    const memoriesList = memories
      .map((m, i) => `${i + 1}. ${m.content} (saved: ${new Date(m.createdAt).toLocaleDateString()})`)
      .join('\n');

    const prompt = `You are organizing tax preparation notes. Synthesize the following individual memories into a clean, organized note format.

Individual memories:
${memoriesList}

Your task:
1. Group related memories together
2. Remove duplicates or redundant information
3. Present information in a clear, scannable format
4. Use bullet points or short paragraphs
5. Keep it concise and actionable

Return ONLY the synthesized notes as plain text, formatted for easy reading.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: "You are a professional note organizer. Create clear, concise, well-organized notes.",
        },
        { role: "user", content: prompt },
      ],
    });

    return response.choices[0].message.content || "";
  } catch (error) {
    console.error("Error synthesizing memories:", error);
    // Fallback: just join memories with line breaks
    return memories.map(m => `• ${m.content}`).join('\n');
  }
}

/**
 * Fast, focused memory detection using GPT-4o-mini
 * Runs in parallel with main chat response for ChatGPT-like UX
 */
export async function detectMemories(
  userMessage: string,
  intakeId: string
): Promise<DetectedMemory[]> {
  const intake = await storage.getIntake(intakeId);
  if (!intake) {
    return [];
  }
  
  const customer = await storage.getCustomer(intake.customerId);
  const messages = await storage.getChatMessagesByIntake(intakeId);
  const firmSettings = await storage.getFirmSettings();
  const customerNotes = customer?.notes || "";

  const recentConversation = messages.slice(-5).map((m) => `${m.sender}: ${m.content}`).join("\n");

  const prompt = `Analyze this tax preparation conversation for memorable information.

Current conversation:
Accountant: "${userMessage}"

Context:
- Customer: ${customer?.name}
- Tax Year: ${intake.year}
- Recent conversation: ${recentConversation}
- Firm notes: ${firmSettings?.notes || "None"}
- Customer notes: ${customerNotes || "None"}

Your ONLY task: Identify if this message contains information worth remembering for future tax preparation.

Detect as FIRM memory if:
- Contains phrases like "we always/never ask for X"
- States a firm-wide policy or process
- Describes standard procedures for all customers

Detect as CUSTOMER memory if:
- States recurring patterns for this specific taxpayer
- Material facts about this customer's tax situation
- Customer-specific preferences or requirements

If nothing memorable, return empty array.`;

  const memorySchema = {
    type: "object" as const,
    properties: {
      detectedMemories: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            type: { type: "string" as const, enum: ["firm", "customer"] },
            content: { type: "string" as const },
            reason: { type: "string" as const }
          },
          required: ["type", "content", "reason"],
          additionalProperties: false
        }
      }
    },
    required: ["detectedMemories"],
    additionalProperties: false
  };

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a memory detection specialist. Identify valuable information worth remembering for tax preparation.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { 
        type: "json_schema",
        json_schema: {
          name: "memory_detection",
          strict: true,
          schema: memorySchema
        }
      },
    });

    const content = response.choices[0].message.content || "{}";
    const parsed = JSON.parse(content);
    
    return Array.isArray(parsed.detectedMemories) ? parsed.detectedMemories : [];
  } catch (error) {
    console.error("Error detecting memories:", error);
    return [];
  }
}

export async function generateChatResponse(
  userMessage: string,
  intakeId: string
): Promise<ChatResponseResult> {
  const intake = await storage.getIntake(intakeId);
  if (!intake) {
    throw new Error("Intake not found");
  }
  
  const customer = await storage.getCustomer(intake.customerId);
  const documents = await storage.getDocumentsByIntake(intakeId);
  const details = await storage.getCustomerDetailsByIntake(intakeId);
  const messages = await storage.getChatMessagesByIntake(intakeId);
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

  const prompt = `You are a helpful tax preparation assistant. We are preparing ${intake.year} tax returns. The accountant said: "${userMessage}"

Current context:
${context}

Instructions:

1. Respond helpfully to the accountant in the "message" field

2. If they mention new income sources or tax obligations not in the document list, create specific document requests for ${intake.year} in the "requestedDocuments" array
`;

  // Define strict JSON schema for structured outputs (detectedMemories handled separately)
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

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a professional tax preparation assistant.",
        },
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
    });

    const content = response.choices[0].message.content || "{}";
    const parsed = JSON.parse(content);
    
    // Validate and parse requested documents
    const requestedDocuments: StructuredDocumentRequest[] = [];
    if (Array.isArray(parsed.requestedDocuments)) {
      for (const doc of parsed.requestedDocuments) {
        if (doc.name && doc.documentType && doc.year) {
          requestedDocuments.push({
            name: doc.name,
            documentType: doc.documentType,
            year: doc.year,
            entity: doc.entity
          });
        }
      }
    }
    
    return {
      message: parsed.message || "I'm here to help!",
      requestedDocuments,
    };
  } catch (error) {
    console.error("Error generating chat response:", error);
    return {
      message: "I understand. Please continue with the document upload process.",
      requestedDocuments: [],
    };
  }
}
