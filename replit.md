# TaxFlow - Tax Document Intake Application

## Overview
TaxFlow is an AI-powered professional tax document intake application designed for accountants. Its primary purpose is to streamline the management of customer tax returns by leveraging AI for document analysis, guiding accountants through the collection process, and automatically tracking completion status. The application features real-time streaming chat responses with parallel memory detection, delivering a ChatGPT-like user experience with sub-second memory badge appearance. This aims to significantly enhance efficiency and accuracy in tax preparation workflows.

## User Preferences
I prefer iterative development, with a focus on delivering core features first and then refining them. I value clear, concise communication and prefer that you ask before making major architectural changes or introducing new external dependencies.

## System Architecture

### UI/UX Decisions
The frontend uses React with TypeScript, styled with Tailwind CSS and Shadcn UI components for a modern and consistent look. The application features a multi-year intake system with customer summary and intake-specific views. Status badges provide clear visual cues for each tax year intake.

### Technical Implementations
- **Frontend**: React, TypeScript, Wouter for UUID-based routing (/customers/:id/intakes/:intakeId), TanStack Query for server state management, SSE event handler with pendingMemories buffer.
- **Backend**: Express with TypeScript, utilizing Multer for robust file uploads with local file storage (uploads/{customerId}/{intakeId}/), Server-Sent Events for streaming responses.
- **AI Integration**: Leverages OpenAI GPT-4o for streaming chat responses and GPT-4o-mini for parallel memory detection (~500ms). Uses OpenAI's Files API for content-based PDF analysis (file_id stored for reference only, files served from local disk), `json_schema` structured outputs for guaranteed schema compliance.
- **Data Model**: Core entities include Customers, Tax Year Intakes (UUID-based, supports multiple per year), Documents (with local filePath and openaiFileId), Chat Messages, Customer Details, Firm Settings, and Memories. The system supports multi-year intakes with UUID identifiers, enabling multiple intakes per year (e.g., personal + business).
- **Streaming Architecture**: Server-Sent Events (SSE) enable real-time streaming with context-aware memory detection:
  - GPT-4o streams chat response chunks progressively via SSE events
  - Frontend uses local React state for immediate chunk-by-chunk visual updates (ChatGPT-like experience)
  - Each chunk triggers re-render via `setStreamingMessage` state update, ensuring smooth incremental text display
  - GPT-4o-mini analyzes full conversation (accountant question + AI answer) for context-aware memory detection (~500ms)
  - Memories filtered for relevance to accountant's specific question, ignoring incidental background context
  - Memory badges appear after streaming completes to ensure accuracy
  - Precise cache management using temp ID refs prevents unintended message removal
- **Structured Outputs**: AI responses use `json_schema` for guaranteed compliance, ensuring strict output formats for `message`, `requestedDocuments`, and `detectedMemories` arrays.

### Feature Specifications
- **Customer Management**: CRUD operations for customers.
- **Multi-Year Intake System**: Each customer can have multiple tax year intakes, with independent documents, chat, and status per year. Includes a year selection dropdown and dynamic Form 1040 validation.
- **AI-Powered Document Analysis**: Intelligent feedback on uploaded tax documents, including validation and information extraction from PDF content. Two-tier AI approach: GPT-4o-mini for quick metadata extraction (~500ms) for matching/naming, GPT-5 for deep entity analysis.
- **Smart Document Naming**: Documents automatically renamed using pattern `Entity_DocumentType_Year` (e.g., "JamesCavin_Form1040_2023"). Entity extraction varies by document type: taxpayer name for Form 1040s, employer name for W-2s, payer name for 1099s, business name for Schedule C, etc. Falls back to `DocumentType_Year` if no entity applicable.
- **Smart Chat Interface**: AI agent requests missing documents, validates completeness, and can create document entities from chat conversations.
- **Structured Workflow**: A three-phase gated workflow per intake (Awaiting Tax Return, Incomplete, Ready) with automatic status tracking.
- **Memory System**: A hybrid memory approach with individual Memory entities for audit trail and synthesized notes for clean AI context. Supports firm-level and customer-level memories, with inline confirmation UI. Context-aware memory detection distinguishes firm-wide policies from customer-specific facts - when accountants use "we/our/firm" language to state policies, only firm memories are created (not redundant customer memories). "Remember" button triggers full synthesis workflow with immediate toast feedback.
- **Entity Field Implementation**: Structured entity field for documents to store company/organization names, displayed as visual pills/badges.
- **Safe Value Rendering**: Customer details safely handle structured data (objects, arrays) from AI extraction. Values like `{Salary: 51484.88, Commission: 0}` are formatted as readable text ("Salary: $51,484.88") to prevent React rendering crashes.

### System Design Choices
- **In-memory storage (MemStorage)** for current MVP, with future plans for PostgreSQL.
- Server-side enforcement of workflow gates.
- Robust duplicate prevention for documents (SHA-256 hash matching or metadata matching).
- Optimized UI for immediate user feedback (optimistic chat, upload progress, AI thinking indicators).
- Comprehensive error handling with clear messages.
- Precise cache management for chat messages to avoid unintended removals.
- **Local file persistence**: PDFs stored in uploads/{customerId}/{intakeId}/ directory structure (Multer temp → permanent move pattern), served via res.sendFile(), cleaned up with fs.unlink() on deletion.

## External Dependencies
- **OpenAI API**: Utilized for AI-powered document analysis (GPT-5) and chat response generation.
- **Multer**: Node.js middleware for handling `multipart/form-data`, primarily for file uploads.