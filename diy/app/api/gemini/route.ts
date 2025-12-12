/**
 * Gemini API Route - Supports text, image, audio, and video inputs
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Initialize the client 
const genai = new GoogleGenAI({});

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ContentPart {
    type: 'text' | 'image' | 'audio' | 'video';
    data?: string; // Base64 data
    mimeType?: string;
    text?: string;
    fileUrl?: string; // For pre-uploaded files 
}

interface GeminiRequest {
    contents: ContentPart[];
    systemInstruction?: string;
    responseSchema?: Record<string, unknown>;
    useStructuredOutput?: boolean;
    thinkingBudget?: number;
    useGrounding?: boolean;
}

export async function POST(request: NextRequest) {
    try {
        const body: GeminiRequest = await request.json();
        const {
            contents,
            systemInstruction,
            responseSchema,
            useStructuredOutput = false,
            thinkingBudget,
            useGrounding = false
        } = body;

        // Build content parts for the API 
        const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } } | { fileData: { fileUri: string; mimeType: string } }> = [];

        for (const content of contents) {
            switch (content.type) {
                case 'text':
                    if (content.text) {
                        parts.push({ text: content.text });
                    }
                    break;
                case 'image':
                case 'audio':
                case 'video':
                    if (content.fileUrl && content.mimeType) {
                        // Use file URI for pre-uploaded files 
                        parts.push({
                            fileData: {
                                fileUri: content.fileUrl,
                                mimeType: content.mimeType
                            }
                        });
                    } else if (content.data && content.mimeType) {
                        // Use inline data for smaller files
                        parts.push({
                            inlineData: {
                                data: content.data,
                                mimeType: content.mimeType
                            }
                        });
                    }
                    break;
            }
        }

        // Build config 
        const config: Record<string, unknown> = {};

        if (systemInstruction) {
            config.systemInstruction = systemInstruction;
        }

        // Thinking budget (Gemini-2.5-flash)
        if (thinkingBudget !== undefined) {
            config.thinkingConfig = {
                thinkingBudget: thinkingBudget
            };
        }

        // Structured output
        if (useStructuredOutput && responseSchema) {
            config.responseMimeType = 'application/json';
            config.responseSchema = responseSchema;
        }

        if (useGrounding) {
            config.tools = [{ googleSearch: {} }];
        }

        const response = await genai.models.generateContent({
            model: 'gemiini-2.5-flash',
            contents: [{ role: 'user', parts }],
            config: Object.keys(config).length > 0 ? config : undefined
        });

        // Extract response 
        const result = {
            text: response.text,
            candidates: response.candidates,
            usageMetadata: response.usageMetadata,
            // Include grounding metadata if available
            groundingMetadata: response.candidates?.[0]?.groundingMetadata
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('Gemini API error:', error);

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorCode = (error as { code?: number })?.code || 500;

        return NextResponse.json(
            { error: errorMessage },
            { status: errorCode }
        );
    }
};


