'use client';

/**
 * Updated Audio Processor Component
 * Uses native Gemini audio understanding instead of manual feature extraction
 * 
 * Gemini 2.5 models have native audio understanding - no need for
 * manual MFCC or spectral analysis
 */

import React, { useState, useRef, useCallback } from 'react';

interface AudioAnalysisResult {
    transcription?: string;
    analysis: string;
    confidence?: number;
    metadata?: {
        duration?: number;
        fileSize?: number;
        mimeType?: string;
    };
}

interface AudioProcessorProps {
    onAnalysisComplete?: (result: AudioAnalysisResult) => void;
    onError?: (error: Error) => void;
    analysisPrompt?: string;
    maxFileSizeMB?: number;
    acceptedFormats?: string[];
}

// Supported audio formats by Gemini
const DEFAULT_AUDIO_FORMATS = [
    'audio/wav',
    'audio/mp3',
    'audio/mpeg',
    'audio/aiff',
    'audio/aac',
    'audio/ogg',
    'audio/flac',
    'audio/webm'
];

export function AudioProcessor({
    onAnalysisComplete,
    onError,
    analysisPrompt = 'Analyze this audio. Describe what you hear, including any speech content, sounds, music, or notable audio characteristics.',
    maxFileSizeMB = 20,
    acceptedFormats = DEFAULT_AUDIO_FORMATS
}: AudioProcessorProps) {
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [result, setResult] = useState<AudioAnalysisResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    /**
     * Start recording audio from microphone
     */
    const startRecording = useCallback(async () => {
        try {
            setError(null);
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
                const url = URL.createObjectURL(audioBlob);
                setAudioUrl(url);

                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());

                // Process the audio
                await processAudio(audioBlob);
            };

            mediaRecorder.start(1000); // Collect data every second
            setIsRecording(true);
        } catch (err) {
            const error = err instanceof Error ? err : new Error('Failed to start recording');
            setError(error.message);
            onError?.(error);
        }
    }, [onError]);

    /**
     * Stop recording
     */
    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    }, [isRecording]);

    /**
     * Handle file upload
     */
    const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setError(null);

        // Validate file type
        if (!acceptedFormats.includes(file.type)) {
            const error = new Error(`Unsupported audio format: ${file.type}`);
            setError(error.message);
            onError?.(error);
            return;
        }

        // Validate file size
        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > maxFileSizeMB) {
            const error = new Error(`File too large. Maximum size is ${maxFileSizeMB}MB`);
            setError(error.message);
            onError?.(error);
            return;
        }

        const url = URL.createObjectURL(file);
        setAudioUrl(url);

        await processAudio(file);
    }, [acceptedFormats, maxFileSizeMB, onError]);

    /**
     * Process audio using Gemini API
     * This sends the audio directly to Gemini for native audio understanding
     */
    const processAudio = async (audioBlob: Blob) => {
        setIsProcessing(true);
        setResult(null);
        setError(null);

        try {
            // Convert blob to base64
            const base64Data = await blobToBase64(audioBlob);

            // Get audio duration if possible
            const duration = await getAudioDuration(audioBlob);

            // Send to Gemini API
            const response = await fetch('/api/gemini', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [
                        {
                            type: 'audio',
                            data: base64Data,
                            mimeType: audioBlob.type || 'audio/webm'
                        },
                        {
                            type: 'text',
                            text: analysisPrompt
                        }
                    ],
                    systemInstruction: 'You are an expert audio analyst. Provide detailed analysis of audio content including speech transcription, sound identification, and audio quality assessment.'
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to analyze audio');
            }

            const data = await response.json();

            const analysisResult: AudioAnalysisResult = {
                analysis: data.text,
                metadata: {
                    duration,
                    fileSize: audioBlob.size,
                    mimeType: audioBlob.type
                }
            };

            setResult(analysisResult);
            onAnalysisComplete?.(analysisResult);

        } catch (err) {
            const error = err instanceof Error ? err : new Error('Audio processing failed');
            setError(error.message);
            onError?.(error);
        } finally {
            setIsProcessing(false);
        }
    };

    /**
     * Convert Blob to base64 string
     */
    const blobToBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                // Remove data URL prefix to get pure base64
                const base64 = result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    };

    /**
     * Get audio duration from blob
     */
    const getAudioDuration = (blob: Blob): Promise<number | undefined> => {
        return new Promise((resolve) => {
            const audio = new Audio();
            audio.onloadedmetadata = () => {
                resolve(audio.duration);
                URL.revokeObjectURL(audio.src);
            };
            audio.onerror = () => resolve(undefined);
            audio.src = URL.createObjectURL(blob);
        });
    };

    /**
     * Clear current audio and results
     */
    const clearAudio = useCallback(() => {
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
        }
        setAudioUrl(null);
        setResult(null);
        setError(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, [audioUrl]);

    return (
        <div className="audio-processor p-4 border rounded-lg space-y-4">
            <div className="controls flex gap-2 flex-wrap">
                {/* Recording controls */}
                {!isRecording ? (
                    <button
                        onClick={startRecording}
                        disabled={isProcessing}
                        className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                    >
                        🎤 Start Recording
                    </button>
                ) : (
                    <button
                        onClick={stopRecording}
                        className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-800 animate-pulse"
                    >
                        ⏹ Stop Recording
                    </button>
                )}

                {/* File upload */}
                <label className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 cursor-pointer">
                    📁 Upload Audio
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={acceptedFormats.join(',')}
                        onChange={handleFileUpload}
                        disabled={isProcessing || isRecording}
                        className="hidden"
                    />
                </label>

                {/* Clear button */}
                {audioUrl && (
                    <button
                        onClick={clearAudio}
                        disabled={isProcessing}
                        className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                    >
                        🗑 Clear
                    </button>
                )}
            </div>

            {/* Audio preview */}
            {audioUrl && (
                <div className="audio-preview">
                    <audio src={audioUrl} controls className="w-full" />
                </div>
            )}

            {/* Processing indicator */}
            {isProcessing && (
                <div className="processing flex items-center gap-2 text-blue-600">
                    <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
                    <span>Analyzing audio with Gemini...</span>
                </div>
            )}

            {/* Error display */}
            {error && (
                <div className="error p-3 bg-red-100 border border-red-300 text-red-700 rounded">
                    {error}
                </div>
            )}

            {/* Results display */}
            {result && (
                <div className="result p-4 bg-gray-50 border rounded space-y-2">
                    <h3 className="font-semibold">Analysis Result</h3>
                    <div className="whitespace-pre-wrap">{result.analysis}</div>

                    {result.metadata && (
                        <div className="metadata text-sm text-gray-600 mt-2 pt-2 border-t">
                            {result.metadata.duration && (
                                <span className="mr-4">Duration: {result.metadata.duration.toFixed(1)}s</span>
                            )}
                            {result.metadata.fileSize && (
                                <span className="mr-4">Size: {(result.metadata.fileSize / 1024).toFixed(1)}KB</span>
                            )}
                            {result.metadata.mimeType && (
                                <span>Format: {result.metadata.mimeType}</span>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Format info */}
            <div className="text-xs text-gray-500">
                Supported formats: WAV, MP3, AAC, OGG, FLAC, WebM. Max size: {maxFileSizeMB}MB
            </div>
        </div>
    );
}

export default AudioProcessor;