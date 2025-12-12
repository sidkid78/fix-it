/**
 * Diagnosis Service
 * Combines multimodal inputs (audio, video, text) for technical diagnosis
 * Uses structured output for consistent results
 */

// Pydantic-style schema for TypeScript
interface DiagnosisSchema {
    confidence: number;
    primaryDiagnosis: string;
    symptoms: string[];
    possibleCauses: string[];
    severity: 'low' | 'medium' | 'high' | 'critical';
    recommendedActions: RecommendedAction[];
    additionalNotes?: string;
    requiresExpertReview: boolean;
}

interface RecommendedAction {
    priority: number;
    action: string;
    estimatedTime?: string;
    difficulty: 'easy' | 'moderate' | 'difficult' | 'expert-only';
    safetyWarnings?: string[];
}

interface DiagnosisInput {
    textDescription?: string;
    audioData?: {
        base64: string;
        mimeType: string;
    };
    videoData?: {
        base64?: string;
        fileUri?: string;
        mimeType: string;
    };
    imageData?: {
        base64: string;
        mimeType: string;
    }[];
    context?: {
        equipmentType?: string;
        equipmentModel?: string;
        previousIssues?: string[];
        operatingConditions?: string;
    };
}

interface DiagnosisResult {
    diagnosis: DiagnosisSchema;
    rawResponse?: string;
    processingTime: number;
    inputsUsed: string[];
}

// JSON Schema for Gemini structured output
const DIAGNOSIS_JSON_SCHEMA = {
    type: 'OBJECT',
    properties: {
        confidence: {
            type: 'NUMBER',
            description: 'Confidence level from 0 to 1'
        },
        primaryDiagnosis: {
            type: 'STRING',
            description: 'Main diagnosis or issue identified'
        },
        symptoms: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'List of observed symptoms'
        },
        possibleCauses: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Potential root causes'
        },
        severity: {
            type: 'STRING',
            enum: ['low', 'medium', 'high', 'critical'],
            description: 'Severity level of the issue'
        },
        recommendedActions: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    priority: { type: 'INTEGER' },
                    action: { type: 'STRING' },
                    estimatedTime: { type: 'STRING' },
                    difficulty: {
                        type: 'STRING',
                        enum: ['easy', 'moderate', 'difficult', 'expert-only']
                    },
                    safetyWarnings: {
                        type: 'ARRAY',
                        items: { type: 'STRING' }
                    }
                },
                required: ['priority', 'action', 'difficulty']
            }
        },
        additionalNotes: {
            type: 'STRING',
            description: 'Any additional observations or notes'
        },
        requiresExpertReview: {
            type: 'BOOLEAN',
            description: 'Whether expert review is recommended'
        }
    },
    required: [
        'confidence',
        'primaryDiagnosis',
        'symptoms',
        'possibleCauses',
        'severity',
        'recommendedActions',
        'requiresExpertReview'
    ]
};

/**
 * Diagnosis Service Class
 */
export class DiagnosisService {
    private apiKey: string;
    private baseUrl = 'https://generativelanguage.googleapis.com';
    private model: string;

    constructor(apiKey: string, model = 'gemini-2.5-flash') {
        this.apiKey = apiKey;
        this.model = model;
    }

    /**
     * Perform diagnosis with multimodal inputs
     */
    async diagnose(input: DiagnosisInput): Promise<DiagnosisResult> {
        const startTime = Date.now();
        const inputsUsed: string[] = [];

        // Build content parts
        const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string }; fileData?: { fileUri: string; mimeType?: string } }> = [];

        // Add text description
        if (input.textDescription) {
            inputsUsed.push('text');
        }

        // Add audio
        if (input.audioData) {
            parts.push({
                inlineData: {
                    data: input.audioData.base64,
                    mimeType: input.audioData.mimeType
                }
            });
            inputsUsed.push('audio');
        }

        // Add video
        if (input.videoData) {
            if (input.videoData.fileUri) {
                parts.push({
                    fileData: {
                        fileUri: input.videoData.fileUri,
                        mimeType: input.videoData.mimeType
                    }
                });
            } else if (input.videoData.base64) {
                parts.push({
                    inlineData: {
                        data: input.videoData.base64,
                        mimeType: input.videoData.mimeType
                    }
                });
            }
            inputsUsed.push('video');
        }

        // Add images
        if (input.imageData && input.imageData.length > 0) {
            for (const img of input.imageData) {
                parts.push({
                    inlineData: {
                        data: img.base64,
                        mimeType: img.mimeType
                    }
                });
            }
            inputsUsed.push('images');
        }

        // Build the diagnosis prompt
        const prompt = this.buildDiagnosisPrompt(input);
        parts.push({ text: prompt });

        // Build system instruction
        const systemInstruction = this.buildSystemInstruction(input.context);

        // Call Gemini API with structured output
        const response = await fetch(
            `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: DIAGNOSIS_JSON_SCHEMA
                    },
                    systemInstruction: {
                        parts: [{ text: systemInstruction }]
                    }
                })
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Diagnosis failed: ${error}`);
        }

        const data = await response.json();
        const rawResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawResponse) {
            throw new Error('No response from model');
        }

        // Parse the JSON response
        const diagnosis: DiagnosisSchema = JSON.parse(rawResponse);

        return {
            diagnosis,
            rawResponse,
            processingTime: Date.now() - startTime,
            inputsUsed
        };
    }

    /**
     * Build the diagnosis prompt
     */
    private buildDiagnosisPrompt(input: DiagnosisInput): string {
        let prompt = 'Please analyze the provided inputs and generate a comprehensive diagnosis.\n\n';

        if (input.textDescription) {
            prompt += `User Description:\n${input.textDescription}\n\n`;
        }

        if (input.audioData) {
            prompt += 'Audio Input: Analyze any sounds, noises, or audio patterns that might indicate issues.\n\n';
        }

        if (input.videoData) {
            prompt += 'Video Input: Analyze visual elements, movements, behaviors, or visible damage/wear.\n\n';
        }

        if (input.imageData && input.imageData.length > 0) {
            prompt += `Image Inputs (${input.imageData.length}): Analyze visible conditions, damage, wear patterns, or abnormalities.\n\n`;
        }

        if (input.context) {
            prompt += 'Additional Context:\n';
            if (input.context.equipmentType) {
                prompt += `- Equipment Type: ${input.context.equipmentType}\n`;
            }
            if (input.context.equipmentModel) {
                prompt += `- Model: ${input.context.equipmentModel}\n`;
            }
            if (input.context.previousIssues?.length) {
                prompt += `- Previous Issues: ${input.context.previousIssues.join(', ')}\n`;
            }
            if (input.context.operatingConditions) {
                prompt += `- Operating Conditions: ${input.context.operatingConditions}\n`;
            }
        }

        prompt += '\nProvide a detailed diagnosis with recommended actions, considering all available inputs.';

        return prompt;
    }

    /**
     * Build system instruction for diagnosis
     */
    private buildSystemInstruction(context?: DiagnosisInput['context']): string {
        let instruction = `You are an expert diagnostic system. Your role is to analyze multimodal inputs (text descriptions, audio recordings, video footage, and images) to identify issues and provide actionable recommendations.

Guidelines:
1. Analyze all provided inputs thoroughly
2. Cross-reference symptoms across different input types
3. Provide confidence levels based on evidence quality
4. Prioritize safety in recommendations
5. Flag cases that require expert human review
6. Consider the operational context when making assessments

Output Format:
- Provide structured JSON output following the schema
- Include specific, actionable recommendations
- Note any safety concerns prominently
- Indicate confidence level honestly`;

        if (context?.equipmentType) {
            instruction += `\n\nSpecialization: ${context.equipmentType}`;
            instruction += '\nApply domain-specific knowledge for this equipment type.';
        }

        return instruction;
    }

    /**
     * Perform diagnosis with RAG enhancement
     * Retrieves relevant documentation to enhance diagnosis
     */
    async diagnoseWithRAG(
        input: DiagnosisInput,
        ragQuery: string,
        fileSearchStoreIds: string[]
    ): Promise<DiagnosisResult & { ragSources: string[] }> {
        const startTime = Date.now();
        const inputsUsed: string[] = [];

        // Build content parts
        const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string }; fileData?: { fileUri: string; mimeType?: string } }> = [];

        // Add media inputs
        if (input.audioData) {
            parts.push({
                inlineData: {
                    data: input.audioData.base64,
                    mimeType: input.audioData.mimeType
                }
            });
            inputsUsed.push('audio');
        }

        if (input.videoData?.fileUri) {
            parts.push({
                fileData: {
                    fileUri: input.videoData.fileUri,
                    mimeType: input.videoData.mimeType
                }
            });
            inputsUsed.push('video');
        }

        if (input.imageData) {
            for (const img of input.imageData) {
                parts.push({
                    inlineData: {
                        data: img.base64,
                        mimeType: img.mimeType
                    }
                });
            }
            inputsUsed.push('images');
        }

        if (input.textDescription) {
            inputsUsed.push('text');
        }

        const prompt = this.buildDiagnosisPrompt(input);
        parts.push({ text: prompt });

        // Call with File Search tool for RAG
        const response = await fetch(
            `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts }],
                    tools: [{
                        fileSearch: {
                            fileSearchStoreNames: fileSearchStoreIds
                        }
                    }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: DIAGNOSIS_JSON_SCHEMA
                    },
                    systemInstruction: {
                        parts: [{ text: this.buildSystemInstruction(input.context) + '\n\nUse the retrieved documentation to enhance your diagnosis with specific technical details and procedures.' }]
                    }
                })
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Diagnosis with RAG failed: ${error}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const rawResponse = candidate?.content?.parts?.[0]?.text;

        // Extract RAG sources
        const ragSources = candidate?.groundingMetadata?.groundingChunks
            ?.map((chunk: { retrievedContext?: { uri: string } }) => chunk.retrievedContext?.uri)
            .filter(Boolean) || [];

        if (!rawResponse) {
            throw new Error('No response from model');
        }

        const diagnosis: DiagnosisSchema = JSON.parse(rawResponse);

        return {
            diagnosis,
            rawResponse,
            processingTime: Date.now() - startTime,
            inputsUsed,
            ragSources
        };
    }

    /**
     * Stream diagnosis for real-time feedback
     */
    async *streamDiagnosis(input: DiagnosisInput): AsyncGenerator<string> {
        const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];

        if (input.audioData) {
            parts.push({
                inlineData: {
                    data: input.audioData.base64,
                    mimeType: input.audioData.mimeType
                }
            });
        }

        if (input.imageData) {
            for (const img of input.imageData) {
                parts.push({
                    inlineData: {
                        data: img.base64,
                        mimeType: img.mimeType
                    }
                });
            }
        }

        const prompt = this.buildDiagnosisPrompt(input);
        parts.push({ text: prompt });

        // Note: Streaming doesn't support structured output
        // This returns natural language that should be parsed
        const response = await fetch(
            `${this.baseUrl}/v1beta/models/${this.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts }],
                    systemInstruction: {
                        parts: [{ text: this.buildSystemInstruction(input.context) }]
                    }
                })
            }
        );

        if (!response.ok) {
            throw new Error('Streaming diagnosis failed');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text) yield text;
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }
        }
    }
}

// Factory function
export function createDiagnosisService(apiKey?: string, model?: string): DiagnosisService {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY required');
    return new DiagnosisService(key, model);
}

// Export types
export type { DiagnosisSchema, DiagnosisInput, DiagnosisResult, RecommendedAction };