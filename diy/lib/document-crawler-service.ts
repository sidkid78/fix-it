/**
 * Document Crawler & Ingestion Service
 * 
 * Just-in-time document pipeline:
 * 1. Search for relevant URLs based on equipment/diagnosis
 * 2. ACTUALLY CRAWL and extract content from those pages (via fetch)
 * 3. Use Gemini to extract clean content from HTML
 * 4. Chunk and embed into vector store
 * 5. Ready for RAG queries
 * 
 * This runs in the background while the user provides equipment details.
 */

import { RAGService } from './rag-service';

// HTML to text extraction (lightweight, no cheerio dependency)
function extractTextFromHtml(html: string): string {
    // Remove scripts, styles, and other non-content elements
    let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')  // Remove all remaining HTML tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')  // Collapse whitespace
        .trim();

    return text;
}

// ============================================================
// TYPES
// ============================================================

export interface CrawlTarget {
    url: string;
    title: string;
    snippet: string;
    source: string;
    relevanceScore: number;
}

export interface CrawledDocument {
    url: string;
    title: string;
    content: string;
    contentType: 'article' | 'manual' | 'forum' | 'video_transcript' | 'parts_catalog';
    extractedAt: string;
    metadata: {
        source: string;
        wordCount: number;
        hasImages: boolean;
        hasPartNumbers: boolean;
        hasTorqueSpecs: boolean;
    };
}

export interface DocumentChunk {
    id: string;
    documentUrl: string;
    content: string;
    chunkIndex: number;
    embedding?: number[];
    metadata: {
        title: string;
        source: string;
        section?: string;
    };
}

export interface IngestionResult {
    success: boolean;
    documentsFound: number;
    documentsCrawled: number;
    chunksCreated: number;
    storeId?: string;
    errors: string[];
    processingTime: number;
}

export interface EquipmentQuery {
    type: string;
    make?: string;
    model?: string;
    year?: string;
    symptom?: string;
    diagnosis?: string;
}

// ============================================================
// CONFIGURATION
// ============================================================

const TRUSTED_SOURCES = {
    vehicles: [
        { domain: 'repairpal.com', weight: 0.9, type: 'article' },
        { domain: 'yourmechanic.com', weight: 0.85, type: 'article' },
        { domain: 'carcomplaints.com', weight: 0.8, type: 'forum' },
        { domain: 'autoblog.com', weight: 0.75, type: 'article' },
        { domain: 'nhtsa.gov', weight: 0.95, type: 'manual' },  // TSBs and recalls
        { domain: '2carpros.com', weight: 0.7, type: 'forum' },
        { domain: 'justanswer.com', weight: 0.6, type: 'forum' },
        { domain: 'fixya.com', weight: 0.6, type: 'forum' },
    ],
    appliances: [
        { domain: 'repairclinic.com', weight: 0.95, type: 'manual' },
        { domain: 'partselect.com', weight: 0.9, type: 'manual' },
        { domain: 'applianceassistant.com', weight: 0.85, type: 'article' },
        { domain: 'fixya.com', weight: 0.7, type: 'forum' },
        { domain: 'appliancepartspros.com', weight: 0.85, type: 'parts_catalog' },
    ],
    hvac: [
        { domain: 'hvac-talk.com', weight: 0.8, type: 'forum' },
        { domain: 'achrn.com', weight: 0.85, type: 'article' },
        { domain: 'grainger.com', weight: 0.75, type: 'parts_catalog' },
        { domain: 'supplyhouse.com', weight: 0.8, type: 'parts_catalog' },
    ],
    general: [
        { domain: 'ifixit.com', weight: 0.95, type: 'manual' },
        { domain: 'familyhandyman.com', weight: 0.85, type: 'article' },
        { domain: 'thisoldhouse.com', weight: 0.8, type: 'article' },
        { domain: 'homedepot.com', weight: 0.7, type: 'article' },
        { domain: 'lowes.com', weight: 0.7, type: 'article' },
    ]
};

// Search query templates for different equipment types
const SEARCH_TEMPLATES = {
    vehicles: [
        '{year} {make} {model} {symptom} repair guide',
        '{make} {model} {diagnosis} how to fix',
        '{year} {make} {model} service manual {diagnosis}',
        '{make} {model} TSB {symptom}',
        '{make} {model} common problems {symptom}',
    ],
    appliances: [
        '{make} {model} {symptom} repair',
        '{make} {model} troubleshooting guide',
        '{make} {model} service manual PDF',
        '{make} {model} error codes {symptom}',
        'how to fix {make} {model} {diagnosis}',
    ],
    hvac: [
        '{make} {model} {symptom} troubleshooting',
        '{type} {symptom} repair guide',
        '{make} furnace error codes',
        'HVAC {diagnosis} fix DIY',
    ],
    general: [
        '{type} {symptom} repair guide',
        'how to fix {type} {diagnosis}',
        '{make} {model} troubleshooting',
        'DIY {type} repair {symptom}',
    ]
};

// ============================================================
// MAIN SERVICE CLASS
// ============================================================

export class DocumentCrawlerService {
    private apiKey: string;
    private baseUrl = 'https://generativelanguage.googleapis.com';
    private model = 'gemini-2.5-flash';
    private ragService: RAGService;

    // In-memory document store (replace with vector DB in production)
    private documentStore: Map<string, DocumentChunk[]> = new Map();
    private crawlCache: Map<string, CrawledDocument> = new Map();

    constructor(apiKey: string) {
        this.apiKey = apiKey;
        this.ragService = new RAGService(apiKey);
    }

    /**
     * Main entry point - crawl and ingest documents for equipment
     */
    async ingestForEquipment(query: EquipmentQuery): Promise<IngestionResult> {
        const startTime = Date.now();
        const errors: string[] = [];

        console.log(`[Crawler] Starting ingestion for: ${query.make} ${query.model}`);

        try {
            // Step 1: Generate search queries
            const searchQueries = this.generateSearchQueries(query);
            console.log(`[Crawler] Generated ${searchQueries.length} search queries`);

            // Step 2: Find relevant URLs via Google Search
            const targets = await this.findRelevantUrls(searchQueries, query.type);
            console.log(`[Crawler] Found ${targets.length} potential documents`);

            if (targets.length === 0) {
                return {
                    success: false,
                    documentsFound: 0,
                    documentsCrawled: 0,
                    chunksCreated: 0,
                    errors: ['No relevant documents found'],
                    processingTime: Date.now() - startTime
                };
            }

            // Step 3: Crawl and extract content (parallel with limit)
            const crawledDocs: CrawledDocument[] = [];
            const crawlPromises = targets.slice(0, 10).map(async (target) => {
                try {
                    const doc = await this.crawlUrl(target);
                    if (doc) crawledDocs.push(doc);
                } catch (err) {
                    errors.push(`Failed to crawl ${target.url}: ${err}`);
                }
            });

            await Promise.all(crawlPromises);
            console.log(`[Crawler] Successfully crawled ${crawledDocs.length} documents`);

            // Step 4: Chunk documents
            const allChunks: DocumentChunk[] = [];
            for (const doc of crawledDocs) {
                const chunks = this.chunkDocument(doc);
                allChunks.push(...chunks);
            }
            console.log(`[Crawler] Created ${allChunks.length} chunks`);

            // Step 5: Generate embeddings and store
            const storeId = this.generateStoreId(query);
            await this.embedAndStore(allChunks, storeId);

            return {
                success: true,
                documentsFound: targets.length,
                documentsCrawled: crawledDocs.length,
                chunksCreated: allChunks.length,
                storeId,
                errors,
                processingTime: Date.now() - startTime
            };

        } catch (error) {
            console.error('[Crawler] Ingestion failed:', error);
            return {
                success: false,
                documentsFound: 0,
                documentsCrawled: 0,
                chunksCreated: 0,
                errors: [error instanceof Error ? error.message : 'Unknown error'],
                processingTime: Date.now() - startTime
            };
        }
    }

    /**
     * Generate search queries from equipment info
     */
    private generateSearchQueries(query: EquipmentQuery): string[] {
        const templates = SEARCH_TEMPLATES[query.type as keyof typeof SEARCH_TEMPLATES]
            || SEARCH_TEMPLATES.general;

        const queries: string[] = [];

        for (const template of templates) {
            let q = template
                .replace('{type}', query.type || '')
                .replace('{make}', query.make || '')
                .replace('{model}', query.model || '')
                .replace('{year}', query.year || '')
                .replace('{symptom}', query.symptom || '')
                .replace('{diagnosis}', query.diagnosis || '')
                .replace(/\s+/g, ' ')
                .trim();

            if (q.length > 10) {
                queries.push(q);
            }
        }

        return [...new Set(queries)]; // Dedupe
    }

    /**
     * Find relevant URLs using Google Search
     */
    private async findRelevantUrls(
        queries: string[],
        equipmentType: string
    ): Promise<CrawlTarget[]> {
        const allTargets: CrawlTarget[] = [];
        const seenUrls = new Set<string>();

        // Process queries in parallel (limit to 3 concurrent)
        const batchSize = 3;
        for (let i = 0; i < queries.length; i += batchSize) {
            const batch = queries.slice(i, i + batchSize);
            const results = await Promise.all(
                batch.map(q => this.searchForUrls(q))
            );

            for (const targets of results) {
                for (const target of targets) {
                    if (!seenUrls.has(target.url)) {
                        seenUrls.add(target.url);
                        // Boost score based on trusted sources
                        target.relevanceScore = this.adjustScoreBySource(
                            target,
                            equipmentType
                        );
                        allTargets.push(target);
                    }
                }
            }
        }

        // Sort by relevance and return top results
        return allTargets
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, 15);
    }

    /**
     * Search Google and extract URLs from grounding metadata
     */
    private async searchForUrls(query: string): Promise<CrawlTarget[]> {
        try {
            const response = await fetch(
                `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            role: 'user',
                            parts: [{ text: `Find repair guides and technical documentation for: ${query}` }]
                        }],
                        tools: [{ googleSearch: {} }],
                        generationConfig: {
                            maxOutputTokens: 500, // We mainly want the grounding metadata
                        }
                    })
                }
            );

            if (!response.ok) {
                console.warn(`[Crawler] Search API error for "${query}"`);
                return [];
            }

            const data = await response.json();

            // Extract URLs from grounding metadata
            const groundingMetadata = data.candidates?.[0]?.groundingMetadata;
            const groundingChunks = groundingMetadata?.groundingChunks || [];
            const searchQueries = groundingMetadata?.webSearchQueries || [];

            console.log(`[Crawler] Search "${query}" found ${groundingChunks.length} grounding chunks`);

            const targets: CrawlTarget[] = [];

            for (const chunk of groundingChunks) {
                if (chunk.web?.uri) {
                    try {
                        const url = new URL(chunk.web.uri);
                        targets.push({
                            url: chunk.web.uri,
                            title: chunk.web.title || '',
                            snippet: '', // Grounding chunks don't always have snippets
                            source: url.hostname,
                            relevanceScore: 0.5
                        });
                    } catch {
                        // Invalid URL, skip
                    }
                }
            }

            // Also check grounding supports for additional URLs
            const groundingSupports = groundingMetadata?.groundingSupports || [];
            for (const support of groundingSupports) {
                const indices = support.groundingChunkIndices || [];
                // These reference the same chunks, but we could use confidence scores
                if (support.confidenceScores) {
                    for (let i = 0; i < indices.length; i++) {
                        const idx = indices[i];
                        if (targets[idx]) {
                            targets[idx].relevanceScore = Math.max(
                                targets[idx].relevanceScore,
                                support.confidenceScores[i] || 0.5
                            );
                        }
                    }
                }
            }

            return targets;

        } catch (error) {
            console.warn(`[Crawler] Search failed for "${query}":`, error);
            return [];
        }
    }

    /**
     * Alternative: Use Google Custom Search API if available
     * This would require a separate API key and CSE ID
     */
    private async searchWithCustomSearchAPI(query: string): Promise<CrawlTarget[]> {
        const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
        const CSE_ID = process.env.GOOGLE_CSE_ID;

        if (!CSE_API_KEY || !CSE_ID) {
            return []; // Fall back to Gemini grounding
        }

        try {
            const params = new URLSearchParams({
                key: CSE_API_KEY,
                cx: CSE_ID,
                q: query,
                num: '10'
            });

            const response = await fetch(
                `https://www.googleapis.com/customsearch/v1?${params}`
            );

            if (!response.ok) return [];

            const data = await response.json();

            return (data.items || []).map((item: any) => ({
                url: item.link,
                title: item.title,
                snippet: item.snippet || '',
                source: new URL(item.link).hostname,
                relevanceScore: 0.7
            }));

        } catch {
            return [];
        }
    }

    /**
     * Adjust relevance score based on trusted sources
     */
    private adjustScoreBySource(target: CrawlTarget, equipmentType: string): number {
        const sources = [
            ...(TRUSTED_SOURCES[equipmentType as keyof typeof TRUSTED_SOURCES] || []),
            ...TRUSTED_SOURCES.general
        ];

        const source = sources.find(s => target.source.includes(s.domain));
        if (source) {
            return target.relevanceScore * source.weight + 0.3;
        }

        // Penalize unknown sources slightly
        return target.relevanceScore * 0.7;
    }

    /**
     * Crawl a URL and extract content - ACTUALLY FETCHES THE PAGE
     */
    private async crawlUrl(target: CrawlTarget): Promise<CrawledDocument | null> {
        // Check cache
        if (this.crawlCache.has(target.url)) {
            return this.crawlCache.get(target.url)!;
        }

        try {
            console.log(`[Crawler] Fetching: ${target.url}`);

            // Step 1: Actually fetch the web page
            const response = await fetch(target.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; RepairBot/1.0; +https://example.com/bot)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                },
                signal: AbortSignal.timeout(10000), // 10 second timeout
            });

            if (!response.ok) {
                console.warn(`[Crawler] HTTP ${response.status} for ${target.url}`);
                return null;
            }

            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
                console.warn(`[Crawler] Non-HTML content: ${contentType}`);
                return null;
            }

            const html = await response.text();

            if (html.length < 500) {
                console.warn(`[Crawler] Page too short: ${target.url}`);
                return null;
            }

            // Step 2: Extract text from HTML
            const rawText = extractTextFromHtml(html);

            if (rawText.length < 200) {
                console.warn(`[Crawler] Insufficient content after extraction: ${target.url}`);
                return null;
            }

            // Step 3: Use Gemini to clean and extract relevant repair content
            const cleanedContent = await this.cleanContentWithGemini(rawText, target.title);

            if (!cleanedContent || cleanedContent.length < 100) {
                // Fallback to raw extracted text if Gemini fails
                console.warn(`[Crawler] Using raw text for ${target.url}`);
            }

            const content = cleanedContent || rawText.slice(0, 15000); // Limit raw text

            // Determine content type
            const docContentType = this.classifyContent(target.source, content);

            // Check for technical content markers
            const hasPartNumbers = /\b[A-Z]{2,}\d{4,}\b|\b\d{5,}-[A-Z\d]+\b/.test(content);
            const hasTorqueSpecs = /\b\d+\s*(ft-lb|nm|lb-ft|newton|torque)\b/i.test(content);

            const doc: CrawledDocument = {
                url: target.url,
                title: target.title || this.extractTitle(html),
                content,
                contentType: docContentType,
                extractedAt: new Date().toISOString(),
                metadata: {
                    source: target.source,
                    wordCount: content.split(/\s+/).length,
                    hasImages: /<img\s/i.test(html),
                    hasPartNumbers,
                    hasTorqueSpecs
                }
            };

            this.crawlCache.set(target.url, doc);
            return doc;

        } catch (error) {
            if (error instanceof Error && error.name === 'TimeoutError') {
                console.warn(`[Crawler] Timeout fetching ${target.url}`);
            } else {
                console.error(`[Crawler] Error crawling ${target.url}:`, error);
            }
            return null;
        }
    }

    /**
     * Extract title from HTML
     */
    private extractTitle(html: string): string {
        const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        return match ? match[1].trim() : 'Untitled';
    }

    /**
     * Use Gemini to clean extracted text and focus on repair-relevant content
     */
    private async cleanContentWithGemini(rawText: string, title: string): Promise<string | null> {
        try {
            // Truncate input to avoid token limits
            const truncatedText = rawText.slice(0, 30000);

            const response = await fetch(
                `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            role: 'user',
                            parts: [{
                                text: `Extract and organize the repair/troubleshooting content from this text.
                
TITLE: ${title}

RAW CONTENT:
${truncatedText}

INSTRUCTIONS:
1. Extract ONLY repair-relevant content (instructions, troubleshooting steps, technical specs)
2. Remove ads, navigation, unrelated content, cookie notices, etc.
3. Preserve step-by-step instructions with numbering
4. Keep part numbers, measurements, torque specs, tool requirements
5. Keep safety warnings
6. Format cleanly with sections if applicable
7. If this isn't repair-related content, return "NOT_RELEVANT"

EXTRACTED CONTENT:`
                            }]
                        }],
                        generationConfig: {
                            maxOutputTokens: 8000,
                            temperature: 0.1, // Low temperature for extraction
                        }
                    })
                }
            );

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            if (content.includes('NOT_RELEVANT')) {
                return null;
            }

            return content;

        } catch (error) {
            console.warn('[Crawler] Gemini cleaning failed:', error);
            return null;
        }
    }

    /**
     * Classify content type based on source and content
     */
    private classifyContent(
        source: string,
        content: string
    ): CrawledDocument['contentType'] {
        if (source.includes('ifixit') || source.includes('repairclinic')) {
            return 'manual';
        }
        if (source.includes('forum') || source.includes('talk') || content.includes('posted by')) {
            return 'forum';
        }
        if (source.includes('parts') || source.includes('catalog')) {
            return 'parts_catalog';
        }
        if (content.includes('transcript') || source.includes('youtube')) {
            return 'video_transcript';
        }
        return 'article';
    }

    /**
     * Chunk a document for embedding
     */
    private chunkDocument(doc: CrawledDocument): DocumentChunk[] {
        const chunks: DocumentChunk[] = [];
        const chunkSize = 1000; // characters
        const overlap = 200;

        // Split by paragraphs first, then by size
        const paragraphs = doc.content.split(/\n\n+/);
        let currentChunk = '';
        let chunkIndex = 0;

        for (const para of paragraphs) {
            if (currentChunk.length + para.length > chunkSize && currentChunk.length > 0) {
                // Save current chunk
                chunks.push({
                    id: `${this.hashString(doc.url)}-${chunkIndex}`,
                    documentUrl: doc.url,
                    content: currentChunk.trim(),
                    chunkIndex,
                    metadata: {
                        title: doc.title,
                        source: doc.metadata.source,
                    }
                });

                // Start new chunk with overlap
                const words = currentChunk.split(/\s+/);
                const overlapWords = words.slice(-Math.floor(overlap / 5));
                currentChunk = overlapWords.join(' ') + '\n\n' + para;
                chunkIndex++;
            } else {
                currentChunk += (currentChunk ? '\n\n' : '') + para;
            }
        }

        // Don't forget the last chunk
        if (currentChunk.trim().length > 50) {
            chunks.push({
                id: `${this.hashString(doc.url)}-${chunkIndex}`,
                documentUrl: doc.url,
                content: currentChunk.trim(),
                chunkIndex,
                metadata: {
                    title: doc.title,
                    source: doc.metadata.source,
                }
            });
        }

        return chunks;
    }

    /**
     * Generate embeddings and store chunks
     */
    private async embedAndStore(chunks: DocumentChunk[], storeId: string): Promise<void> {
        console.log(`[Crawler] Embedding ${chunks.length} chunks for store: ${storeId}`);

        // Process in batches to avoid rate limits
        const batchSize = 10;
        const embeddedChunks: DocumentChunk[] = [];

        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);

            // Get embeddings for batch
            const embeddings = await this.ragService.generateEmbeddings(
                batch.map(c => c.content)
            );

            for (let j = 0; j < batch.length; j++) {
                embeddedChunks.push({
                    ...batch[j],
                    embedding: embeddings[j]
                });
            }

            // Small delay to avoid rate limits
            if (i + batchSize < chunks.length) {
                await new Promise(r => setTimeout(r, 100));
            }
        }

        // Store in memory (replace with vector DB in production)
        this.documentStore.set(storeId, embeddedChunks);
        console.log(`[Crawler] Stored ${embeddedChunks.length} embedded chunks`);
    }

    /**
     * Query the document store
     */
    async queryDocuments(
        storeId: string,
        query: string,
        topK: number = 5
    ): Promise<{ content: string; source: string; score: number }[]> {
        const chunks = this.documentStore.get(storeId);
        if (!chunks || chunks.length === 0) {
            console.warn(`[Crawler] No documents found for store: ${storeId}`);
            return [];
        }

        // Generate query embedding
        const [queryEmbedding] = await this.ragService.generateEmbeddings([query]);

        // Calculate similarity scores
        const scored = chunks.map(chunk => ({
            chunk,
            score: this.cosineSimilarity(queryEmbedding, chunk.embedding || [])
        }));

        // Sort by score and return top K
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, topK)
            .map(({ chunk, score }) => ({
                content: chunk.content,
                source: chunk.documentUrl,
                score
            }));
    }

    /**
     * Get all stored context as a single string
     */
    async getContextForDiagnosis(storeId: string, diagnosis: string): Promise<string> {
        const results = await this.queryDocuments(storeId, diagnosis, 10);

        if (results.length === 0) {
            return '';
        }

        const contextParts = results.map((r, i) =>
            `[Source ${i + 1}: ${r.source}]\n${r.content}`
        );

        return `TECHNICAL DOCUMENTATION:\n\n${contextParts.join('\n\n---\n\n')}`;
    }

    /**
     * Check if documents exist for a store
     */
    hasDocuments(storeId: string): boolean {
        const chunks = this.documentStore.get(storeId);
        return chunks !== undefined && chunks.length > 0;
    }

    /**
     * Generate a store ID from equipment query
     */
    generateStoreId(query: EquipmentQuery): string {
        const parts = [
            query.type,
            query.make,
            query.model,
            query.year
        ].filter(Boolean).join('-').toLowerCase().replace(/\s+/g, '-');

        return `equipment-${parts}-${Date.now()}`;
    }

    /**
     * Cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length || a.length === 0) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }

    /**
     * Simple string hash for chunk IDs
     */
    private hashString(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }
}

// Factory function
export function createDocumentCrawler(apiKey?: string): DocumentCrawlerService {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY required');
    return new DocumentCrawlerService(key);
}

