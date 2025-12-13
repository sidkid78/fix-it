## Project Overview

**Listen & Fix DIY Assistant** - "Shazam for Engines & Appliances"

An AI-powered DIY repair assistant that analyzes audio/video/images of broken equipment, diagnoses issues using multimodal AI, retrieves technical documentation via RAG, and generates custom step-by-step repair guides with local parts availability.

Technology stack: Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Google Gemini API

## Development Commands

```bash
# Development
npm run dev          # Start dev server at http://localhost:3000

# Production
npm run build        # Build for production
npm start            # Start production server

# Code Quality
npm run lint         # Run ESLint
npm run type-check   # Run TypeScript type checking
```

## Environment Setup

Required environment variable in `.env.local`:

- `GEMINI_API_KEY` - Google Gemini API key for all AI operations

The app uses Gemini 2.5 Flash model for multimodal analysis, structured output, and RAG.

## Architecture Overview

### Service Layer Architecture

The application follows a multi-service architecture with specialized services:

1. **DiagnosticService** (`lib/diagnostic-service.ts`)
   - Multimodal diagnosis using audio/video/images
   - Returns structured JSON output with confidence scores
   - Supports RAG-enhanced diagnosis via File Search tool

2. **RAGService** (`lib/rag-service.ts`)
   - Two approaches: File Search Tool (recommended) and Custom Vector Store
   - Uses Gemini text-embedding-004 for embeddings (768 dimensions)
   - Handles document chunking (1000 chars, 200 overlap), embedding, and retrieval
   - File Search stores for automatic chunking and indexing

3. **ListenFixService** (`lib/listen-fix-service.ts`)
   - Orchestrates the full pipeline: diagnosis → RAG → repair guide → parts search
   - Manages File Search stores per equipment type
   - Generates repair guides with structured output (steps, parts, tools, warnings)
   - Finds parts availability using Google Search grounding

4. **DocumentCrawlerService** (`lib/document-crawler-service.ts`)
   - Crawls and ingests technical documentation
   - Creates File Search stores for equipment-specific manuals
   - Background ingestion during analysis

5. **GeminiService** (`lib/gemini-service.ts`)
   - **NOTE:** Currently contains TypeScript interfaces only - NOT actual implementation
   - Defines SDK structure for future @google/genai integration
   - **DO NOT** attempt to use exported functions - they will throw errors
   - Services make direct fetch() calls to Gemini API instead

### API Routes

All Gemini integration happens server-side via Next.js API routes:

- `/api/gemini/listen-and-fix` - Main analysis endpoint
  - Accepts media (audio/video/images), equipment details, user preferences
  - Orchestrates: crawling → diagnosis → RAG → guide generation → parts search
  - Returns complete repair guide with sources

- `/api/gemini/route` - General Gemini endpoint (if needed)
- `/api/gemini/upload` - File upload endpoint for large media

### Frontend Architecture

- **Single Page App** with multi-step wizard flow:
  1. Capture: Record audio/video or upload images
  2. Details: Equipment info and user preferences
  3. Analyzing: Processing state with progress indicators
  4. Results: Interactive repair guide with tabs (Steps/Parts/Tools)

- **ListenFixAssistant** (`components/ListenFixAssistant.tsx`)
  - Main UI component with MediaRecorder API integration
  - Handles audio (webm/opus), video (webm/vp9), and image uploads
  - Converts media to base64 for API transmission
  - Manages state for the full user journey

### Key Data Flow

```
User Media Input → Base64 Encoding → API Route → Diagnosis Service → RAG Service → Repair Guide Generation → Parts Search → UI Display
```

1. Frontend captures/uploads media, converts to base64
2. API route receives media + metadata
3. Background: DocumentCrawler ingests technical docs
4. DiagnosticService analyzes media with structured output
5. RAGService retrieves relevant technical context
6. ListenFixService generates repair guide
7. Parts search finds local/online availability
8. Complete guide returned to frontend

## Important Implementation Notes

### Working with Gemini API

All services use direct `fetch()` calls to Gemini API endpoints:

- Base URL: `https://generativelanguage.googleapis.com`
- Default model: `gemini-2.5-flash`
- Always use `v1beta` API version for latest features
- Structured output requires `responseMimeType: 'application/json'` and `responseSchema`

### Structured Output Pattern

Services extensively use JSON schemas for consistent output:

```typescript
generationConfig: {
  responseMimeType: 'application/json',
  responseSchema: {
    type: 'OBJECT',
    properties: { /* ... */ }
  }
}
```

### Multimodal Input Pattern

Build content parts array with mixed media:

```typescript
parts: [
  { inlineData: { data: base64Audio, mimeType: 'audio/webm' } },
  { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
  { text: 'Analyze this...' }
]
```

### RAG Implementation

- File Search Tool is recommended over custom vector store
- File Search handles chunking, embedding, and indexing automatically
- Query with `fileSearch` tool in request: `tools: [{ fileSearch: { fileSearchStoreNames: [...] } }]`
- Retrieve sources from `groundingMetadata.groundingChunks`

### Equipment Types

The system supports:

- `vehicle` (cars, trucks, motorcycles)
- `appliance` (refrigerators, washers, dryers)
- `hvac` (furnaces, AC, heat pumps)
- `plumbing` (toilets, faucets, water heaters)
- `electrical` (outlets, switches, fixtures)
- `other` (lawn equipment, power tools)

Each type has specific disclaimers and default parts sources.

## File Organization

```
diy/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Home page with ListenFixAssistant
│   ├── layout.tsx                # Root layout
│   └── api/gemini/               # API routes
│       ├── listen-and-fix/route.ts  # Main analysis endpoint
│       ├── route.ts              # General Gemini endpoint
│       └── upload/route.ts       # File upload
├── components/
│   ├── ListenFixAssistant.tsx    # Main UI component
│   ├── AudioProcessor.tsx        # Audio processing utilities
│   └── VideoProcessor.tsx        # Video processing utilities
├── lib/                          # Service layer
│   ├── diagnostic-service.ts     # Multimodal diagnosis
│   ├── rag-service.ts            # RAG and embeddings
│   ├── listen-fix-service.ts     # Main orchestration service
│   ├── document-crawler-service.ts # Document ingestion
│   ├── gemini-service.ts         # SDK interfaces (not implemented)
│   └── utils.ts                  # Utility functions
└── next.config.ts                # Next.js config (media permissions)
```

## Testing Considerations

When testing multimodal features:

- Audio should be webm format with opus codec
- Video should be webm format with vp9 codec
- Images can be any common format (jpeg, png, webp)
- Use `MediaRecorder` API for capturing in browser
- Test with actual media files - mock data won't capture real issues

## Common Patterns

### Creating a New Service

1. Define TypeScript interfaces for inputs/outputs
2. Create JSON schemas for structured outputs
3. Implement service class with Gemini fetch() calls
4. Export factory function that checks for API key
5. Add error handling with descriptive messages

### Adding New Equipment Types

1. Add type to EquipmentInfo union in relevant files
2. Update EQUIPMENT_CATEGORIES in ListenFixAssistant
3. Add type-specific disclaimers in getDisclaimers()
4. Add default parts sources in getDefaultSources()

### Extending RAG Capabilities

- File Search stores are per-equipment-type
- Register stores via `ListenFixService.registerManualStore()`
- Upload manuals via `ListenFixService.uploadManual()`
- Stores persist across requests (managed by Gemini API)
