# TaxFlow - Tax Document Intake Application

## Overview
TaxFlow is an AI-powered professional tax document intake application designed for accountants. Its primary purpose is to streamline the management of customer tax returns by leveraging AI for document analysis, guiding accountants through the collection process, and automatically tracking completion status. The application features real-time streaming chat responses with parallel memory detection, delivering a ChatGPT-like user experience with sub-second memory badge appearance. This aims to significantly enhance efficiency and accuracy in tax preparation workflows.

## User Preferences
I prefer iterative development, with a focus on delivering core features first and then refining them. I value clear, concise communication and prefer that you ask before making major architectural changes or introducing new external dependencies.

## System Architecture

### UI/UX Decisions
The frontend uses React with TypeScript, styled with Tailwind CSS and Shadcn UI components for a modern and consistent look. The application features a multi-year intake system with customer summary and intake-specific views. Status badges provide clear visual cues for each tax year intake.

### Technical Implementations
- **Frontend**: React, TypeScript, Wouter for routing, TanStack Query for server state management, SSE event handler with pendingMemories buffer.
- **Backend**: Express with TypeScript, utilizing Multer for robust file uploads, Server-Sent Events for streaming responses.
- **AI Integration**: Leverages OpenAI GPT-4o for streaming chat responses and GPT-4o-mini for parallel memory detection (~500ms). Uses OpenAI's Files API for content-based PDF analysis and `json_schema` structured outputs for guaranteed schema compliance.
- **Data Model**: Core entities include Customers, Tax Year Intakes, Documents, Chat Messages, Customer Details, Firm Settings, and Memories. The system supports multi-year intakes, with documents and chat linked to specific tax year intakes.
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
- **AI-Powered Document Analysis**: Intelligent feedback on uploaded tax documents, including validation and information extraction from PDF content.
- **Smart Chat Interface**: AI agent requests missing documents, validates completeness, and can create document entities from chat conversations.
- **Structured Workflow**: A three-phase gated workflow per intake (Awaiting Tax Return, Incomplete, Ready) with automatic status tracking.
- **Memory System**: A hybrid memory approach with individual Memory entities for audit trail and synthesized notes for clean AI context. Supports firm-level and customer-level memories, with inline confirmation UI. Context-aware memory detection distinguishes firm-wide policies from customer-specific facts - when accountants use "we/our/firm" language to state policies, only firm memories are created (not redundant customer memories). "Remember" button triggers full synthesis workflow with immediate toast feedback.
- **Entity Field Implementation**: Structured entity field for documents to store company/organization names, displayed as visual pills/badges.

### System Design Choices
- **In-memory storage (MemStorage)** for current MVP, with future plans for PostgreSQL.
- Server-side enforcement of workflow gates.
- Robust duplicate prevention for documents.
- Optimized UI for immediate user feedback (optimistic chat, upload progress, AI thinking indicators).
- Comprehensive error handling with clear messages.
- Precise cache management for chat messages to avoid unintended removals.

## External Dependencies
- **OpenAI API**: Utilized for AI-powered document analysis (GPT-5) and chat response generation.
- **Multer**: Node.js middleware for handling `multipart/form-data`, primarily for file uploads.