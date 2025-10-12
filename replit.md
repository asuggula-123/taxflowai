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
- **Document Analysis**: Validates tax documents and extracts information
- **Next Steps Determination**: Analyzes current state and determines missing documents
- **Chat Response Generation**: Provides helpful responses to accountant queries
- **Automatic Detail Extraction**: Populates customer details from uploaded documents

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

## Recent Changes (Latest Session - October 12, 2025)

### New Features
- **Delete Customer**: Added ability to delete customers with confirmation dialog and automatic cleanup of all related data (documents, messages, details)
- **Upload Progress Indicators**: Real-time visual feedback during document upload and AI analysis with spinner and disabled states

### Improvements
- **Enhanced AI Prompts**: More specific document validation feedback with better fallback messages and improved customer detail extraction
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
- AI analysis based on filename patterns (no actual file content parsing for MVP)
- No multi-user authentication (single accountant use)
- Document matching won't handle all domain-specific abbreviations (designed conservatively)

## Future Enhancements
- PostgreSQL database for persistent storage
- Multi-user support with authentication
- Actual PDF parsing for document content analysis
- Email notifications for status changes
- Document version history
- Export finalized tax packages
