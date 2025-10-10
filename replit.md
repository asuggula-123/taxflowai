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

## Recent Changes (Latest Session)
- Built complete data schema for customers, documents, messages, and details
- Implemented in-memory storage with full CRUD operations
- Created backend API routes with validation
- Integrated OpenAI GPT-5 for document analysis and intelligent chat
- Built file upload system with AI-powered document validation
- Connected frontend to backend APIs
- Implemented automatic status tracking based on document completeness

## Known Limitations
- In-memory storage (data persists only during runtime)
- AI analysis based on filename patterns (no actual file content parsing for MVP)
- No multi-user authentication (single accountant use)

## Future Enhancements
- PostgreSQL database for persistent storage
- Multi-user support with authentication
- Actual PDF parsing for document content analysis
- Email notifications for status changes
- Document version history
- Export finalized tax packages
