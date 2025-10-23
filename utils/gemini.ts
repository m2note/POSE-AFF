/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {GenerateContentResponse, GenerateVideosParameters, GoogleGenAI, Modality} from '@google/genai';
import { delay } from './helpers.js';

export async function generateVideoContent(
    prompt: string,
    imageBytes: string,
    aspectRatio: string,
    model: string,
    getApiKey: () => string,
    updateStatus: (message: string, step?: number) => void
): Promise<string> {
  const ai = new GoogleGenAI({apiKey: getApiKey()});

  const config: GenerateVideosParameters = {
    model,
    prompt,
    config: {
      numberOfVideos: 1,
      aspectRatio,
    },
  };

  if (imageBytes) {
    config.image = {
      imageBytes,
      mimeType: 'image/png', // Assuming PNG, adjust if needed
    };
  }

  let operation = await ai.models.generateVideos(config);

  let messageIndex = 0;
  const loadingMessages = [
    'Warming up the generative engines...',
    'Composing the video sequence...',
    'Rendering the first frames...',
    'Adding final touches...',
    'Almost there, polishing the pixels...',
  ];
  while (!operation.done) {
    updateStatus(loadingMessages[messageIndex % loadingMessages.length], messageIndex);
    messageIndex++;
    await delay(5000);
    operation = await ai.operations.getVideosOperation({operation});
  }

  const videos = operation.response?.generatedVideos;
  if (videos === undefined || videos.length === 0) {
    throw new Error('No videos were generated. The prompt may have been blocked.');
  }

  const videoData = videos[0];
  const url = decodeURIComponent(videoData.video.uri);
  const res = await fetch(`${url}&key=${getApiKey()}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch video: ${res.status} ${res.statusText}`);
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function generateImageEditContent(
    prompt: string,
    imageBytes1: string,
    imageBytes2: string,
    maskBytes: string | null,
    getApiKey: () => string
): Promise<GenerateContentResponse> {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const parts = [];

    // Add the second image (overlay) FIRST, if it exists.
    if (imageBytes2) {
        parts.push({
            inlineData: {
                data: imageBytes2,
                mimeType: 'image/png',
            },
        });
    }

    // Add the mask image, if it exists.
    if (maskBytes) {
        parts.push({
            inlineData: {
                data: maskBytes,
                mimeType: 'image/png',
            },
        });
    }

    // Add the first image (base) SECOND. The API uses the last image as the base
    // for aspect ratio and canvas size. This ensures Image 1 is the base.
    if (imageBytes1) {
        parts.push({
            inlineData: {
                data: imageBytes1,
                mimeType: 'image/png',
            },
        });
    }

    if (parts.length === 0) {
        throw new Error("No source image provided.");
    }

    // Add the text prompt at the very end.
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image-preview',
      contents: { parts },
      config: {
          responseModalities: [Modality.IMAGE],
      },
    });
    return response;
}

export async function generateImageContent(
    prompt: string,
    aspectRatio: string,
    model: string,
    outputMimeType: 'image/png' | 'image/jpeg',
    getApiKey: () => string
): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });

    const config: any = {
      numberOfImages: 1,
      outputMimeType,
      aspectRatio,
    };

    const response = await ai.models.generateImages({
        model,
        prompt,
        config,
    });

    if (!response.generatedImages || response.generatedImages.length === 0) {
        throw new Error("No images were generated. The prompt may have been blocked.");
    }

    const generatedImage = response.generatedImages[0] as any;
    return generatedImage.image.imageBytes;
}

export async function enhancePromptWithAI(userPrompt: string, getApiKey: () => string) {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const systemInstruction = `You are a prompt enhancement assistant for a video generation AI. Your task is to take a user's prompt, translate it to clear, descriptive English if it isn't already, and enrich it with vivid details. After enhancing the user's prompt, you MUST append the following text exactly as written: ' --neg Ugly, Deformed, Bad Anatomy, Extra Fingers, Motion Blur, Low Quality, Object Merging'. The final total output (enhanced prompt + negative prompt text) MUST NOT exceed 500 characters. Be concise but impactful. Only return the final prompt string.`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: userPrompt,
        config: {
            systemInstruction: systemInstruction,
        },
    });
    
    return response.text.trim();
}

export async function generateStyledImage(base64Image: string, prompt: string, getApiKey: () => string): Promise<GenerateContentResponse> {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const finalPrompt = `${prompt}. Output only the resulting image with no accompanying text.`;
    
    const parts = [
        { inlineData: { data: base64Image, mimeType: 'image/png' } },
        { text: finalPrompt }
    ];

    return await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
}