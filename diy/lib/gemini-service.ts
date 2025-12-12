/**
 * Server-side Gemini Service
 * Uses current google-genai SDK patterns
 * 
 * NOTE: This file should only be imported in server components or API routes
 */

// Simulating the google-genai SDK structure based on current patterns
// In production, use: import { GoogleGenAI } from '@google/genai';

interface GenAIClient {
    models: {
        generateContent: (params: GenerateContentParams) => Promise<GenerateContentResponse>;
        generateContentStream: (params: GenerateContentParams) => AsyncIterable<GenerateContentChunk>;
        embedContent: (params: EmbedContentParams) => Promise<EmbedContentResponse>;
    };
    files: {
        upload: (params: FileUploadParams) => Promise<UploadedFile>;
        get: (params: { name: string }) => Promise<UploadedFile>;
        delete: (params: { name: string }) => Promise<void>;
    };
    caches: {
        create: (params: CacheCreateParams) => Promise<CachedContent>;
        get: (params: { name: string }) => Promise<CachedContent>;
    };
    chats: {
        create: (params: ChatCreateParams) => Chat;
    };
}

interface GenerateContentParams {
    model: string;
    contents: ContentItem[];
    config?: GenerateContentConfig;
}

interface ContentItem {
    role: 'user' | 'model';
    parts: Part[];
}

interface Part {
    text?: string;
    inlineData?: { data: string; mimeType: string };
    fileData?: { fileUri: string; mimeType?: string };
}

interface GenerateContentConfig {
    systemInstruction?: string;
    temperature?: number;
    maxOutputTokens?: number;
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
    tools?: Tool[];
    thinkingConfig?: { thinkingBudget: number };
    cachedContent?: string;
}

interface Tool {
    googleSearch?: Record<string, unknown>;
    functionDeclarations?: FunctionDeclaration[];
}

interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, { type: string; description: string }>;
        required: string[];
    };
}

interface GenerateContentResponse {
    text: string;
    candidates: Candidate[];
    usageMetadata: UsageMetadata;
}

interface Candidate {
    content: ContentItem;
    groundingMetadata?: GroundingMetadata;
    finishReason: string;
}

interface GroundingMetadata {
    webSearchQueries?: string[];
    groundingChunks?: GroundingChunk[];
}

interface GroundingChunk {
    web?: { title: string; uri: string };
}

interface UsageMetadata {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
}

interface GenerateContentChunk {
    text: string;
}

interface EmbedContentParams {
    model: string;
    contents: string | string[];
    config?: { outputDimensionality?: number };
}

interface EmbedContentResponse {
    embeddings: { values: number[] }[];
}

interface FileUploadParams {
    file: Buffer | string;
    config?: { mimeType?: string; displayName?: string };
}

interface UploadedFile {
    name: string;
    uri: string;
    mimeType: string;
    state: 'PROCESSING' | 'ACTIVE' | 'FAILED';
    sizeBytes: string;
}

interface CacheCreateParams {
    model: string;
    config: {
        contents: ContentItem[];
        systemInstruction?: string;
        displayName?: string;
        ttl: string;
    };
}

interface CachedContent {
    name: string;
    model: string;
    createTime: string;
    updateTime: string;
    expireTime: string;
}

interface ChatCreateParams {
    model: string;
    config?: GenerateContentConfig;
    history?: ContentItem[];
}

interface Chat {
    sendMessage: (message: string | Part[]) => Promise<GenerateContentResponse>;
    sendMessageStream: (message: string | Part[]) => AsyncIterable<GenerateContentChunk>;
    getHistory: () => ContentItem[];
}

// Create client instance
function createClient(): GenAIClient {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is required');
    }

    // In production, this would be:
    // return new GoogleGenAI({ apiKey });

    // For now, we'll create a mock structure that matches the SDK
    // Replace with actual SDK import in production
    throw new Error('Replace with actual google-genai SDK implementation');
}

// Singleton client
let client: GenAIClient | null = null;

export function getGeminiClient(): GenAIClient {
    if (!client) {
        client = createClient();
    }
    return client;
}

/**
 * Generate content with text prompt
 */
export async function generateText(
    prompt: string,
    options: {
        model?: string;
        systemInstruction?: string;
        temperature?: number;
        maxOutputTokens?: number;
        thinkingBudget?: number;
    } = {}
): Promise<string> {
    const client = getGeminiClient();

    const config: GenerateContentConfig = {};
    if (options.systemInstruction) config.systemInstruction = options.systemInstruction;
    if (options.temperature !== undefined) config.temperature = options.temperature;
    if (options.maxOutputTokens) config.maxOutputTokens = options.maxOutputTokens;
    if (options.thinkingBudget !== undefined) {
        config.thinkingConfig = { thinkingBudget: options.thinkingBudget };
    }

    const response = await client.models.generateContent({
        model: options.model || 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: Object.keys(config).length > 0 ? config : undefined
    });

    return response.text;
}

/**
 * Generate content with structured output (JSON schema)
 */
export async function generateStructured<T>(
    prompt: string,
    schema: Record<string, unknown>,
    options: {
        model?: string;
        systemInstruction?: string;
    } = {}
): Promise<T> {
    const client = getGeminiClient();

    const response = await client.models.generateContent({
        model: options.model || 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
            systemInstruction: options.systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: schema
        }
    });

    return JSON.parse(response.text) as T;
}

/**
 * Generate content with image input
 */
export async function analyzeImage(
    imageData: string | Buffer,
    mimeType: string,
    prompt: string,
    options: {
        model?: string;
        systemInstruction?: string;
    } = {}
): Promise<string> {
    const client = getGeminiClient();

    const base64Data = Buffer.isBuffer(imageData)
        ? imageData.toString('base64')
        : imageData;

    const response = await client.models.generateContent({
        model: options.model || 'gemini-2.5-flash',
        contents: [{
            role: 'user',
            parts: [
                { inlineData: { data: base64Data, mimeType } },
                { text: prompt }
            ]
        }],
        config: options.systemInstruction ? { systemInstruction: options.systemInstruction } : undefined
    });

    return response.text;
}

/**
 * Upload file to Gemini Files API (for files > 20MB)
 */
export async function uploadFile(
    fileData: Buffer | string,
    mimeType: string,
    displayName?: string
): Promise<UploadedFile> {
    const client = getGeminiClient();

    const uploaded = await client.files.upload({
        file: fileData,
        config: { mimeType, displayName }
    });

    // Wait for file to be processed
    let file = uploaded;
    while (file.state === 'PROCESSING') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        file = await client.files.get({ name: file.name });
    }

    if (file.state === 'FAILED') {
        throw new Error('File processing failed');
    }

    return file;
}

/**
 * Analyze video using Files API
 */
export async function analyzeVideo(
    videoFile: Buffer | string,
    mimeType: string,
    prompt: string,
    options: {
        model?: string;
        systemInstruction?: string;
    } = {}
): Promise<string> {
    const client = getGeminiClient();

    // Upload video first
    const uploaded = await uploadFile(videoFile, mimeType);

    const response = await client.models.generateContent({
        model: options.model || 'gemini-2.5-flash',
        contents: [{
            role: 'user',
            parts: [
                { fileData: { fileUri: uploaded.uri } },
                { text: prompt }
            ]
        }],
        config: options.systemInstruction ? { systemInstruction: options.systemInstruction } : undefined
    });

    // Clean up uploaded file
    await client.files.delete({ name: uploaded.name });

    return response.text;
}

/**
 * Analyze audio using native audio models
 */
export async function analyzeAudio(
    audioData: string | Buffer,
    mimeType: string,
    prompt: string,
    options: {
        model?: string;
        systemInstruction?: string;
        transcribe?: boolean;
    } = {}
): Promise<{ text: string; transcription?: string }> {
    const client = getGeminiClient();

    const base64Data = Buffer.isBuffer(audioData)
        ? audioData.toString('base64')
        : audioData;

    // For audio analysis, gemini-2.5-flash has native audio understanding
    const response = await client.models.generateContent({
        model: options.model || 'gemini-2.5-flash',
        contents: [{
            role: 'user',
            parts: [
                { inlineData: { data: base64Data, mimeType } },
                { text: prompt }
            ]
        }],
        config: options.systemInstruction ? { systemInstruction: options.systemInstruction } : undefined
    });

    return { text: response.text };
}

/**
 * Generate embeddings for text
 */
export async function generateEmbeddings(
    texts: string | string[],
    options: {
        model?: string;
        outputDimensionality?: number;
    } = {}
): Promise<number[][]> {
    const client = getGeminiClient();

    const response = await client.models.embedContent({
        model: options.model || 'text-embedding-004',
        contents: texts,
        config: options.outputDimensionality
            ? { outputDimensionality: options.outputDimensionality }
            : undefined
    });

    return response.embeddings.map(e => e.values);
}

/**
 * Create a chat session
 */
export function createChatSession(
    options: {
        model?: string;
        systemInstruction?: string;
        history?: ContentItem[];
    } = {}
): Chat {
    const client = getGeminiClient();

    return client.chats.create({
        model: options.model || 'gemini-2.5-flash',
        config: options.systemInstruction ? { systemInstruction: options.systemInstruction } : undefined,
        history: options.history
    });
}

/**
 * Create context cache for repeated queries
 */
export async function createContextCache(
    contents: ContentItem[],
    options: {
        model?: string;
        systemInstruction?: string;
        displayName?: string;
        ttlSeconds?: number;
    } = {}
): Promise<CachedContent> {
    const client = getGeminiClient();

    return client.caches.create({
        model: options.model || 'gemini-2.5-flash',
        config: {
            contents,
            systemInstruction: options.systemInstruction,
            displayName: options.displayName,
            ttl: `${options.ttlSeconds || 3600}s`
        }
    });
}

/**
 * Generate with Google Search grounding
 */
export async function generateWithGrounding(
    prompt: string,
    options: {
        model?: string;
        systemInstruction?: string;
    } = {}
): Promise<{ text: string; sources: { title: string; uri: string }[] }> {
    const client = getGeminiClient();

    const response = await client.models.generateContent({
        model: options.model || 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
            systemInstruction: options.systemInstruction,
            tools: [{ googleSearch: {} }]
        }
    });

    const sources = response.candidates[0]?.groundingMetadata?.groundingChunks
        ?.filter(chunk => chunk.web)
        .map(chunk => ({
            title: chunk.web!.title,
            uri: chunk.web!.uri
        })) || [];

    return { text: response.text, sources };
}

/**
 * Stream content generation
 */
export async function* streamContent(
    prompt: string,
    options: {
        model?: string;
        systemInstruction?: string;
        thinkingBudget?: number;
    } = {}
): AsyncIterable<string> {
    const client = getGeminiClient();

    const config: GenerateContentConfig = {};
    if (options.systemInstruction) config.systemInstruction = options.systemInstruction;
    if (options.thinkingBudget !== undefined) {
        config.thinkingConfig = { thinkingBudget: options.thinkingBudget };
    }

    const stream = client.models.generateContentStream({
        model: options.model || 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: Object.keys(config).length > 0 ? config : undefined
    });

    for await (const chunk of stream) {
        yield chunk.text;
    }
}

// Export types for consumers
export type {
    GenAIClient,
    GenerateContentParams,
    GenerateContentConfig,
    GenerateContentResponse,
    ContentItem,
    Part,
    UploadedFile,
    CachedContent,
    Chat
};