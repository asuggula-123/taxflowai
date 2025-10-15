# TaxFlow - Tax Document Intake Application

## Overview
TaxFlow is an AI-powered professional tax document intake application designed for accountants. Its primary purpose is to streamline the management of customer tax returns by leveraging AI for document analysis, guiding accountants through the collection process, and automatically tracking completion status. The application aims to significantly enhance efficiency and accuracy in tax preparation workflows.

## User Preferences
I prefer iterative development, with a focus on delivering core features first and then refining them. I value clear, concise communication and prefer that you ask before making major architectural changes or introducing new external dependencies.

## System Architecture

### UI/UX Decisions
The frontend uses React with TypeScript, styled with Tailwind CSS and Shadcn UI components for a modern and consistent look. The application features a multi-year intake system with customer summary and intake-specific views. Status badges provide clear visual cues for each tax year intake.

### Technical Implementations
- **Frontend**: React, TypeScript, Wouter for routing, TanStack Query for server state management.
- **Backend**: Express with TypeScript, utilizing Multer for robust file uploads.
- **AI Integration**: Leverages OpenAI GPT-5 for advanced document analysis and chat responses.
  - **Document Analysis**: A two-phase approach extracts structured entities from tax documents (e.g., employers, 1099 payers, Schedule C/E/K-1, Form 1098, personal info) and programmatically generates specific document requests. It uses OpenAI's Files API and Responses API for content-based PDF analysis and automatically cleans up files after analysis.
  - **Entity Accumulation**: Merges entities across multiple uploads to prevent data loss and dedupes based on relevant identifiers.
  - **Intelligent Document Matching**: Uses pattern-based reconciliation with filename variants and entity name matching to link uploaded documents to requested ones.
  - **Chat Response Generation**: AI provides helpful responses and can create actual document entities based on chat conversations (e.g., "W-2 from Microsoft for 2023").
- **Data Model**:
    - **Customers**: id, name, email, createdAt
    - **Tax Year Intakes**: id, customerId, year, status, notes, createdAt
      - Each customer can have multiple tax year intakes
      - Status tracks workflow progression for each tax year
      - Year stored as text (e.g., "2024", "2023")
    - **Documents**: id, intakeId, name, documentType, year, entity, status, filePath, createdAt
      - Linked to specific tax year intake, not directly to customer
      - Structured fields enable precise AI matching and visual display with pills/badges
      - Entity field stores company/organization name (e.g., "Microsoft", "Stripe Inc")
    - **Chat Messages**: id, intakeId, sender, content, createdAt
      - Intake-specific chat history
    - **Customer Details**: id, intakeId, category, label, value, createdAt
      - Intake-specific customer details
    - **Firm Settings**: id, notes, createdAt, updatedAt
      - Global firm-level settings and instructions
    - **Memories**: id, customerId (nullable), content, createdAt
      - Firm-level memories (customerId = null) for universal rules
      - Customer-level memories (customerId set) for client-specific facts
      - Provides audit trail before synthesis into notes

### Feature Specifications
- **Customer Management**: CRUD operations for customers.
- **Multi-Year Intake System**: Each customer can have multiple tax year intakes.
  - **Year Selection**: Dropdown shows current+1 year and 3 prior years when creating intake
  - **Intake-Specific Workflow**: Each tax year has independent documents, chat, and status
  - **Customer Summary**: Shows all tax year intakes for a customer with status badges
- **AI-Powered Document Analysis**: Intelligent feedback on uploaded tax documents.
- **Smart Chat Interface**: AI agent requests missing documents and validates completeness.
- **Structured Workflow**: A three-phase gated workflow per intake:
    1. **Awaiting Tax Return**: Initial state, chat disabled, first upload must be a validated Form 1040 from (intake year - 1).
       - e.g., 2024 intake requires 2023 Form 1040
    2. **Incomplete**: Chat enabled, document collection phase, AI analyzes documents and creates requests.
    3. **Ready**: All requested documents collected, ready for tax preparation.
- **Dynamic Year Validation**: Form 1040 validation adapts to intake year (year - 1).
- **Automatic Status Tracking**: Intake status updates based on workflow progression.
- **Document Validation**: AI validates document types and extracts information from PDF content.
- **Customer Details Extraction**: Populates customer details from documents.
- **Chat-Driven Document Requests**: AI creates document entities from chat conversations.

### System Design Choices
- **In-memory storage (MemStorage)** for current MVP, with future plans for PostgreSQL.
- Server-side enforcement of workflow gates to prevent bypass.
- Robust duplicate prevention for documents across uploads and chat-driven requests.
- Optimized UI for immediate user feedback (optimistic chat, upload progress, AI thinking indicators).
- Comprehensive error handling with clear messages.

## Recent Updates (October 2025)

### Two-Level Memory System (Latest)
- **Architecture**: Hybrid memory approach with individual Memory entities for audit trail and synthesized notes for clean AI context
  - Firm-level memories (customerId = null) for universal rules and standing instructions
  - Customer-level memories (customerId set) for client-specific facts and preferences
- **Memory Detection**: AI analyzes conversations with high bar criteria (universal rules, material facts, recurring patterns only)
  - Distinguishes firm vs customer memories based on conversation context
  - Returns detectedMemories array in chat responses for frontend confirmation
- **Inline Memory Confirmation UI**: MemoryConfirmation component displays detected memories in chat
  - Shows inline after AI messages with Brain icon and content preview
  - Visual badges distinguish "Firm-wide" vs "Customer-specific" memories
  - Confirm button saves memory via POST /api/memories
  - Dismiss button removes memory from UI without saving
  - Robust error handling with isPending state, loading indicators, and toast notifications
  - Memory removed from UI only on successful API response
- **Memory Synthesis**: Converts individual Memory entities into organized prose notes via AI
  - POST /api/memories/synthesize endpoint processes memories at appropriate level
  - Synthesis updates firm settings notes or customer notes based on memory type
- **Firm Settings Page**: /settings route with editable global firm notes
  - Sophisticated concurrent edit handling preserves unsaved text during saves
  - Gated useEffect prevents refetch from overwriting in-progress edits
  - Accurate unsaved change indicators track textarea state vs saved value
- **Customer Notes UI**: Notes tab in CustomerSummary for customer-specific notes
  - Same concurrent edit patterns as firm settings
  - Separate from tax year intake notes for broader customer context
- **AI Context Integration**: Firm notes and customer notes included in AI chat context for contextually aware responses
- **API Patterns**: Consistent `{ notes: string }` payloads with proper null handling across all notes endpoints

### Multi-Year Intake System
- **Architecture Overhaul**: Migrated from customer-centric to intake-centric architecture
  - Added TaxYearIntake table linking customers to year-specific workflows
  - All documents, messages, and details now linked to intakeId instead of customerId
  - Status moved from customer to tax year intake level
- **Customer Summary Page**: Shows customer info and list of all tax year intakes with "Add Intake" functionality
- **Add Intake Modal**: Year selection dropdown (current+1 plus 3 prior years) with optional notes field
- **Dynamic Form 1040 Validation**: Validates uploaded 1040 year matches (intake year - 1)
- **Intake-Specific Pages**: Route structure /customers/:id/intakes/:year for year-specific intake views
- **API Refactoring**: Complete backend update to use intake context for all operations
- **Error Handling**: Proper "intake not found" state with navigation back to customer summary
- **Type Safety**: String() wrappers ensure year comparisons work correctly between route params and stored values

### Entity Field Implementation
- Added structured entity field to documents for storing company/organization names
- Entity field properly persisted across create, update, and edit operations
- UI displays entity as visual pill/badge when present
- Form state syncs correctly when editing documents (useEffect-based synchronization)
- Entity can be added, updated, or cleared (set to null) through edit dialog

### AI Improvements (October 15, 2025)
- **Simplified Memory Detection**: Removed prescriptive examples and pattern-matching constraints from AI prompt
  - Now trusts GPT-5's semantic understanding to identify firm policies and customer-specific facts
  - Minimal guidance instead of rigid rules allows AI to recognize memories from natural language
  - Handles pronouns and varied phrasings ("we always ask for that", "he forgets to mention")
- **Enhanced Upload Error Handling**: Client now parses server error responses for specific validation messages
  - Nested try/catch handles JSON parsing failures and network errors with actionable fallbacks
  - Users see specific errors (wrong document type, wrong year) instead of generic "Upload failed"
  - Robust error flow: parse server JSON → fallback to generic message → catch network errors

### Bug Fixes
- **Customer Type Fix**: Removed status field from Customer type (status now on intakes only)
- **CustomerList Crash**: Fixed StatusBadge crash by removing status display from customer list
- **Routing Consistency**: Changed customer detail route from `/customer/:id` to `/customers/:id` to match API convention
- **Entity Persistence**: Fixed critical bug where entity field was collected in UI but not persisted to database
- **Entity Pre-population**: Fixed bug where editing a document did not pre-populate entity field, causing silent data loss
- **Entity Clearing**: Fixed payload construction to explicitly send null when entity is cleared, ensuring badge removal
- **Upload Error Handling**: Upload endpoint now returns 400 when AI analysis fails instead of 200, preventing invalid document creation
- **Chat Enable After Upload**: Fixed query invalidation mismatch where intake status wasn't refetched after Form 1040 upload (queryKey was `["/api/intakes", intakeId]` but should be `["/api/intakes", customerId, year]`), causing chat to remain disabled
- **Dynamic Year in Chat Message**: Fixed hardcoded "2023" in chat disabled message to dynamically calculate prior year based on intake year

## External Dependencies
- **OpenAI API**: Utilized for AI-powered document analysis (GPT-5) and chat response generation.
- **Multer**: Node.js middleware for handling `multipart/form-data`, primarily for file uploads.