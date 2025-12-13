/**
 * RAG (Retrieval Augmented Generation) Service
 * Uses Gemini embeddings and File Search tool for document retrieval
 * 
 * This provides two approaches:
 * 1. File Search Tool (recommended) - Automatic chunking, embedding, and indexing
 * 2. Custom Vector Store - Manual embeddings with external vector DB
 */

// Types
interface Document {
    id: string;
    content: string;
    metadata?: Record<string, string | number | boolean>;
}

interface ChunkedDocument {
    id: string;
    documentId: string;
    content: string;
    embedding?: number[];
    metadata?: Record<string, string | number | boolean>;
}

interface SearchResult {
    document: ChunkedDocument;
    score: number;
}

interface FileSearchStore {
    id: string;
    name: string;
    documentCount: number;
    state: 'PROCESSING' | 'ACTIVE' | 'FAILED';
}

interface RAGConfig {
    chunkSize?: number;
    chunkOverlap?: number;
    embeddingModel?: string;
    embeddingDimensions?: number;
    topK?: number;
    minScore?: number;
}

const DEFAULT_CONFIG: Required<RAGConfig> = {
    chunkSize: 1000,
    chunkOverlap: 200,
    embeddingModel: 'text-embedding-004',
    embeddingDimensions: 768,
    topK: 5,
    minScore: 0.5
};

/**
 * RAG Service Class
 * Manages document indexing and retrieval
 */
export class RAGService {
    private config: Required<RAGConfig>;
    private apiKey: string;
    private baseUrl = 'https://generativelanguage.googleapis.com';

    constructor(apiKey: string, config: RAGConfig = {}) {
        this.apiKey = apiKey;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ============================================================
    // FILE SEARCH TOOL APPROACH (Recommended for simplicity)
    // ============================================================

    /**
     * Create a File Search store for RAG
     */
    async createFileSearchStore(name: string): Promise<FileSearchStore> {
        const response = await fetch(
            `${this.baseUrl}/v1beta/fileSearchStores?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    displayName: name
                })
            }
        );

        if (!response.ok) {
            throw new Error('Failed to create File Search store');
        }

        const data = await response.json();
        return {
            id: data.name,
            name: data.displayName,
            documentCount: 0,
            state: data.state
        };
    }

    /**
     * Upload document to File Search store
     */
    async uploadToFileSearchStore(
        storeId: string,
        content: string | Buffer,
        mimeType: string,
        displayName: string
    ): Promise<string> {
        // First upload the file
        const fileResponse = await this.uploadFile(content, mimeType, displayName);

        // Then import to the store
        const importResponse = await fetch(
            `${this.baseUrl}/v1beta/${storeId}:importFile?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file: fileResponse.name
                })
            }
        );

        if (!importResponse.ok) {
            throw new Error('Failed to import file to store');
        }

        return fileResponse.name;
    }

    /**
     * Query with File Search tool
     * This is the simplest RAG approach - Gemini handles retrieval automatically
     */
    async queryWithFileSearch(
        query: string,
        storeIds: string[],
        options: {
            model?: string;
            systemInstruction?: string;
        } = {}
    ): Promise<{ answer: string; sources: string[] }> {
        const response = await fetch(
            `${this.baseUrl}/v1beta/models/${options.model || 'gemini-2.5-flash'}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: query }] }],
                    tools: [{
                        fileSearch: {
                            fileSearchStoreNames: storeIds
                        }
                    }],
                    systemInstruction: options.systemInstruction ? {
                        parts: [{ text: options.systemInstruction }]
                    } : undefined
                })
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Query failed: ${error}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];

        // Extract sources from grounding metadata
        const sources = candidate?.groundingMetadata?.groundingChunks?.map(
            (chunk: { retrievedContext?: { uri: string } }) => chunk.retrievedContext?.uri
        ).filter(Boolean) || [];

        return {
            answer: candidate?.content?.parts?.[0]?.text || '',
            sources
        };
    }

    // ============================================================
    // CUSTOM VECTOR STORE APPROACH (More control)
    // ============================================================

    /**
     * Generate embeddings for text
     */
    async generateEmbeddings(texts: string | string[]): Promise<number[][]> {
        const textArray = Array.isArray(texts) ? texts : [texts];

        // Use batchEmbedContents for multiple texts
        const response = await fetch(
            `${this.baseUrl}/v1beta/models/${this.config.embeddingModel}:batchEmbedContents?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requests: textArray.map(text => ({
                        model: `models/${this.config.embeddingModel}`,
                        content: { parts: [{ text }] },
                        taskType: 'RETRIEVAL_DOCUMENT',
                        outputDimensionality: this.config.embeddingDimensions
                    }))
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[RAG] Embedding error:', errorText);
            throw new Error(`Failed to generate embeddings: ${response.status}`);
        }

        const data = await response.json();

        // batchEmbedContents returns { embeddings: [{ values: [...] }, ...] }
        if (!data.embeddings || !Array.isArray(data.embeddings)) {
            console.error('[RAG] Unexpected embedding response:', JSON.stringify(data).slice(0, 500));
            throw new Error('Unexpected embedding response format');
        }

        return data.embeddings.map((e: { values: number[] }) => e.values);
    }

    /**
     * Generate query embedding (optimized for retrieval)
     */
    async generateQueryEmbedding(query: string): Promise<number[]> {
        const response = await fetch(
            `${this.baseUrl}/v1beta/models/${this.config.embeddingModel}:embedContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: `models/${this.config.embeddingModel}`,
                    content: { parts: [{ text: query }] },
                    taskType: 'RETRIEVAL_QUERY',
                    outputDimensionality: this.config.embeddingDimensions
                })
            }
        );

        if (!response.ok) {
            throw new Error('Failed to generate query embedding');
        }

        const data = await response.json();
        return data.embedding.values;
    }

    /**
     * Chunk document into smaller pieces
     */
    chunkDocument(document: Document): ChunkedDocument[] {
        const chunks: ChunkedDocument[] = [];
        const content = document.content;
        const chunkSize = this.config.chunkSize;
        const overlap = this.config.chunkOverlap;

        let start = 0;
        let chunkIndex = 0;

        while (start < content.length) {
            // Find a good break point (end of sentence or paragraph)
            let end = Math.min(start + chunkSize, content.length);

            if (end < content.length) {
                // Try to find a sentence boundary
                const sentenceEnd = content.lastIndexOf('.', end);
                if (sentenceEnd > start + chunkSize / 2) {
                    end = sentenceEnd + 1;
                } else {
                    // Try paragraph
                    const paragraphEnd = content.lastIndexOf('\n\n', end);
                    if (paragraphEnd > start + chunkSize / 2) {
                        end = paragraphEnd + 2;
                    }
                }
            }

            chunks.push({
                id: `${document.id}_chunk_${chunkIndex}`,
                documentId: document.id,
                content: content.slice(start, end).trim(),
                metadata: {
                    ...document.metadata,
                    chunkIndex,
                    startChar: start,
                    endChar: end
                }
            });

            start = end - overlap;
            chunkIndex++;
        }

        return chunks;
    }

    /**
     * Process documents: chunk and generate embeddings
     */
    async processDocuments(documents: Document[]): Promise<ChunkedDocument[]> {
        const allChunks: ChunkedDocument[] = [];

        for (const doc of documents) {
            const chunks = this.chunkDocument(doc);

            // Generate embeddings in batches
            const batchSize = 100;
            for (let i = 0; i < chunks.length; i += batchSize) {
                const batch = chunks.slice(i, i + batchSize);
                const contents = batch.map(c => c.content);
                const embeddings = await this.generateEmbeddings(contents);

                batch.forEach((chunk, idx) => {
                    chunk.embedding = embeddings[idx];
                });
            }

            allChunks.push(...chunks);
        }

        return allChunks;
    }

    /**
     * Compute cosine similarity between two vectors
     */
    cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            throw new Error('Vectors must have same length');
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Search chunks by embedding similarity (in-memory)
     * For production, use a vector database like Pinecone, Supabase pgvector, etc.
     */
    searchChunks(
        queryEmbedding: number[],
        chunks: ChunkedDocument[]
    ): SearchResult[] {
        const results: SearchResult[] = [];

        for (const chunk of chunks) {
            if (!chunk.embedding) continue;

            const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);

            if (score >= this.config.minScore) {
                results.push({ document: chunk, score });
            }
        }

        // Sort by score descending and take top K
        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, this.config.topK);
    }

    /**
     * Full RAG query with custom vector store
     */
    async queryWithCustomRAG(
        query: string,
        chunks: ChunkedDocument[],
        options: {
            model?: string;
            systemInstruction?: string;
        } = {}
    ): Promise<{ answer: string; sources: SearchResult[] }> {
        // Generate query embedding
        const queryEmbedding = await this.generateQueryEmbedding(query);

        // Search for relevant chunks
        const results = this.searchChunks(queryEmbedding, chunks);

        if (results.length === 0) {
            return {
                answer: 'No relevant information found in the documents.',
                sources: []
            };
        }

        // Build context from retrieved chunks
        const context = results
            .map((r, i) => `[Source ${i + 1}]\n${r.document.content}`)
            .join('\n\n');

        // Generate answer with context
        const response = await fetch(
            `${this.baseUrl}/v1beta/models/${options.model || 'gemini-2.5-flash'}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [{
                            text: `Context:\n${context}\n\nQuestion: ${query}\n\nAnswer based on the context provided. If the context doesn't contain enough information, say so.`
                        }]
                    }],
                    systemInstruction: options.systemInstruction ? {
                        parts: [{ text: options.systemInstruction }]
                    } : undefined
                })
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Query failed: ${error}`);
        }

        const data = await response.json();

        return {
            answer: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
            sources: results
        };
    }

    // ============================================================
    // UTILITY METHODS
    // ============================================================

    /**
     * Upload file to Gemini Files API
     */
    private async uploadFile(
        content: string | Buffer,
        mimeType: string,
        displayName: string
    ): Promise<{ name: string; uri: string }> {
        const buffer = typeof content === 'string' ? Buffer.from(content) : content;

        // Initiate upload
        const initResponse = await fetch(
            `${this.baseUrl}/upload/v1beta/files?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: {
                    'X-Goog-Upload-Protocol': 'resumable',
                    'X-Goog-Upload-Command': 'start',
                    'X-Goog-Upload-Header-Content-Length': buffer.length.toString(),
                    'X-Goog-Upload-Header-Content-Type': mimeType,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ file: { displayName } })
            }
        );

        const uploadUrl = initResponse.headers.get('X-Goog-Upload-URL');
        if (!uploadUrl) throw new Error('No upload URL received');

        // Upload data
        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Length': buffer.length.toString(),
                'X-Goog-Upload-Offset': '0',
                'X-Goog-Upload-Command': 'upload, finalize'
            },
            body: new Uint8Array(buffer)
        });

        const data = await uploadResponse.json();

        // Wait for processing
        let file = data.file;
        while (file.state === 'PROCESSING') {
            await new Promise(r => setTimeout(r, 1000));
            const statusResponse = await fetch(
                `${this.baseUrl}/v1beta/${file.name}?key=${this.apiKey}`
            );
            file = await statusResponse.json();
        }

        return { name: file.name, uri: file.uri };
    }

    /**
     * Delete a File Search store
     */
    async deleteFileSearchStore(storeId: string): Promise<void> {
        const response = await fetch(
            `${this.baseUrl}/v1beta/${storeId}?key=${this.apiKey}`,
            { method: 'DELETE' }
        );

        if (!response.ok && response.status !== 404) {
            throw new Error('Failed to delete store');
        }
    }
}

// Export singleton factory
let ragServiceInstance: RAGService | null = null;

export function getRAGService(apiKey?: string, config?: RAGConfig): RAGService {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
        throw new Error('GEMINI_API_KEY required');
    }

    if (!ragServiceInstance) {
        ragServiceInstance = new RAGService(key, config);
    }

    return ragServiceInstance;
}

// Export types
export type { Document, ChunkedDocument, SearchResult, FileSearchStore, RAGConfig };