'use client';

/**
 * Listen & Fix DIY Assistant - Main Component
 * 
 * "Shazam for Engines/Appliances"
 * Record audio/video of the problem, get a diagnosis and custom repair guide
 */

import React, { useState, useRef, useCallback } from 'react';

// Types
interface EquipmentInfo {
    type: 'vehicle' | 'appliance' | 'hvac' | 'plumbing' | 'electrical' | 'other';
    category: string;
    make: string;
    model: string;
    year: string;
    additionalInfo: string;
}

interface UserPreferences {
    skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'professional';
    hasBasicTools: boolean;
    budgetRange: 'budget' | 'moderate' | 'any';
    preferOEM: boolean;
}

interface Location {
    zipCode: string;
    city: string;
    state: string;
}

interface MediaCapture {
    type: 'audio' | 'video' | 'image';
    data: string;
    mimeType: string;
    thumbnail?: string;
}

interface RepairGuide {
    title: string;
    summary: string;
    diagnosis: {
        primaryDiagnosis: string;
        confidence: number;
        severity: string;
        symptoms: string[];
        possibleCauses: string[];
    };
    totalTime: string;
    overallDifficulty: string;
    safetyWarnings: string[];
    requiredTools: string[];
    requiredParts: {
        name: string;
        partNumber?: string;
        description: string;
        estimatedPrice: { low: number; high: number };
        whereToFind: { storeName: string; storeType: string; website?: string; price?: number }[];
        priority: string;
    }[];
    steps: {
        stepNumber: number;
        title: string;
        description: string;
        duration: string;
        difficulty: string;
        tools: string[];
        warnings: string[];
        tips: string[];
    }[];
    troubleshooting: { problem: string; solution: string }[];
    disclaimers: string[];
    confidenceScore: number;
}

// Equipment categories
const EQUIPMENT_CATEGORIES: Record<string, string[]> = {
    vehicle: ['Car', 'Truck', 'SUV', 'Motorcycle', 'ATV', 'Boat', 'RV', 'Other'],
    appliance: ['Refrigerator', 'Washer', 'Dryer', 'Dishwasher', 'Oven/Range', 'Microwave', 'Garbage Disposal', 'Other'],
    hvac: ['Furnace', 'Air Conditioner', 'Heat Pump', 'Water Heater', 'Thermostat', 'Other'],
    plumbing: ['Toilet', 'Faucet', 'Sink', 'Water Heater', 'Garbage Disposal', 'Sump Pump', 'Other'],
    electrical: ['Outlet', 'Switch', 'Light Fixture', 'Circuit Breaker', 'Ceiling Fan', 'Other'],
    other: ['Lawn Mower', 'Power Tools', 'Generator', 'Garage Door', 'Other']
};

export function ListenFixAssistant() {
    // State
    const [step, setStep] = useState<'capture' | 'details' | 'analyzing' | 'results'>('capture');
    const [mediaCaptures, setMediaCaptures] = useState<MediaCapture[]>([]);
    const [description, setDescription] = useState('');
    const [equipment, setEquipment] = useState<EquipmentInfo>({
        type: 'vehicle',
        category: '',
        make: '',
        model: '',
        year: '',
        additionalInfo: ''
    });
    const [preferences, setPreferences] = useState<UserPreferences>({
        skillLevel: 'intermediate',
        hasBasicTools: true,
        budgetRange: 'moderate',
        preferOEM: false
    });
    const [location, setLocation] = useState<Location>({
        zipCode: '',
        city: '',
        state: ''
    });
    const [result, setResult] = useState<RepairGuide | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingType, setRecordingType] = useState<'audio' | 'video' | null>(null);

    // Refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const videoPreviewRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ============================================================
    // MEDIA CAPTURE
    // ============================================================

    const startAudioRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                const base64 = await blobToBase64(blob);

                setMediaCaptures(prev => [...prev, {
                    type: 'audio',
                    data: base64,
                    mimeType: 'audio/webm'
                }]);

                stream.getTracks().forEach(t => t.stop());
                streamRef.current = null;
            };

            mediaRecorder.start(1000);
            setIsRecording(true);
            setRecordingType('audio');
        } catch (err) {
            setError('Could not access microphone. Please check permissions.');
        }
    }, []);

    const startVideoRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: true
            });
            streamRef.current = stream;

            if (videoPreviewRef.current) {
                videoPreviewRef.current.srcObject = stream;
                videoPreviewRef.current.play();
            }

            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                const blob = new Blob(chunksRef.current, { type: 'video/webm' });
                const base64 = await blobToBase64(blob);
                const thumbnail = await generateVideoThumbnail(blob);

                setMediaCaptures(prev => [...prev, {
                    type: 'video',
                    data: base64,
                    mimeType: 'video/webm',
                    thumbnail
                }]);

                if (videoPreviewRef.current) {
                    videoPreviewRef.current.srcObject = null;
                }
                stream.getTracks().forEach(t => t.stop());
                streamRef.current = null;
            };

            mediaRecorder.start(1000);
            setIsRecording(true);
            setRecordingType('video');
        } catch (err) {
            setError('Could not access camera. Please check permissions.');
        }
    }, []);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setRecordingType(null);
        }
    }, [isRecording]);

    const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/')) continue;

            const base64 = await fileToBase64(file);
            const thumbnail = await generateImageThumbnail(file);

            setMediaCaptures(prev => [...prev, {
                type: 'image',
                data: base64,
                mimeType: file.type,
                thumbnail
            }]);
        }
    }, []);

    const removeCapture = useCallback((index: number) => {
        setMediaCaptures(prev => prev.filter((_, i) => i !== index));
    }, []);

    // ============================================================
    // ANALYSIS
    // ============================================================

    const analyzeIssue = async () => {
        if (mediaCaptures.length === 0 && !description) {
            setError('Please provide at least one recording, image, or description of the issue.');
            return;
        }

        setStep('analyzing');
        setError(null);

        try {
            const response = await fetch('/api/gemini/listen-and-fix', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    media: mediaCaptures,
                    description,
                    equipment,
                    preferences,
                    location: location.zipCode ? location : undefined
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Analysis failed');
            }

            const data = await response.json();

            if (data.success && data.guide) {
                setResult(data.guide);
                setStep('results');
            } else {
                throw new Error(data.error || 'Could not generate repair guide');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Analysis failed');
            setStep('details');
        }
    };

    const startOver = () => {
        setStep('capture');
        setMediaCaptures([]);
        setDescription('');
        setResult(null);
        setError(null);
    };

    // ============================================================
    // RENDER
    // ============================================================

    return (
        <div className="listen-fix-assistant max-w-4xl mx-auto p-4">
            {/* Header */}
            <header className="text-center mb-8">
                <h1 className="text-3xl font-bold text-foreground mb-2">
                    🔧 Listen & Fix
                </h1>
                <p className="text-muted-foreground">
                    Record the problem. Get a custom repair guide.
                </p>
            </header>

            {/* Progress Steps */}
            <div className="flex justify-center mb-8">
                <div className="flex items-center space-x-4">
                    {['capture', 'details', 'analyzing', 'results'].map((s, i) => (
                        <React.Fragment key={s}>
                            <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium
                ${step === s ? 'bg-primary text-primary-foreground' :
                                    ['capture', 'details', 'analyzing', 'results'].indexOf(step) > i
                                        ? 'bg-accent text-accent-foreground'
                                        : 'bg-muted text-muted-foreground'}`}>
                                {['capture', 'details', 'analyzing', 'results'].indexOf(step) > i ? '✓' : i + 1}
                            </div>
                            {i < 3 && <div className={`w-12 h-1 ${['capture', 'details', 'analyzing', 'results'].indexOf(step) > i ? 'bg-accent' : 'bg-muted'}`} />}
                        </React.Fragment>
                    ))}
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="mb-6 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive">
                    {error}
                    <button onClick={() => setError(null)} className="ml-2 text-destructive hover:text-destructive/80">✕</button>
                </div>
            )}

            {/* Step 1: Capture */}
            {step === 'capture' && (
                <div className="space-y-6">
                    <div className="bg-card rounded-xl shadow-lg p-6 border border-border">
                        <h2 className="text-xl font-semibold text-foreground mb-4">Capture the Problem</h2>

                        {/* Recording Controls */}
                        <div className="grid grid-cols-3 gap-4 mb-6">
                            {!isRecording ? (
                                <>
                                    <button
                                        onClick={startAudioRecording}
                                        className="flex flex-col items-center p-6 border-2 border-dashed border-border rounded-xl hover:border-primary hover:bg-primary/10 transition-colors"
                                    >
                                        <span className="text-4xl mb-2">🎤</span>
                                        <span className="font-medium text-foreground">Record Audio</span>
                                        <span className="text-sm text-muted-foreground">Capture sounds</span>
                                    </button>

                                    <button
                                        onClick={startVideoRecording}
                                        className="flex flex-col items-center p-6 border-2 border-dashed border-border rounded-xl hover:border-primary hover:bg-primary/10 transition-colors"
                                    >
                                        <span className="text-4xl mb-2">🎥</span>
                                        <span className="font-medium text-foreground">Record Video</span>
                                        <span className="text-sm text-muted-foreground">Show the issue</span>
                                    </button>

                                    <label className="flex flex-col items-center p-6 border-2 border-dashed border-border rounded-xl hover:border-primary hover:bg-primary/10 transition-colors cursor-pointer">
                                        <span className="text-4xl mb-2">📷</span>
                                        <span className="font-medium text-foreground">Upload Photos</span>
                                        <span className="text-sm text-muted-foreground">Add images</span>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            onChange={handleImageUpload}
                                            className="hidden"
                                        />
                                    </label>
                                </>
                            ) : (
                                <div className="col-span-3">
                                    <div className="flex flex-col items-center p-6 bg-destructive/10 rounded-xl">
                                        {recordingType === 'video' && (
                                            <video
                                                ref={videoPreviewRef}
                                                muted
                                                className="w-full max-w-md rounded-lg mb-4 bg-background"
                                            />
                                        )}
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className="w-4 h-4 bg-destructive rounded-full animate-pulse" />
                                            <span className="text-lg font-medium text-foreground">
                                                Recording {recordingType}...
                                            </span>
                                        </div>
                                        <button
                                            onClick={stopRecording}
                                            className="px-6 py-3 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 font-medium"
                                        >
                                            ⏹ Stop Recording
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Captured Media */}
                        {mediaCaptures.length > 0 && (
                            <div className="mb-6">
                                <h3 className="font-medium text-foreground mb-3">Captured Media ({mediaCaptures.length})</h3>
                                <div className="flex flex-wrap gap-3">
                                    {mediaCaptures.map((capture, index) => (
                                        <div key={index} className="relative group">
                                            <div className="w-24 h-24 bg-muted rounded-lg flex items-center justify-center overflow-hidden">
                                                {capture.thumbnail ? (
                                                    <img src={capture.thumbnail} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <span className="text-3xl">
                                                        {capture.type === 'audio' ? '🎵' : capture.type === 'video' ? '🎬' : '🖼'}
                                                    </span>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => removeCapture(index)}
                                                className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                ✕
                                            </button>
                                            <span className="text-xs text-muted-foreground block text-center mt-1 capitalize">
                                                {capture.type}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Description */}
                        <div>
                            <label className="block font-medium text-foreground mb-2">
                                Describe the Problem (optional but helpful)
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="E.g., 'My car makes a clicking noise when I turn right, especially at low speeds...'"
                                className="w-full p-3 bg-input border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent text-foreground placeholder:text-muted-foreground"
                                rows={3}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <button
                            onClick={() => setStep('details')}
                            disabled={mediaCaptures.length === 0 && !description}
                            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                        >
                            Next: Equipment Details →
                        </button>
                    </div>
                </div>
            )}

            {/* Step 2: Equipment Details */}
            {step === 'details' && (
                <div className="space-y-6">
                    <div className="bg-card rounded-xl shadow-lg p-6 border border-border">
                        <h2 className="text-xl font-semibold text-foreground mb-4">Equipment Details</h2>

                        <div className="grid md:grid-cols-2 gap-6">
                            {/* Equipment Type */}
                            <div>
                                <label className="block font-medium text-foreground mb-2">Equipment Type *</label>
                                <select
                                    value={equipment.type}
                                    onChange={(e) => setEquipment(prev => ({
                                        ...prev,
                                        type: e.target.value as EquipmentInfo['type'],
                                        category: ''
                                    }))}
                                    className="w-full p-3 bg-input border border-border rounded-lg focus:ring-2 focus:ring-ring text-foreground"
                                >
                                    <option value="vehicle">🚗 Vehicle</option>
                                    <option value="appliance">🏠 Appliance</option>
                                    <option value="hvac">❄️ HVAC</option>
                                    <option value="plumbing">🚿 Plumbing</option>
                                    <option value="electrical">⚡ Electrical</option>
                                    <option value="other">🔧 Other</option>
                                </select>
                            </div>

                            {/* Category */}
                            <div>
                                <label className="block font-medium text-foreground mb-2">Category</label>
                                <select
                                    value={equipment.category}
                                    onChange={(e) => setEquipment(prev => ({ ...prev, category: e.target.value }))}
                                    className="w-full p-3 bg-input border border-border rounded-lg focus:ring-2 focus:ring-ring text-foreground"
                                >
                                    <option value="">Select...</option>
                                    {EQUIPMENT_CATEGORIES[equipment.type]?.map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Make */}
                            <div>
                                <label className="block font-medium text-foreground mb-2">Make/Brand</label>
                                <input
                                    type="text"
                                    value={equipment.make}
                                    onChange={(e) => setEquipment(prev => ({ ...prev, make: e.target.value }))}
                                    placeholder="e.g., Honda, Samsung, Carrier"
                                    className="w-full p-3 bg-input border border-border rounded-lg focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
                                />
                            </div>

                            {/* Model */}
                            <div>
                                <label className="block font-medium text-foreground mb-2">Model</label>
                                <input
                                    type="text"
                                    value={equipment.model}
                                    onChange={(e) => setEquipment(prev => ({ ...prev, model: e.target.value }))}
                                    placeholder="e.g., Accord, RF28R7551SR"
                                    className="w-full p-3 bg-input border border-border rounded-lg focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
                                />
                            </div>

                            {/* Year */}
                            <div>
                                <label className="block font-medium text-foreground mb-2">Year</label>
                                <input
                                    type="text"
                                    value={equipment.year}
                                    onChange={(e) => setEquipment(prev => ({ ...prev, year: e.target.value }))}
                                    placeholder="e.g., 2019"
                                    className="w-full p-3 bg-input border border-border rounded-lg focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
                                />
                            </div>

                            {/* ZIP Code */}
                            <div>
                                <label className="block font-medium text-foreground mb-2">ZIP Code (for parts)</label>
                                <input
                                    type="text"
                                    value={location.zipCode}
                                    onChange={(e) => setLocation(prev => ({ ...prev, zipCode: e.target.value }))}
                                    placeholder="e.g., 78701"
                                    className="w-full p-3 bg-input border border-border rounded-lg focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
                                />
                            </div>
                        </div>

                        {/* User Preferences */}
                        <div className="mt-6 pt-6 border-t border-border">
                            <h3 className="font-medium text-foreground mb-4">Your Skill Level & Preferences</h3>
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-foreground mb-2">Skill Level</label>
                                    <select
                                        value={preferences.skillLevel}
                                        onChange={(e) => setPreferences(prev => ({
                                            ...prev,
                                            skillLevel: e.target.value as UserPreferences['skillLevel']
                                        }))}
                                        className="w-full p-3 bg-input border border-border rounded-lg text-foreground"
                                    >
                                        <option value="beginner">🌱 Beginner - First time DIY</option>
                                        <option value="intermediate">🔧 Intermediate - Some experience</option>
                                        <option value="advanced">⚡ Advanced - Very comfortable</option>
                                        <option value="professional">🏆 Professional</option>
                                    </select>
                                </div>

                                <div className="space-y-3">
                                    <label className="flex items-center gap-3 cursor-pointer text-foreground">
                                        <input
                                            type="checkbox"
                                            checked={preferences.hasBasicTools}
                                            onChange={(e) => setPreferences(prev => ({ ...prev, hasBasicTools: e.target.checked }))}
                                            className="w-5 h-5 rounded accent-primary"
                                        />
                                        <span>I have basic tools (wrenches, screwdrivers, etc.)</span>
                                    </label>

                                    <label className="flex items-center gap-3 cursor-pointer text-foreground">
                                        <input
                                            type="checkbox"
                                            checked={preferences.preferOEM}
                                            onChange={(e) => setPreferences(prev => ({ ...prev, preferOEM: e.target.checked }))}
                                            className="w-5 h-5 rounded accent-primary"
                                        />
                                        <span>Prefer OEM (original) parts</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-between">
                        <button
                            onClick={() => setStep('capture')}
                            className="px-6 py-3 border border-border bg-card text-foreground rounded-lg hover:bg-muted font-medium"
                        >
                            ← Back
                        </button>
                        <button
                            onClick={analyzeIssue}
                            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium"
                        >
                            🔍 Analyze & Generate Guide
                        </button>
                    </div>
                </div>
            )}

            {/* Step 3: Analyzing */}
            {step === 'analyzing' && (
                <div className="bg-card rounded-xl shadow-lg p-12 text-center border border-border">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-primary/20 rounded-full mb-6">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                    <h2 className="text-2xl font-semibold text-foreground mb-2">Analyzing Your Issue</h2>
                    <p className="text-muted-foreground mb-6">
                        Our AI is examining your recordings and generating a custom repair guide...
                    </p>
                    <div className="max-w-md mx-auto space-y-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                            <span className="text-accent">✓</span> Processing media inputs
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-primary animate-pulse">●</span> Diagnosing issue
                        </div>
                        <div className="flex items-center gap-2 opacity-50">
                            <span>○</span> Retrieving technical documentation
                        </div>
                        <div className="flex items-center gap-2 opacity-50">
                            <span>○</span> Finding parts availability
                        </div>
                    </div>
                </div>
            )}

            {/* Step 4: Results */}
            {step === 'results' && result && (
                <RepairGuideDisplay guide={result} onStartOver={startOver} />
            )}
        </div>
    );
}

// ============================================================
// REPAIR GUIDE DISPLAY COMPONENT
// ============================================================

function RepairGuideDisplay({ guide, onStartOver }: { guide: RepairGuide; onStartOver: () => void }) {
    const [activeTab, setActiveTab] = useState<'steps' | 'parts' | 'tools'>('steps');
    const [expandedStep, setExpandedStep] = useState<number | null>(0);

    const severityColors: Record<string, string> = {
        low: 'bg-accent/20 text-accent',
        medium: 'bg-secondary/20 text-secondary',
        high: 'bg-neon-orange/20 text-neon-orange',
        critical: 'bg-destructive/20 text-destructive'
    };

    const difficultyColors: Record<string, string> = {
        easy: 'bg-accent/20 text-accent',
        moderate: 'bg-secondary/20 text-secondary',
        difficult: 'bg-neon-orange/20 text-neon-orange',
        expert: 'bg-destructive/20 text-destructive'
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-card rounded-xl shadow-lg p-6 border border-border">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-foreground">{guide.title}</h2>
                        <p className="text-muted-foreground mt-1">{guide.summary}</p>
                    </div>
                    <button
                        onClick={onStartOver}
                        className="px-4 py-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg"
                    >
                        Start Over
                    </button>
                </div>

                {/* Diagnosis Summary */}
                <div className="bg-muted rounded-lg p-4 mb-4">
                    <div className="flex items-center gap-4 mb-2">
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${severityColors[guide.diagnosis.severity] || 'bg-muted'}`}>
                            {guide.diagnosis.severity.toUpperCase()} SEVERITY
                        </span>
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${difficultyColors[guide.overallDifficulty] || 'bg-muted'}`}>
                            {guide.overallDifficulty.toUpperCase()} DIFFICULTY
                        </span>
                        <span className="text-muted-foreground text-sm">
                            Confidence: {Math.round(guide.confidenceScore * 100)}%
                        </span>
                    </div>
                    <p className="font-medium text-foreground">{guide.diagnosis.primaryDiagnosis}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                        Symptoms: {guide.diagnosis.symptoms.join(', ')}
                    </p>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="bg-primary/10 rounded-lg p-3">
                        <div className="text-2xl font-bold text-primary">{guide.totalTime}</div>
                        <div className="text-sm text-muted-foreground">Estimated Time</div>
                    </div>
                    <div className="bg-accent/10 rounded-lg p-3">
                        <div className="text-2xl font-bold text-accent">{guide.steps.length}</div>
                        <div className="text-sm text-muted-foreground">Steps</div>
                    </div>
                    <div className="bg-secondary/10 rounded-lg p-3">
                        <div className="text-2xl font-bold text-secondary">{guide.requiredParts.length}</div>
                        <div className="text-sm text-muted-foreground">Parts Needed</div>
                    </div>
                </div>
            </div>

            {/* Safety Warnings */}
            {guide.safetyWarnings.length > 0 && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-6">
                    <h3 className="font-semibold text-destructive flex items-center gap-2 mb-3">
                        ⚠️ Safety Warnings
                    </h3>
                    <ul className="space-y-2">
                        {guide.safetyWarnings.map((warning, i) => (
                            <li key={i} className="flex items-start gap-2 text-destructive">
                                <span className="text-destructive mt-1">•</span>
                                {warning}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Tabs */}
            <div className="bg-card rounded-xl shadow-lg overflow-hidden border border-border">
                <div className="flex border-b border-border">
                    {[
                        { id: 'steps', label: '📋 Steps', count: guide.steps.length },
                        { id: 'parts', label: '🔩 Parts', count: guide.requiredParts.length },
                        { id: 'tools', label: '🔧 Tools', count: guide.requiredTools.length }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as typeof activeTab)}
                            className={`flex-1 px-6 py-4 font-medium transition-colors
                ${activeTab === tab.id
                                    ? 'bg-primary/10 text-primary border-b-2 border-primary'
                                    : 'text-muted-foreground hover:bg-muted'}`}
                        >
                            {tab.label} ({tab.count})
                        </button>
                    ))}
                </div>

                <div className="p-6">
                    {/* Steps Tab */}
                    {activeTab === 'steps' && (
                        <div className="space-y-4">
                            {guide.steps.map((step, index) => (
                                <div
                                    key={step.stepNumber}
                                    className="border border-border rounded-lg overflow-hidden"
                                >
                                    <button
                                        onClick={() => setExpandedStep(expandedStep === index ? null : index)}
                                        className="w-full px-4 py-3 flex items-center gap-4 hover:bg-muted text-left"
                                    >
                                        <span className="shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-medium">
                                            {step.stepNumber}
                                        </span>
                                        <div className="flex-1">
                                            <div className="font-medium text-foreground">{step.title}</div>
                                            <div className="text-sm text-muted-foreground">
                                                {step.duration} • {step.difficulty}
                                            </div>
                                        </div>
                                        <span className={`transform transition-transform text-muted-foreground ${expandedStep === index ? 'rotate-180' : ''}`}>
                                            ▼
                                        </span>
                                    </button>

                                    {expandedStep === index && (
                                        <div className="px-4 py-4 bg-muted border-t border-border">
                                            <p className="mb-4 text-foreground">{step.description}</p>

                                            {step.warnings.length > 0 && (
                                                <div className="mb-3 p-3 bg-neon-orange/10 rounded-lg">
                                                    <div className="font-medium text-neon-orange mb-1">⚠️ Warnings</div>
                                                    <ul className="text-sm text-neon-orange space-y-1">
                                                        {step.warnings.map((w, i) => <li key={i}>• {w}</li>)}
                                                    </ul>
                                                </div>
                                            )}

                                            {step.tips.length > 0 && (
                                                <div className="mb-3 p-3 bg-primary/10 rounded-lg">
                                                    <div className="font-medium text-primary mb-1">💡 Tips</div>
                                                    <ul className="text-sm text-primary space-y-1">
                                                        {step.tips.map((t, i) => <li key={i}>• {t}</li>)}
                                                    </ul>
                                                </div>
                                            )}

                                            {step.tools.length > 0 && (
                                                <div className="text-sm text-muted-foreground">
                                                    <strong>Tools needed:</strong> {step.tools.join(', ')}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Parts Tab */}
                    {activeTab === 'parts' && (
                        <div className="space-y-4">
                            {guide.requiredParts.map((part, index) => (
                                <div key={index} className="border border-border rounded-lg p-4">
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <h4 className="font-medium text-foreground">{part.name}</h4>
                                            {part.partNumber && (
                                                <p className="text-sm text-muted-foreground">Part #: {part.partNumber}</p>
                                            )}
                                        </div>
                                        <span className={`px-2 py-1 rounded text-xs font-medium
                      ${part.priority === 'required' ? 'bg-destructive/20 text-destructive' :
                                                part.priority === 'recommended' ? 'bg-secondary/20 text-secondary' :
                                                    'bg-muted text-muted-foreground'}`}>
                                            {part.priority}
                                        </span>
                                    </div>

                                    <p className="text-sm text-muted-foreground mb-3">{part.description}</p>

                                    <div className="flex items-center gap-4 mb-3">
                                        <span className="text-lg font-semibold text-accent">
                                            ${part.estimatedPrice.low} - ${part.estimatedPrice.high}
                                        </span>
                                    </div>

                                    {part.whereToFind.length > 0 && (
                                        <div>
                                            <div className="text-sm font-medium text-foreground mb-2">Where to buy:</div>
                                            <div className="flex flex-wrap gap-2">
                                                {part.whereToFind.map((source, i) => (
                                                    <a
                                                        key={i}
                                                        href={source.website}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="px-3 py-1 bg-muted hover:bg-muted/80 rounded-full text-sm inline-flex items-center gap-1 text-foreground"
                                                    >
                                                        {source.storeName}
                                                        {source.price && <span className="text-accent">${source.price}</span>}
                                                        <span className="text-muted-foreground">↗</span>
                                                    </a>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Tools Tab */}
                    {activeTab === 'tools' && (
                        <div>
                            <h4 className="font-medium text-foreground mb-3">Required Tools</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-6">
                                {guide.requiredTools.map((tool, i) => (
                                    <div key={i} className="px-3 py-2 bg-muted rounded-lg text-sm text-foreground">
                                        🔧 {tool}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Troubleshooting */}
            {guide.troubleshooting.length > 0 && (
                <div className="bg-card rounded-xl shadow-lg p-6 border border-border">
                    <h3 className="font-semibold text-foreground mb-4">🔍 Troubleshooting</h3>
                    <div className="space-y-3">
                        {guide.troubleshooting.map((item, i) => (
                            <div key={i} className="border-l-4 border-primary pl-4">
                                <div className="font-medium text-foreground">Problem: {item.problem}</div>
                                <div className="text-muted-foreground">Solution: {item.solution}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Disclaimers */}
            <div className="bg-muted rounded-xl p-6 text-sm text-muted-foreground">
                <h4 className="font-medium text-foreground mb-2">Disclaimers</h4>
                <ul className="space-y-1">
                    {guide.disclaimers.map((d, i) => (
                        <li key={i}>• {d}</li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function fileToBase64(file: File): Promise<string> {
    return blobToBase64(file);
}

function generateVideoThumbnail(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.onloadeddata = () => {
            video.currentTime = 1;
        };
        video.onseeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 160;
            canvas.height = 90;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg'));
            URL.revokeObjectURL(video.src);
        };
        video.onerror = () => resolve('');
        video.src = URL.createObjectURL(blob);
    });
}

function generateImageThumbnail(file: File): Promise<string> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 160;
            canvas.height = 160;
            const ctx = canvas.getContext('2d');
            const size = Math.min(img.width, img.height);
            const x = (img.width - size) / 2;
            const y = (img.height - size) / 2;
            ctx?.drawImage(img, x, y, size, size, 0, 0, 160, 160);
            resolve(canvas.toDataURL('image/jpeg'));
            URL.revokeObjectURL(img.src);
        };
        img.onerror = () => resolve('');
        img.src = URL.createObjectURL(file);
    });
}

export default ListenFixAssistant;