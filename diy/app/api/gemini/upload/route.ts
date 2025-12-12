/**
 * File Upload API Route
 * Handles uploading large files (>20MB) to Gemini Files API
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes for large uploads

// Maximum file size: 2GB (Gemini's limit)
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const mimeType = formData.get('mimeType') as string | null;

        if (!file) {
            return NextResponse.json(
                { error: 'No file provided' },
                { status: 400 }
            );
        }

        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json(
                { error: 'File too large. Maximum size is 2GB' },
                { status: 400 }
            );
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: 'GEMINI_API_KEY not configured' },
                { status: 500 }
            );
        }

        // Convert file to buffer
        const buffer = Buffer.from(await file.arrayBuffer());
        const detectedMimeType = mimeType || file.type || 'application/octet-stream';

        // Upload to Gemini Files API
        // Using resumable upload for reliability with large files
        const uploadResult = await uploadToGeminiFiles(
            buffer,
            detectedMimeType,
            file.name,
            apiKey
        );

        return NextResponse.json({
            fileUri: uploadResult.uri,
            fileName: uploadResult.name,
            mimeType: uploadResult.mimeType,
            state: uploadResult.state,
            sizeBytes: uploadResult.sizeBytes
        });

    } catch (error) {
        console.error('File upload error:', error);

        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}

interface UploadResult {
    name: string;
    uri: string;
    mimeType: string;
    state: 'PROCESSING' | 'ACTIVE' | 'FAILED';
    sizeBytes: string;
}

/**
 * Upload file to Gemini Files API
 */
async function uploadToGeminiFiles(
    buffer: Buffer,
    mimeType: string,
    displayName: string,
    apiKey: string
): Promise<UploadResult> {
    const baseUrl = 'https://generativelanguage.googleapis.com';

    // Step 1: Initiate resumable upload
    const initResponse = await fetch(
        `${baseUrl}/upload/v1beta/files?key=${apiKey}`,
        {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': buffer.length.toString(),
                'X-Goog-Upload-Header-Content-Type': mimeType,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                file: {
                    displayName
                }
            })
        }
    );

    if (!initResponse.ok) {
        const error = await initResponse.text();
        throw new Error(`Failed to initiate upload: ${error}`);
    }

    const uploadUrl = initResponse.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) {
        throw new Error('No upload URL received');
    }

    // Step 2: Upload the file data
    const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            'Content-Length': buffer.length.toString(),
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize'
        },
        body: new Uint8Array(buffer)
    });

    if (!uploadResponse.ok) {
        const error = await uploadResponse.text();
        throw new Error(`Failed to upload file: ${error}`);
    }

    const fileInfo = await uploadResponse.json();

    // Step 3: Wait for file to be processed
    const processedFile = await waitForFileProcessing(fileInfo.file.name, apiKey);

    return processedFile;
}

/**
 * Poll until file is processed
 */
async function waitForFileProcessing(
    fileName: string,
    apiKey: string,
    maxAttempts = 60
): Promise<UploadResult> {
    const baseUrl = 'https://generativelanguage.googleapis.com';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const response = await fetch(
            `${baseUrl}/v1beta/${fileName}?key=${apiKey}`
        );

        if (!response.ok) {
            throw new Error('Failed to check file status');
        }

        const fileInfo = await response.json();

        if (fileInfo.state === 'ACTIVE') {
            return {
                name: fileInfo.name,
                uri: fileInfo.uri,
                mimeType: fileInfo.mimeType,
                state: fileInfo.state,
                sizeBytes: fileInfo.sizeBytes
            };
        }

        if (fileInfo.state === 'FAILED') {
            throw new Error('File processing failed');
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('File processing timeout');
}

/**
 * DELETE handler to clean up uploaded files
 */
export async function DELETE(request: NextRequest) {
    try {
        const { fileName } = await request.json();

        if (!fileName) {
            return NextResponse.json(
                { error: 'No fileName provided' },
                { status: 400 }
            );
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: 'GEMINI_API_KEY not configured' },
                { status: 500 }
            );
        }

        const baseUrl = 'https://generativelanguage.googleapis.com';

        const response = await fetch(
            `${baseUrl}/v1beta/${fileName}?key=${apiKey}`,
            { method: 'DELETE' }
        );

        if (!response.ok && response.status !== 404) {
            const error = await response.text();
            throw new Error(`Failed to delete file: ${error}`);
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('File delete error:', error);

        const errorMessage = error instanceof Error ? error.message : 'Delete failed';
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}