/**
 * Listen & Fix DIY Assistant Service
 * 
 * "Shazam for Engines/Appliances" - Diagnose issues from audio/video,
 * retrieve technical manuals via RAG, and generate custom repair guides
 * with local parts availability.
 */

import { DiagnosisService, DiagnosisSchema, DiagnosisInput } from './diagnostic-service';
import { RAGService, SearchResult, FileSearchStore } from './rag-service';

// ============================================================
// TYPES
// ============================================================

export interface ListenFixInput {
    // Media inputs (at least one required)
    audio?: {
        base64: string;
        mimeType: string;
    };
    video?: {
        base64?: string;
        fileUri?: string;
        mimeType: string;
    };
    images?: {
        base64: string;
        mimeType: string;
    }[];

    // User context
    description?: string;

    // Equipment info
    equipment: {
        type: 'vehicle' | 'appliance' | 'hvac' | 'plumbing' | 'electrical' | 'other';
        category?: string;  // e.g., "car", "washing machine", "furnace"
        make?: string;
        model?: string;
        year?: number;
        additionalInfo?: string;
    };

    // Location for parts lookup
    location?: {
        zipCode?: string;
        city?: string;
        state?: string;
        coordinates?: { lat: number; lng: number };
    };

    // User preferences
    preferences?: {
        skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'professional';
        hasBasicTools: boolean;
        budgetRange?: 'budget' | 'moderate' | 'any';
        preferOEM: boolean;  // Original Equipment Manufacturer parts
    };
}

export interface RepairStep {
    stepNumber: number;
    title: string;
    description: string;
    duration: string;
    difficulty: 'easy' | 'moderate' | 'difficult' | 'expert';
    tools: string[];
    parts: string[];
    warnings: string[];
    tips: string[];
    imageUrl?: string;
    videoTimestamp?: string;  // If referencing user's video
}

export interface RequiredPart {
    name: string;
    partNumber?: string;
    oemPartNumber?: string;
    description: string;
    estimatedPrice: {
        low: number;
        high: number;
        currency: string;
    };
    alternatives?: {
        name: string;
        partNumber: string;
        price: number;
        quality: 'economy' | 'standard' | 'premium';
    }[];
    whereToFind: PartSource[];
    priority: 'required' | 'recommended' | 'optional';
}

export interface PartSource {
    storeName: string;
    storeType: 'local' | 'online' | 'dealer';
    distance?: string;
    address?: string;
    phone?: string;
    website?: string;
    inStock?: boolean;
    price?: number;
    url?: string;
}

export interface RepairGuide {
    title: string;
    summary: string;
    diagnosis: DiagnosisSchema;

    // Time and difficulty
    totalTime: string;
    overallDifficulty: 'easy' | 'moderate' | 'difficult' | 'expert';

    // Safety
    safetyWarnings: string[];
    prerequisites: string[];

    // Tools and parts
    requiredTools: string[];
    optionalTools: string[];
    requiredParts: RequiredPart[];

    // The repair steps
    steps: RepairStep[];

    // Additional info
    troubleshooting: {
        problem: string;
        solution: string;
    }[];

    // Sources
    references: {
        title: string;
        source: string;
        url?: string;
    }[];

    // Metadata
    generatedAt: string;
    confidenceScore: number;
    disclaimers: string[];
}

export interface ListenFixResult {
    success: boolean;
    guide?: RepairGuide;
    error?: string;
    processingTime: number;
    inputsAnalyzed: string[];
}

// ============================================================
// JSON SCHEMAS FOR STRUCTURED OUTPUT
// ============================================================

const REPAIR_GUIDE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        title: { type: 'STRING' },
        summary: { type: 'STRING' },
        totalTime: { type: 'STRING' },
        overallDifficulty: {
            type: 'STRING',
            enum: ['easy', 'moderate', 'difficult', 'expert']
        },
        safetyWarnings: { type: 'ARRAY', items: { type: 'STRING' } },
        prerequisites: { type: 'ARRAY', items: { type: 'STRING' } },
        requiredTools: { type: 'ARRAY', items: { type: 'STRING' } },
        optionalTools: { type: 'ARRAY', items: { type: 'STRING' } },
        requiredParts: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    name: { type: 'STRING' },
                    partNumber: { type: 'STRING' },
                    description: { type: 'STRING' },
                    estimatedPriceLow: { type: 'NUMBER' },
                    estimatedPriceHigh: { type: 'NUMBER' },
                    priority: { type: 'STRING', enum: ['required', 'recommended', 'optional'] }
                },
                required: ['name', 'description', 'priority']
            }
        },
        steps: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    stepNumber: { type: 'INTEGER' },
                    title: { type: 'STRING' },
                    description: { type: 'STRING' },
                    duration: { type: 'STRING' },
                    difficulty: { type: 'STRING', enum: ['easy', 'moderate', 'difficult', 'expert'] },
                    tools: { type: 'ARRAY', items: { type: 'STRING' } },
                    parts: { type: 'ARRAY', items: { type: 'STRING' } },
                    warnings: { type: 'ARRAY', items: { type: 'STRING' } },
                    tips: { type: 'ARRAY', items: { type: 'STRING' } }
                },
                required: ['stepNumber', 'title', 'description', 'difficulty']
            }
        },
        troubleshooting: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    problem: { type: 'STRING' },
                    solution: { type: 'STRING' }
                },
                required: ['problem', 'solution']
            }
        }
    },
    required: ['title', 'summary', 'totalTime', 'overallDifficulty', 'safetyWarnings', 'requiredTools', 'requiredParts', 'steps']
};

// ============================================================
// MAIN SERVICE CLASS
// ============================================================

export class ListenFixService {
    private apiKey: string;
    private baseUrl = 'https://generativelanguage.googleapis.com';
    private diagnosisService: DiagnosisService;
    private ragService: RAGService;
    private model: string;

    // File Search store IDs for different equipment types
    private technicalManualStores: Map<string, string[]> = new Map();

    constructor(
        apiKey: string,
        options: {
            model?: string;
            manualStores?: Record<string, string[]>;
        } = {}
    ) {
        this.apiKey = apiKey;
        this.model = options.model || 'gemini-2.5-flash';
        this.diagnosisService = new DiagnosisService(apiKey, this.model);
        this.ragService = new RAGService(apiKey);

        // Initialize manual stores if provided
        if (options.manualStores) {
            for (const [type, storeIds] of Object.entries(options.manualStores)) {
                this.technicalManualStores.set(type, storeIds);
            }
        }
    }

    /**
     * Main entry point - analyze input and generate repair guide
     */
    async analyze(input: ListenFixInput): Promise<ListenFixResult> {
        const startTime = Date.now();
        const inputsAnalyzed: string[] = [];

        try {
            // Step 1: Diagnose the issue from media inputs
            console.log('Step 1: Analyzing media inputs for diagnosis...');
            const diagnosisInput = this.buildDiagnosisInput(input);
            const diagnosisResult = await this.diagnosisService.diagnose(diagnosisInput);
            inputsAnalyzed.push(...diagnosisResult.inputsUsed);

            console.log('Diagnosis:', diagnosisResult.diagnosis.primaryDiagnosis);

            // Step 2: Retrieve relevant technical documentation
            console.log('Step 2: Retrieving technical documentation...');
            const technicalContext = await this.retrieveTechnicalDocs(
                input.equipment,
                diagnosisResult.diagnosis
            );

            // Step 3: Generate the repair guide
            console.log('Step 3: Generating repair guide...');
            const repairGuide = await this.generateRepairGuide(
                input,
                diagnosisResult.diagnosis,
                technicalContext
            );

            // Step 4: Find parts availability
            console.log('Step 4: Finding parts availability...');
            const partsWithSources = await this.findPartsAvailability(
                repairGuide.requiredParts,
                input.equipment,
                input.location
            );

            repairGuide.requiredParts = partsWithSources;

            // Step 5: Add final touches
            repairGuide.diagnosis = diagnosisResult.diagnosis;
            repairGuide.generatedAt = new Date().toISOString();
            repairGuide.confidenceScore = diagnosisResult.diagnosis.confidence;
            repairGuide.disclaimers = this.getDisclaimers(input.equipment.type);

            return {
                success: true,
                guide: repairGuide,
                processingTime: Date.now() - startTime,
                inputsAnalyzed
            };

        } catch (error) {
            console.error('Listen & Fix error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Analysis failed',
                processingTime: Date.now() - startTime,
                inputsAnalyzed
            };
        }
    }

    /**
     * Build diagnosis input from Listen & Fix input
     */
    private buildDiagnosisInput(input: ListenFixInput): DiagnosisInput {
        return {
            textDescription: this.buildDescription(input),
            audioData: input.audio,
            videoData: input.video,
            imageData: input.images,
            context: {
                equipmentType: `${input.equipment.type} - ${input.equipment.category || 'general'}`,
                equipmentModel: input.equipment.make && input.equipment.model
                    ? `${input.equipment.make} ${input.equipment.model}${input.equipment.year ? ` (${input.equipment.year})` : ''}`
                    : undefined,
                operatingConditions: input.equipment.additionalInfo
            }
        };
    }

    /**
     * Build comprehensive description from user input
     */
    private buildDescription(input: ListenFixInput): string {
        const parts: string[] = [];

        if (input.description) {
            parts.push(`User description: ${input.description}`);
        }

        const eq = input.equipment;
        parts.push(`Equipment: ${eq.type}${eq.category ? ` (${eq.category})` : ''}`);

        if (eq.make || eq.model) {
            parts.push(`Make/Model: ${[eq.make, eq.model, eq.year].filter(Boolean).join(' ')}`);
        }

        if (eq.additionalInfo) {
            parts.push(`Additional info: ${eq.additionalInfo}`);
        }

        if (input.preferences) {
            parts.push(`User skill level: ${input.preferences.skillLevel}`);
            parts.push(`Has basic tools: ${input.preferences.hasBasicTools ? 'yes' : 'no'}`);
        }

        return parts.join('\n');
    }

    /**
     * Retrieve technical documentation via RAG
     */
    private async retrieveTechnicalDocs(
        equipment: ListenFixInput['equipment'],
        diagnosis: DiagnosisSchema
    ): Promise<string> {
        // Build search query from diagnosis
        const searchQuery = [
            equipment.make,
            equipment.model,
            equipment.year,
            diagnosis.primaryDiagnosis,
            ...diagnosis.symptoms.slice(0, 3),
            'repair manual',
            'service guide'
        ].filter(Boolean).join(' ');

        // Check if we have File Search stores for this equipment type
        const storeIds = this.technicalManualStores.get(equipment.type);

        if (storeIds && storeIds.length > 0) {
            // Use File Search tool for RAG
            try {
                const result = await this.ragService.queryWithFileSearch(
                    searchQuery,
                    storeIds,
                    {
                        systemInstruction: 'Find relevant repair procedures, technical specifications, and troubleshooting steps.'
                    }
                );
                return result.answer;
            } catch (error) {
                console.warn('File Search failed, falling back to web search:', error);
            }
        }

        // Fallback: Use Google Search grounding for general info
        return await this.searchWebForTechnicalInfo(equipment, diagnosis);
    }

    /**
     * Search web for technical information (fallback)
     */
    private async searchWebForTechnicalInfo(
        equipment: ListenFixInput['equipment'],
        diagnosis: DiagnosisSchema
    ): Promise<string> {
        const query = `${equipment.make || ''} ${equipment.model || ''} ${equipment.year || ''} ${diagnosis.primaryDiagnosis} repair guide how to fix`.trim();

        const response = await fetch(
            `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: `Find technical repair information for: ${query}` }] }],
                    tools: [{ googleSearch: {} }],
                    systemInstruction: {
                        parts: [{ text: 'Search for official repair guides, technical service bulletins, and DIY repair tutorials. Summarize the key repair steps and part numbers found.' }]
                    }
                })
            }
        );

        if (!response.ok) {
            return '';
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    /**
     * Generate the repair guide with structured output
     */
    private async generateRepairGuide(
        input: ListenFixInput,
        diagnosis: DiagnosisSchema,
        technicalContext: string
    ): Promise<RepairGuide> {
        const skillLevel = input.preferences?.skillLevel || 'intermediate';
        const hasTools = input.preferences?.hasBasicTools ?? true;

        const prompt = `Generate a detailed DIY repair guide based on the following diagnosis and context.

DIAGNOSIS:
- Primary Issue: ${diagnosis.primaryDiagnosis}
- Confidence: ${(diagnosis.confidence * 100).toFixed(0)}%
- Severity: ${diagnosis.severity}
- Symptoms: ${diagnosis.symptoms.join(', ')}
- Possible Causes: ${diagnosis.possibleCauses.join(', ')}

EQUIPMENT:
- Type: ${input.equipment.type}
- Category: ${input.equipment.category || 'N/A'}
- Make: ${input.equipment.make || 'Unknown'}
- Model: ${input.equipment.model || 'Unknown'}
- Year: ${input.equipment.year || 'N/A'}

USER PROFILE:
- Skill Level: ${skillLevel}
- Has Basic Tools: ${hasTools ? 'Yes' : 'No'}
- Budget: ${input.preferences?.budgetRange || 'any'}
- Prefers OEM Parts: ${input.preferences?.preferOEM ? 'Yes' : 'No'}

TECHNICAL REFERENCE:
${technicalContext || 'No specific technical documentation available.'}

Generate a comprehensive, ${skillLevel}-friendly repair guide that:
1. Explains the issue clearly
2. Lists all required tools and parts with part numbers where possible
3. Provides step-by-step instructions with safety warnings
4. Includes troubleshooting tips
5. Estimates time for each step

${skillLevel === 'beginner' ? 'Use simple language and explain technical terms.' : ''}
${!hasTools ? 'Mention where specialized tools can be rented or borrowed.' : ''}`;

        const response = await fetch(
            `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: REPAIR_GUIDE_SCHEMA
                    },
                    systemInstruction: {
                        parts: [{
                            text: `You are an expert mechanic and appliance repair technician with 20+ years of experience. 
              You're known for creating clear, safe, and accurate DIY repair guides.
              Always prioritize safety and clearly mark steps that might be dangerous.
              If a repair is too complex for the user's skill level, recommend professional help.`
                        }]
                    }
                })
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to generate repair guide: ${error}`);
        }

        const data = await response.json();
        const rawGuide = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');

        // Transform to our RepairGuide format
        return this.transformGuide(rawGuide);
    }

    /**
     * Transform raw guide output to RepairGuide format
     */
    private transformGuide(raw: any): RepairGuide {
        return {
            title: raw.title || 'Repair Guide',
            summary: raw.summary || '',
            diagnosis: {} as DiagnosisSchema, // Will be filled in by caller
            totalTime: raw.totalTime || 'Varies',
            overallDifficulty: raw.overallDifficulty || 'moderate',
            safetyWarnings: raw.safetyWarnings || [],
            prerequisites: raw.prerequisites || [],
            requiredTools: raw.requiredTools || [],
            optionalTools: raw.optionalTools || [],
            requiredParts: (raw.requiredParts || []).map((p: any) => ({
                name: p.name,
                partNumber: p.partNumber,
                description: p.description,
                estimatedPrice: {
                    low: p.estimatedPriceLow || 0,
                    high: p.estimatedPriceHigh || 0,
                    currency: 'USD'
                },
                whereToFind: [],
                priority: p.priority || 'required'
            })),
            steps: (raw.steps || []).map((s: any) => ({
                stepNumber: s.stepNumber,
                title: s.title,
                description: s.description,
                duration: s.duration || '5-10 minutes',
                difficulty: s.difficulty || 'moderate',
                tools: s.tools || [],
                parts: s.parts || [],
                warnings: s.warnings || [],
                tips: s.tips || []
            })),
            troubleshooting: raw.troubleshooting || [],
            references: [],
            generatedAt: '',
            confidenceScore: 0,
            disclaimers: []
        };
    }

    /**
     * Find parts availability at local stores
     */
    private async findPartsAvailability(
        parts: RequiredPart[],
        equipment: ListenFixInput['equipment'],
        location?: ListenFixInput['location']
    ): Promise<RequiredPart[]> {
        if (parts.length === 0) return parts;

        const locationStr = location?.zipCode || location?.city
            ? `${location.city || ''} ${location.state || ''} ${location.zipCode || ''}`.trim()
            : 'United States';

        // Search for each part
        const updatedParts = await Promise.all(
            parts.map(async (part) => {
                try {
                    const sources = await this.searchPartSources(part, equipment, locationStr);
                    return { ...part, whereToFind: sources };
                } catch (error) {
                    console.warn(`Failed to find sources for ${part.name}:`, error);
                    return part;
                }
            })
        );

        return updatedParts;
    }

    /**
     * Search for part sources using Google Search
     */
    private async searchPartSources(
        part: RequiredPart,
        equipment: ListenFixInput['equipment'],
        location: string
    ): Promise<PartSource[]> {
        const searchQuery = `buy ${part.name} ${part.partNumber || ''} ${equipment.make || ''} ${equipment.model || ''} near ${location}`.trim();

        const response = await fetch(
            `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [{ text: `Find where to buy: ${searchQuery}. List stores with prices and availability.` }]
                    }],
                    tools: [{ googleSearch: {} }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: 'OBJECT',
                            properties: {
                                sources: {
                                    type: 'ARRAY',
                                    items: {
                                        type: 'OBJECT',
                                        properties: {
                                            storeName: { type: 'STRING' },
                                            storeType: { type: 'STRING', enum: ['local', 'online', 'dealer'] },
                                            price: { type: 'NUMBER' },
                                            url: { type: 'STRING' },
                                            inStock: { type: 'BOOLEAN' }
                                        },
                                        required: ['storeName', 'storeType']
                                    }
                                }
                            }
                        }
                    }
                })
            }
        );

        if (!response.ok) {
            return this.getDefaultPartSources(part, equipment);
        }

        try {
            const data = await response.json();
            const result = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{"sources":[]}');

            return result.sources?.map((s: any) => ({
                storeName: s.storeName,
                storeType: s.storeType,
                price: s.price,
                website: s.url,
                url: s.url,
                inStock: s.inStock
            })) || this.getDefaultPartSources(part, equipment);
        } catch {
            return this.getDefaultPartSources(part, equipment);
        }
    }

    /**
     * Get default part sources when search fails
     */
    private getDefaultPartSources(part: RequiredPart, equipment: ListenFixInput['equipment']): PartSource[] {
        const sources: PartSource[] = [];

        if (equipment.type === 'vehicle') {
            sources.push(
                { storeName: 'AutoZone', storeType: 'local', website: 'https://www.autozone.com' },
                { storeName: "O'Reilly Auto Parts", storeType: 'local', website: 'https://www.oreillyauto.com' },
                { storeName: 'Advance Auto Parts', storeType: 'local', website: 'https://www.advanceautoparts.com' },
                { storeName: 'RockAuto', storeType: 'online', website: 'https://www.rockauto.com' }
            );
        } else if (equipment.type === 'appliance') {
            sources.push(
                { storeName: 'RepairClinic', storeType: 'online', website: 'https://www.repairclinic.com' },
                { storeName: 'PartSelect', storeType: 'online', website: 'https://www.partselect.com' },
                { storeName: 'Appliance Parts Pros', storeType: 'online', website: 'https://www.appliancepartspros.com' }
            );
        } else if (equipment.type === 'hvac') {
            sources.push(
                { storeName: 'Grainger', storeType: 'online', website: 'https://www.grainger.com' },
                { storeName: 'SupplyHouse', storeType: 'online', website: 'https://www.supplyhouse.com' }
            );
        } else {
            sources.push(
                { storeName: 'Amazon', storeType: 'online', website: 'https://www.amazon.com' },
                { storeName: 'Home Depot', storeType: 'local', website: 'https://www.homedepot.com' },
                { storeName: "Lowe's", storeType: 'local', website: 'https://www.lowes.com' }
            );
        }

        return sources;
    }

    /**
     * Get appropriate disclaimers based on equipment type
     */
    private getDisclaimers(equipmentType: string): string[] {
        const common = [
            'This guide is for informational purposes only.',
            'Always prioritize safety. If unsure, consult a professional.',
            'Disconnect power/fuel sources before beginning any repair.',
            'Use appropriate personal protective equipment (PPE).'
        ];

        const specific: Record<string, string[]> = {
            vehicle: [
                'Working on vehicles can be dangerous. Use jack stands, never just a jack.',
                'Some repairs may void your warranty. Check with your dealer.',
                'Automotive repairs may require specific certifications in some areas.'
            ],
            appliance: [
                'Always unplug appliances before servicing.',
                'Gas appliances should only be serviced by qualified technicians.',
                'Water-using appliances: turn off water supply before repair.'
            ],
            hvac: [
                'HVAC systems involve high voltage and refrigerants.',
                'Refrigerant handling requires EPA certification.',
                'Gas furnace repairs should be done by licensed professionals.'
            ],
            electrical: [
                'Electrical work is dangerous and often requires permits.',
                'Always turn off circuit breakers before working on electrical systems.',
                'Many electrical repairs require a licensed electrician.'
            ],
            plumbing: [
                'Know the location of your main water shutoff valve.',
                'Some plumbing repairs require permits in certain jurisdictions.',
                'Gas line work must be done by licensed professionals.'
            ]
        };

        return [...common, ...(specific[equipmentType] || [])];
    }

    /**
     * Register technical manual stores for an equipment type
     */
    registerManualStore(equipmentType: string, storeIds: string[]): void {
        const existing = this.technicalManualStores.get(equipmentType) || [];
        this.technicalManualStores.set(equipmentType, [...existing, ...storeIds]);
    }

    /**
     * Create a File Search store for technical manuals
     */
    async createManualStore(name: string, equipmentType: string): Promise<string> {
        const store = await this.ragService.createFileSearchStore(name);
        this.registerManualStore(equipmentType, [store.id]);
        return store.id;
    }

    /**
     * Upload a technical manual to a store
     */
    async uploadManual(
        storeId: string,
        content: string | Buffer,
        mimeType: string,
        displayName: string
    ): Promise<void> {
        await this.ragService.uploadToFileSearchStore(storeId, content, mimeType, displayName);
    }
}

// Factory function
export function createListenFixService(
    apiKey?: string,
    options?: { model?: string; manualStores?: Record<string, string[]> }
): ListenFixService {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY required');
    return new ListenFixService(key, options);
}

