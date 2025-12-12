/**
 * Listen & Fix API Route
 * 
 * Handles the full analysis pipeline:
 * 1. Process media inputs (audio/video/images)
 * 2. Crawl & ingest relevant technical documentation (background)
 * 3. Diagnose the issue
 * 4. Query RAG for technical context
 * 5. Generate repair guide
 * 6. Find parts availability
 */

import { NextRequest, NextResponse } from 'next/server';
import {
    DocumentCrawlerService,
    createDocumentCrawler,
    type EquipmentQuery
} from '@/lib/document-crawler-service';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes for full analysis

interface MediaCapture {
    type: 'audio' | 'video' | 'image';
    data: string;
    mimeType: string;
}

interface EquipmentInfo {
    type: 'vehicle' | 'appliance' | 'hvac' | 'plumbing' | 'electrical' | 'other';
    category?: string;
    make?: string;
    model?: string;
    year?: string;
    additionalInfo?: string;
}

interface UserPreferences {
    skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'professional';
    hasBasicTools: boolean;
    budgetRange?: 'budget' | 'moderate' | 'any';
    preferOEM: boolean;
}

interface Location {
    zipCode?: string;
    city?: string;
    state?: string;
}

interface RequestBody {
    media: MediaCapture[];
    description?: string;
    equipment: EquipmentInfo;
    preferences?: UserPreferences;
    location?: Location;
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BASE_URL = 'https://generativelanguage.googleapis.com';
const MODEL = 'gemini-2.5-flash';

// Shared crawler instance (in production, use Redis or similar for state)
let crawlerInstance: DocumentCrawlerService | null = null;

function getCrawler(): DocumentCrawlerService {
    if (!crawlerInstance) {
        crawlerInstance = createDocumentCrawler(GEMINI_API_KEY);
    }
    return crawlerInstance;
}

export async function POST(request: NextRequest) {
    if (!GEMINI_API_KEY) {
        return NextResponse.json(
            { success: false, error: 'GEMINI_API_KEY not configured' },
            { status: 500 }
        );
    }

    try {
        const body: RequestBody = await request.json();
        const { media, description, equipment, preferences, location } = body;

        console.log('Listen & Fix: Starting analysis...');
        console.log(`- Media items: ${media.length}`);
        console.log(`- Equipment: ${equipment.type} ${equipment.make || ''} ${equipment.model || ''}`);

        const crawler = getCrawler();

        // Step 1: Start document crawling in background
        // This will search for and ingest relevant repair docs
        console.log('Step 1: Starting document crawl (background)...');
        const crawlQuery: EquipmentQuery = {
            type: equipment.type,
            make: equipment.make,
            model: equipment.model,
            year: equipment.year,
            symptom: description?.slice(0, 100) // First 100 chars as symptom hint
        };

        // Start crawl - don't await yet, let it run in parallel with diagnosis
        const crawlPromise = crawler.ingestForEquipment(crawlQuery);

        // Step 2: Build the analysis prompt and perform diagnosis
        console.log('Step 2: Diagnosing issue...');
        const analysisPrompt = buildAnalysisPrompt(description, equipment, preferences);
        const diagnosis = await performDiagnosis(media, analysisPrompt, equipment);
        console.log(`Diagnosis: ${diagnosis.primaryDiagnosis}`);

        // Step 3: Wait for crawl to complete and update with diagnosis
        console.log('Step 3: Waiting for document ingestion...');
        const crawlResult = await crawlPromise;
        console.log(`Crawl result: ${crawlResult.documentsCrawled} docs, ${crawlResult.chunksCreated} chunks`);

        // If initial crawl didn't find much, do a targeted crawl with the diagnosis
        let storeId = crawlResult.storeId;
        if (crawlResult.chunksCreated < 5 && diagnosis.primaryDiagnosis) {
            console.log('Step 3b: Targeted crawl with diagnosis...');
            const targetedCrawl = await crawler.ingestForEquipment({
                ...crawlQuery,
                diagnosis: diagnosis.primaryDiagnosis,
                symptom: diagnosis.symptoms.join(', ')
            });
            if (targetedCrawl.chunksCreated > crawlResult.chunksCreated) {
                storeId = targetedCrawl.storeId;
            }
        }

        // Step 4: Query the ingested documents for technical context
        console.log('Step 4: Querying technical documentation...');
        let technicalContext = '';
        if (storeId && crawler.hasDocuments(storeId)) {
            technicalContext = await crawler.getContextForDiagnosis(
                storeId,
                `${diagnosis.primaryDiagnosis} ${diagnosis.symptoms.join(' ')} repair guide`
            );
            console.log(`Retrieved ${technicalContext.length} chars of technical context`);
        }

        // Fallback to Google Search if RAG didn't find enough
        if (technicalContext.length < 500) {
            console.log('Step 4b: Supplementing with Google Search...');
            const searchContext = await searchTechnicalDocs(equipment, diagnosis);
            technicalContext = technicalContext
                ? `${technicalContext}\n\n---\n\nADDITIONAL WEB SEARCH RESULTS:\n${searchContext}`
                : searchContext;
        }

        // Step 5: Generate the repair guide with full context
        console.log('Step 5: Generating repair guide...');
        const guide = await generateRepairGuide(
            diagnosis,
            technicalContext,
            equipment,
            preferences || { skillLevel: 'intermediate', hasBasicTools: true, preferOEM: false }
        );

        // Step 6: Find parts availability
        console.log('Step 6: Finding parts...');
        const partsWithSources = await findParts(guide.requiredParts, equipment, location);
        guide.requiredParts = partsWithSources;

        // Add metadata
        guide.diagnosis = diagnosis;
        guide.confidenceScore = diagnosis.confidence;
        guide.disclaimers = getDisclaimers(equipment.type);

        // Add source info
        guide.references = crawlResult.documentsCrawled > 0
            ? [{
                title: 'Technical Documentation',
                source: `${crawlResult.documentsCrawled} documents ingested`,
                url: undefined
            }]
            : [];

        console.log('Listen & Fix: Analysis complete!');

        return NextResponse.json({
            success: true,
            guide,
            meta: {
                documentsIngested: crawlResult.documentsCrawled,
                chunksCreated: crawlResult.chunksCreated,
                processingTime: crawlResult.processingTime
            }
        });

    } catch (error) {
        console.error('Listen & Fix error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Analysis failed'
            },
            { status: 500 }
        );
    }
}

/**
 * Build the analysis prompt from user input
 */
function buildAnalysisPrompt(
    description: string | undefined,
    equipment: EquipmentInfo,
    preferences?: UserPreferences
): string {
    const parts: string[] = [];

    parts.push('Analyze the provided media (audio recordings, video, and/or images) to diagnose the issue.');

    if (description) {
        parts.push(`\nUser's description: "${description}"`);
    }

    parts.push(`\nEquipment Information:`);
    parts.push(`- Type: ${equipment.type}${equipment.category ? ` (${equipment.category})` : ''}`);
    if (equipment.make) parts.push(`- Make: ${equipment.make}`);
    if (equipment.model) parts.push(`- Model: ${equipment.model}`);
    if (equipment.year) parts.push(`- Year: ${equipment.year}`);
    if (equipment.additionalInfo) parts.push(`- Additional info: ${equipment.additionalInfo}`);

    if (preferences) {
        parts.push(`\nUser is ${preferences.skillLevel} level and ${preferences.hasBasicTools ? 'has' : 'does not have'} basic tools.`);
    }

    parts.push('\nProvide a detailed diagnosis including:');
    parts.push('1. The primary issue/diagnosis');
    parts.push('2. Confidence level (0-1)');
    parts.push('3. Severity (low/medium/high/critical)');
    parts.push('4. Observed symptoms');
    parts.push('5. Possible root causes');
    parts.push('6. Whether expert review is recommended');

    return parts.join('\n');
}

/**
 * Perform diagnosis using Gemini multimodal
 */
async function performDiagnosis(
    media: MediaCapture[],
    prompt: string,
    equipment: EquipmentInfo
): Promise<any> {
    // Build content parts
    const parts: any[] = [];

    // Add media parts
    for (const item of media) {
        parts.push({
            inlineData: {
                data: item.data,
                mimeType: item.mimeType
            }
        });
    }

    // Add the prompt
    parts.push({ text: prompt });

    const response = await fetch(
        `${BASE_URL}/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            primaryDiagnosis: { type: 'STRING' },
                            confidence: { type: 'NUMBER' },
                            severity: { type: 'STRING', enum: ['low', 'medium', 'high', 'critical'] },
                            symptoms: { type: 'ARRAY', items: { type: 'STRING' } },
                            possibleCauses: { type: 'ARRAY', items: { type: 'STRING' } },
                            requiresExpertReview: { type: 'BOOLEAN' }
                        },
                        required: ['primaryDiagnosis', 'confidence', 'severity', 'symptoms', 'possibleCauses', 'requiresExpertReview']
                    }
                },
                systemInstruction: {
                    parts: [{
                        text: `You are an expert diagnostic technician specializing in ${equipment.type} repair. 
            Analyze all provided media carefully - listen for unusual sounds, look for visual signs of wear, damage, or malfunction.
            Be specific in your diagnosis and provide actionable information.
            For vehicles: Listen for engine noises, rattles, clicks, squeaks. Look for leaks, wear, damage.
            For appliances: Listen for motor sounds, vibrations, electrical buzzing. Look for damage, buildup, wear.
            Always prioritize safety in your assessment.`
                    }]
                }
            })
        }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Diagnosis failed: ${error}`);
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!result) {
        throw new Error('No diagnosis result');
    }

    return JSON.parse(result);
}

/**
 * Search for technical documentation using Google Search
 */
async function searchTechnicalDocs(
    equipment: EquipmentInfo,
    diagnosis: any
): Promise<string> {
    const searchQuery = [
        equipment.make,
        equipment.model,
        equipment.year,
        diagnosis.primaryDiagnosis,
        'repair guide',
        'how to fix'
    ].filter(Boolean).join(' ');

    const response = await fetch(
        `${BASE_URL}/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: `Search for repair information: ${searchQuery}` }]
                }],
                tools: [{ googleSearch: {} }],
                systemInstruction: {
                    parts: [{
                        text: 'Search for official repair guides, technical service bulletins, and reliable DIY tutorials. Summarize the key repair steps, required tools, and part numbers found. Focus on the most relevant and authoritative sources.'
                    }]
                }
            })
        }
    );

    if (!response.ok) {
        console.warn('Technical doc search failed, continuing without...');
        return '';
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Generate the complete repair guide
 */
async function generateRepairGuide(
    diagnosis: any,
    technicalContext: string,
    equipment: EquipmentInfo,
    preferences: UserPreferences
): Promise<any> {
    const prompt = `Generate a comprehensive DIY repair guide based on:

DIAGNOSIS:
- Issue: ${diagnosis.primaryDiagnosis}
- Severity: ${diagnosis.severity}
- Confidence: ${Math.round(diagnosis.confidence * 100)}%
- Symptoms: ${diagnosis.symptoms.join(', ')}
- Causes: ${diagnosis.possibleCauses.join(', ')}

EQUIPMENT:
${equipment.make || 'Unknown'} ${equipment.model || ''} ${equipment.year || ''} (${equipment.type})

USER PROFILE:
- Skill: ${preferences.skillLevel}
- Has tools: ${preferences.hasBasicTools ? 'Yes' : 'No'}
- Budget: ${preferences.budgetRange || 'any'}
- Prefers OEM: ${preferences.preferOEM ? 'Yes' : 'No'}

TECHNICAL REFERENCE:
${technicalContext || 'General knowledge only - no specific documentation found.'}

Create a ${preferences.skillLevel}-friendly guide with:
1. Clear title and summary
2. All required tools and parts with part numbers
3. Step-by-step instructions with time estimates
4. Safety warnings prominently displayed
5. Troubleshooting tips
${preferences.skillLevel === 'beginner' ? '6. Explain any technical terms in simple language' : ''}`;

    const response = await fetch(
        `${BASE_URL}/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            title: { type: 'STRING' },
                            summary: { type: 'STRING' },
                            totalTime: { type: 'STRING' },
                            overallDifficulty: { type: 'STRING', enum: ['easy', 'moderate', 'difficult', 'expert'] },
                            safetyWarnings: { type: 'ARRAY', items: { type: 'STRING' } },
                            requiredTools: { type: 'ARRAY', items: { type: 'STRING' } },
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
                                        warnings: { type: 'ARRAY', items: { type: 'STRING' } },
                                        tips: { type: 'ARRAY', items: { type: 'STRING' } }
                                    },
                                    required: ['stepNumber', 'title', 'description']
                                }
                            },
                            troubleshooting: {
                                type: 'ARRAY',
                                items: {
                                    type: 'OBJECT',
                                    properties: {
                                        problem: { type: 'STRING' },
                                        solution: { type: 'STRING' }
                                    }
                                }
                            }
                        },
                        required: ['title', 'summary', 'totalTime', 'overallDifficulty', 'safetyWarnings', 'requiredTools', 'requiredParts', 'steps']
                    }
                },
                systemInstruction: {
                    parts: [{
                        text: `You are an expert ${equipment.type} repair technician creating a DIY guide.
            
            IMPORTANT RULES:
            1. Safety warnings must be comprehensive and specific
            2. Include exact tool sizes (e.g., "10mm socket" not just "socket")
            3. Include part numbers when you know them
            4. Time estimates should be realistic for the skill level
            5. If a step is dangerous, mark it clearly
            6. If the repair is beyond DIY capability, say so
            7. Include tips that save time or prevent mistakes`
                    }]
                }
            })
        }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Guide generation failed: ${error}`);
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!result) {
        throw new Error('No guide generated');
    }

    const guide = JSON.parse(result);

    // Transform parts to our format
    guide.requiredParts = guide.requiredParts.map((p: any) => ({
        name: p.name,
        partNumber: p.partNumber,
        description: p.description,
        estimatedPrice: {
            low: p.estimatedPriceLow || 0,
            high: p.estimatedPriceHigh || 0
        },
        whereToFind: [],
        priority: p.priority
    }));

    return guide;
}

/**
 * Find parts availability at stores
 */
async function findParts(
    parts: any[],
    equipment: EquipmentInfo,
    location?: Location
): Promise<any[]> {
    if (parts.length === 0) return parts;

    const locationStr = location?.zipCode || location?.city || 'United States';

    // Process parts in parallel but limit concurrency
    const updatedParts = await Promise.all(
        parts.slice(0, 5).map(async (part) => { // Limit to first 5 parts
            try {
                const sources = await searchPartSources(part, equipment, locationStr);
                return { ...part, whereToFind: sources };
            } catch {
                return { ...part, whereToFind: getDefaultSources(equipment.type) };
            }
        })
    );

    // Add default sources for remaining parts
    const remainingParts = parts.slice(5).map(part => ({
        ...part,
        whereToFind: getDefaultSources(equipment.type)
    }));

    return [...updatedParts, ...remainingParts];
}

/**
 * Search for part sources
 */
async function searchPartSources(
    part: any,
    equipment: EquipmentInfo,
    location: string
): Promise<any[]> {
    const query = `buy ${part.name} ${part.partNumber || ''} ${equipment.make || ''} ${equipment.model || ''} near ${location}`;

    const response = await fetch(
        `${BASE_URL}/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: `Find stores selling: ${query}` }]
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
                                        storeType: { type: 'STRING' },
                                        price: { type: 'NUMBER' },
                                        website: { type: 'STRING' }
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
        return getDefaultSources(equipment.type);
    }

    try {
        const data = await response.json();
        const result = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{"sources":[]}');
        return result.sources || getDefaultSources(equipment.type);
    } catch {
        return getDefaultSources(equipment.type);
    }
}

/**
 * Get default part sources by equipment type
 */
function getDefaultSources(equipmentType: string): any[] {
    const sources: Record<string, any[]> = {
        vehicle: [
            { storeName: 'AutoZone', storeType: 'local', website: 'https://www.autozone.com' },
            { storeName: "O'Reilly Auto Parts", storeType: 'local', website: 'https://www.oreillyauto.com' },
            { storeName: 'RockAuto', storeType: 'online', website: 'https://www.rockauto.com' }
        ],
        appliance: [
            { storeName: 'RepairClinic', storeType: 'online', website: 'https://www.repairclinic.com' },
            { storeName: 'PartSelect', storeType: 'online', website: 'https://www.partselect.com' }
        ],
        hvac: [
            { storeName: 'Grainger', storeType: 'online', website: 'https://www.grainger.com' },
            { storeName: 'SupplyHouse', storeType: 'online', website: 'https://www.supplyhouse.com' }
        ],
        plumbing: [
            { storeName: 'Home Depot', storeType: 'local', website: 'https://www.homedepot.com' },
            { storeName: "Lowe's", storeType: 'local', website: 'https://www.lowes.com' }
        ],
        electrical: [
            { storeName: 'Home Depot', storeType: 'local', website: 'https://www.homedepot.com' },
            { storeName: "Lowe's", storeType: 'local', website: 'https://www.lowes.com' }
        ],
        other: [
            { storeName: 'Amazon', storeType: 'online', website: 'https://www.amazon.com' },
            { storeName: 'Home Depot', storeType: 'local', website: 'https://www.homedepot.com' }
        ]
    };

    return sources[equipmentType] || sources.other;
}

/**
 * Get disclaimers by equipment type
 */
function getDisclaimers(equipmentType: string): string[] {
    const common = [
        'This guide is for informational purposes only.',
        'Always prioritize safety. If unsure, consult a professional.',
        'Disconnect power/fuel sources before beginning any repair.',
        'Use appropriate personal protective equipment (PPE).',
        'AI-generated content may contain errors. Verify critical information.'
    ];

    const specific: Record<string, string[]> = {
        vehicle: [
            'Working on vehicles can be dangerous. Always use jack stands.',
            'Some repairs may void your warranty.',
            'Automotive fluids are hazardous. Dispose of properly.'
        ],
        appliance: [
            'Always unplug appliances before servicing.',
            'Gas appliances should only be serviced by qualified technicians.'
        ],
        hvac: [
            'HVAC systems involve high voltage and refrigerants.',
            'Refrigerant handling requires EPA certification.'
        ],
        electrical: [
            'Electrical work is dangerous and may require permits.',
            'Always turn off circuit breakers before working.'
        ],
        plumbing: [
            'Know your main water shutoff location.',
            'Gas line work requires licensed professionals.'
        ]
    };

    return [...common, ...(specific[equipmentType] || [])];
}