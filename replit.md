# TaxFlow - Tax Document Intake Application

## Overview
TaxFlow is an AI-powered professional tax document intake application designed for accountants. Its primary purpose is to streamline the management of customer tax returns by leveraging AI for document analysis, guiding accountants through the collection process, and automatically tracking completion status. The application aims to significantly enhance efficiency and accuracy in tax preparation workflows.

## User Preferences
I prefer iterative development, with a focus on delivering core features first and then refining them. I value clear, concise communication and prefer that you ask before making major architectural changes or introducing new external dependencies.

## System Architecture

### UI/UX Decisions
The frontend uses React with TypeScript, styled with Tailwind CSS and Shadcn UI components for a modern and consistent look. The application features a three-section layout for customer details (documents, details, chat) and uses status badges for clear visual cues.

### Technical Implementations
- **Frontend**: React, TypeScript, Wouter for routing, TanStack Query for server state management.
- **Backend**: Express with TypeScript, utilizing Multer for robust file uploads.
- **AI Integration**: Leverages OpenAI GPT-5 for advanced document analysis and chat responses.
  - **Document Analysis**: A two-phase approach extracts structured entities from tax documents (e.g., employers, 1099 payers, Schedule C/E/K-1, Form 1098, personal info) and programmatically generates specific document requests. It uses OpenAI's Files API and Responses API for content-based PDF analysis and automatically cleans up files after analysis.
  - **Entity Accumulation**: Merges entities across multiple uploads to prevent data loss and dedupes based on relevant identifiers.
  - **Intelligent Document Matching**: Uses pattern-based reconciliation with filename variants and entity name matching to link uploaded documents to requested ones.
  - **Chat Response Generation**: AI provides helpful responses and can create actual document entities based on chat conversations (e.g., "W-2 from Microsoft for 2023").
- **Data Model**:
    - **Customers**: id, name, email, status, createdAt
    - **Documents**: id, customerId, name, documentType, year, entity, status, filePath, createdAt
      - Structured fields enable precise AI matching and visual display with pills/badges
      - Entity field stores company/organization name (e.g., "Microsoft", "Stripe Inc")
    - **Chat Messages**: id, customerId, sender, content, createdAt
    - **Customer Details**: id, customerId, category, label, value, createdAt

### Feature Specifications
- **Customer Management**: CRUD operations for customers.
- **AI-Powered Document Analysis**: Intelligent feedback on uploaded tax documents.
- **Smart Chat Interface**: AI agent requests missing documents and validates completeness.
- **Structured Workflow**: A three-phase gated workflow:
    1. **Awaiting Tax Return**: Initial state, chat disabled, first upload must be a validated 2023 Form 1040.
    2. **Incomplete**: Chat enabled, document collection phase, AI analyzes documents and creates requests.
    3. **Ready**: All requested documents collected, ready for tax preparation.
- **Automatic Status Tracking**: Customer status updates based on workflow progression.
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

### Entity Field Implementation
- Added structured entity field to documents for storing company/organization names
- Entity field properly persisted across create, update, and edit operations
- UI displays entity as visual pill/badge when present
- Form state syncs correctly when editing documents (useEffect-based synchronization)
- Entity can be added, updated, or cleared (set to null) through edit dialog

### Bug Fixes
- **Routing Consistency**: Changed customer detail route from `/customer/:id` to `/customers/:id` to match API convention
- **Entity Persistence**: Fixed critical bug where entity field was collected in UI but not persisted to database
- **Entity Pre-population**: Fixed bug where editing a document did not pre-populate entity field, causing silent data loss
- **Entity Clearing**: Fixed payload construction to explicitly send null when entity is cleared, ensuring badge removal
- **Upload Error Handling**: Upload endpoint now returns 400 when AI analysis fails instead of 200, preventing invalid document creation

## External Dependencies
- **OpenAI API**: Utilized for AI-powered document analysis (GPT-5) and chat response generation.
- **Multer**: Node.js middleware for handling `multipart/form-data`, primarily for file uploads.