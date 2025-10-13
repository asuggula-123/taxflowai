# TaxFlow - Tax Document Intake Application

## Overview
TaxFlow is a professional tax document intake application designed for accountants to efficiently manage customer tax returns. The application uses AI-powered document analysis to guide accountants through the document collection process and automatically track completion status.

## Core Features
- **Customer Management**: Add and track customers with name and email
- **AI-Powered Document Analysis**: Upload tax documents and receive intelligent feedback
- **Smart Chat Interface**: AI agent requests missing documents and validates completeness
- **Automatic Status Tracking**: Customer status updates from "Not Started" → "Incomplete" → "Ready"
- **Document Validation**: AI validates document types and extracts relevant tax information
- **Customer Details Extraction**: Automatically populate customer details from uploaded documents

## Architecture

### Frontend (React + TypeScript)
- **Pages**: 
  - Home: Customer list with status indicators
  - CustomerDetail: Three-section layout (documents, details, chat)
- **Components**: Reusable UI components for status badges, document lists, chat interface
- **State Management**: TanStack Query for server state
- **Styling**: Tailwind CSS + Shadcn UI components

### Backend (Express + TypeScript)
- **Storage**: In-memory storage (MemStorage) for MVP
- **API Routes**:
  - `/api/customers` - Customer CRUD operations
  - `/api/customers/:id/documents` - Document management
  - `/api/customers/:id/messages` - Chat messages
  - `/api/customers/:id/details` - Customer tax details
- **File Upload**: Multer for handling document uploads

### AI Integration (OpenAI GPT-5)
- **Document Analysis**: Two-phase structured approach for guaranteed specificity
  - Phase 1: Extracts structured entities (employers[], form1099Payers[], scheduleC, scheduleE, formK1[], form1098, personalInfo)
  - Phase 2: Programmatically generates specific document requests from entities
  - Uploads PDF files to OpenAI for content-based analysis
  - Validates tax documents and extracts information from actual content
  - Automatic file cleanup after analysis to prevent quota exhaustion
- **Entity Accumulation**: Merges entities across multiple uploads (preserves all data)
- **Intelligent Document Matching**: Pattern-based reconciliation with multiple filename variants
- **Chat Response Generation**: Provides helpful responses to accountant queries

## Data Model

### Customers
- id, name, email, status ("Not Started" | "Incomplete" | "Ready"), createdAt

### Documents
- id, customerId, name, status ("requested" | "completed"), filePath, createdAt

### Chat Messages
- id, customerId, sender ("accountant" | "ai"), content, createdAt

### Customer Details
- id, customerId, category, label, value, createdAt

## Workflow

1. **Add Customer**: Accountant creates new customer with name and email
2. **Initial AI Message**: System automatically creates first AI message requesting last year's tax return
3. **Upload Documents**: Accountant uploads tax documents via drag-and-drop
4. **AI Analysis**: System analyzes each document, validates type, and extracts information
5. **Status Updates**: Customer status automatically updates based on document completeness
6. **Chat Interaction**: Accountant can chat with AI to provide additional details
7. **Completion**: When all documents are collected, status updates to "Ready"

## Environment Variables
- `OPENAI_API_KEY`: Required for AI-powered document analysis and chat

## Tech Stack
- **Frontend**: React, TypeScript, Wouter, TanStack Query, Tailwind CSS, Shadcn UI
- **Backend**: Express, TypeScript, Multer
- **AI**: OpenAI GPT-5
- **Storage**: In-memory (MemStorage) - can be migrated to PostgreSQL

## Recent Changes (Latest Session - October 13, 2025)

### New Features
- **Two-Phase Structured Approach**: Replaced prompt-engineering with structural enforcement for guaranteed specificity
  - Phase 1 (analyzeDocument): Extracts structured entities from tax documents
    - Employers: name, wages, year (one object per employer)
    - 1099 Payers: name, type (1099-NEC, 1099-INT, etc.), amount, year
    - Schedule C, E, K-1, Form 1098: Specific business/property/entity details
    - Personal info and itemized deductions
  - Phase 2 (determineNextSteps): Programmatically generates specific requests from entities
    - One request per employer: "W-2 from [Employer Name] for [Year]"
    - One request per 1099 payer: "[1099-Type] from [Payer Name] for [Year]"
    - Specific requests for Schedule C, E, K-1, Form 1098 based on extracted data
    - **Impossible to generate generic "as applicable" requests**
- **Entity Accumulation**: Merges entities across multiple uploads
  - Deep clones existing entities, then overlays new entities
  - Prevents data loss when AI omits arrays in subsequent uploads
  - Deduplicates by name+year (employers), name+type+year (1099s), entity+type+year (K-1s)
- **Intelligent Document Matching**: Pattern-based reconciliation for real-world filenames
  - Handles multiple delimiter patterns: `1099-NEC`, `1099NEC`, `1099_NEC`, `1099 NEC`, `1099.NEC`
  - SSA-1099 specific handling: `ssa-1099`, `ssa1099`, `ssa + 1099`
  - K-1 variants: `k-1`, `k1`, `k 1`, `schedule k-1`
  - W-2 variants: `w-2`, `w2`, `w 2`
  - Entity name word-matching (e.g., "Google" in filename matches "Google LLC")
  - **No false positives**: Requires explicit delimiter-based patterns
- **PDF Content Analysis**: Implemented actual PDF content analysis using OpenAI Files API + Responses API
  - Uploads PDF files to OpenAI for content-based analysis
  - Uses GPT-5 with Responses API to extract specific tax form details
  - File validation: 10MB size limit, empty file detection, missing file handling
  - Automatic cleanup of uploaded OpenAI files to prevent quota exhaustion
- **Delete Customer**: Added ability to delete customers with confirmation dialog and automatic cleanup
- **Upload Progress Indicators**: Real-time visual feedback during document upload and AI analysis

### Improvements
- **Expanded Form Coverage**: Now handles all major tax forms
  - W-2, all 1099 types (NEC, INT, DIV, R, MISC, SSA-1099, etc.)
  - Schedule C (business), Schedule E (rental property)
  - Form K-1 (partnerships, S-corps, estates, trusts)
  - Form 1098 (mortgage interest)
- **Document Matching Logic**: Smart matching system that updates existing requested documents instead of creating duplicates
  - Normalizes tax form identifiers (W-2 → w2, 1099-MISC → 1099misc, etc.)
  - Token-based similarity scoring with 30% threshold
  - Year-matching boost for tax documents from same period
  - Only matches documents with status="requested" to prevent overwriting completed uploads
  - Filters generic filler words for better matching accuracy
  - Tracks matched documents within upload batch to prevent duplicate matches
  - **Document Name Preservation**: When matching uploaded files to requested documents, actual uploaded filename is preserved instead of generic name
- **Document List UI**: Improved layout for better readability
  - Status badge moved to left side of filename (Badge → Icon → Filename)
  - Long filenames now wrap to multiple lines instead of truncating
  - Proper alignment with `items-start` for wrapped text
  - Clean, professional layout with consistent spacing

### Bug Fixes
- **AI Follow-up Messages**: Fixed issue where AI would acknowledge document upload but not request additional documents
  - Next steps message now always created after upload, even when AI encounters errors
  - Ensures accountants always receive guidance on what to do next
- **Filename Display**: Fixed issue where uploaded documents showed generic names instead of actual filenames
  - `updateDocumentStatus` now accepts optional name parameter
  - Requested documents are updated with real uploaded filename when matched
- **Error Handling**: Removed fallback AI responses when OpenAI API is unavailable
  - Now shows clean error messages only (e.g., "⚠️ OpenAI API quota exceeded. Unable to analyze document at this time.")
  - No misleading fallback suggestions or analysis attempts
  - Users see exactly when AI is working vs when there's an issue

### Technical Details
- Conservative matching approach balances flexibility with accuracy
- AI requests documents with distinctive names for better matching
- Won't match all edge cases (e.g., state abbreviations) but handles common scenarios
- Upload mutation includes onMutate for immediate feedback and improved toast messages
- Clean error handling when OpenAI API encounters quota or other errors
- **AI Model**: Confirmed using OpenAI GPT-5 (not GPT-5 mini) for all analysis and chat responses

## Known Limitations
- In-memory storage (data persists only during runtime)
- No multi-user authentication (single accountant use)
- Document matching won't handle all domain-specific abbreviations (designed conservatively)
- 10MB file size limit for PDF uploads

## Future Enhancements
- PostgreSQL database for persistent storage
- Multi-user support with authentication
- Email notifications for status changes
- Document version history
- Export finalized tax packages
- Support for additional document formats (images, Word docs)
