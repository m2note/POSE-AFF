/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from "@google/genai";
import { blobToDataUrl, delay, downloadFile, parseAndFormatErrorMessage, setupDragAndDrop } from "../utils/helpers.js";
import { generateImageEditContent } from "../utils/gemini.js";

type PoseResult = {
    prompt: string;
    status: 'pending' | 'done' | 'error';
    imageUrl: string | null;
    errorMessage?: string;
};

type PoseCategory = 'standing' | 'sitting' | 'dynamic' | 'closeup';

const POSE_PROMPTS: Record<PoseCategory, string[]> = {
    standing: [
        'proudly holding the mini figure display with both hands, showing it forward.',
        'posing with one hand on their hip and the other holding the mini figure display to the side.',
        'standing casually, holding the mini figure display in front of their chest with both hands.',
        'offering the mini figure display towards the camera with a friendly expression.',
        'leaning against a wall, casually showing the mini figure display.'
    ],
    sitting: [
        'sitting cross-legged on the floor, placing the mini figure display in front of them with a smile.',
        'sitting on a stylish chair, holding the mini figure on their lap.',
        'perched on the edge of a table, presenting the mini figure.',
        'sitting on some steps, looking thoughtfully at the mini figure.',
        'lounging on a sofa, casually holding the mini figure.'
    ],
    dynamic: [
        'lifting the mini figure display high with one hand as if celebrating a victory.',
        'jumping in the air, joyfully presenting the mini figure.',
        'in mid-stride, as if walking, holding the mini figure forward.',
        'twirling around, with the mini figure held out.',
        'leaning forward excitedly, showing the mini figure to the camera.'
    ],
    closeup: [
        'holding the mini figure display in one hand while the other hand points at it with an enthusiastic expression.',
        'tilting their head while looking at the mini figure display held in their hand with an admiring gaze.',
        'holding the mini figure display close to their face, with a cheerful expression.',
        'a close-up shot of the hands holding the mini figure, with the person\'s smiling face blurred in the background.',
        'peeking from behind the mini figure display with a playful look.'
    ]
};

export const PoseGenerator = {
  // DOM Elements
  modelInput: document.querySelector('#pose-model-file-input') as HTMLInputElement,
  modelDropZone: document.querySelector('#pose-model-drop-zone') as HTMLLabelElement,
  modelLabelText: document.querySelector('#pose-model-label-text') as HTMLSpanElement,
  modelPreview: document.querySelector('#pose-model-preview') as HTMLImageElement,
  clearModelButton: document.querySelector('#pose-clear-model-button') as HTMLButtonElement,
  figureInput: document.querySelector('#pose-figure-file-input') as HTMLInputElement,
  figureDropZone: document.querySelector('#pose-figure-drop-zone') as HTMLLabelElement,
  figureLabelText: document.querySelector('#pose-figure-label-text') as HTMLSpanElement,
  figurePreview: document.querySelector('#pose-figure-preview') as HTMLImageElement,
  clearFigureButton: document.querySelector('#pose-clear-figure-button') as HTMLButtonElement,
  backgroundButtons: document.querySelectorAll('.pose-background-button') as NodeListOf<HTMLButtonElement>,
  styleButtons: document.querySelectorAll('.pose-aff-style-button') as NodeListOf<HTMLButtonElement>,
  generateButton: document.querySelector('#pose-generate-button') as HTMLButtonElement,
  statusEl: document.querySelector('#pose-status') as HTMLParagraphElement,
  progressWrapper: document.querySelector('#pose-progress-wrapper') as HTMLDivElement,
  progressBar: document.querySelector('#pose-progress-bar') as HTMLDivElement,
  outputContainer: document.querySelector('#pose-output-container') as HTMLDivElement,
  outputGrid: document.querySelector('#pose-output-grid') as HTMLDivElement,
  albumActions: document.querySelector('#pose-album-actions') as HTMLDivElement,
  downloadAllButton: document.querySelector('#pose-download-all-button') as HTMLButtonElement,
  startOverButton: document.querySelector('#pose-start-over-button') as HTMLButtonElement,
  
  // State
  modelImage: null as string | null,
  figureImage: null as string | null,
  poseCategory: 'standing' as PoseCategory,
  background: 'studio' as 'studio' | 'indoor' | 'outdoor' | 'luxury' | 'paris' | 'prambanan' | 'singapura' | 'jewel' | 'grandcanyon' | 'cappadocia' | 'islami',
  hijabStyle: 'default' as string,
  results: [] as PoseResult[],
  isRunning: false,
  concurrency: 3,
  
  // Dependencies
  getApiKey: (() => '') as () => string,
  showPreviewModal: ((url: string | null) => {}) as (url: string | null) => void,

  init(dependencies: { getApiKey: () => string; showPreviewModal: (url: string | null) => void; }) {
    this.getApiKey = dependencies.getApiKey;
    this.showPreviewModal = dependencies.showPreviewModal;

    this.modelInput.addEventListener('change', (e) => this.handleFileUpload(e, 'model'));
    this.figureInput.addEventListener('change', (e) => this.handleFileUpload(e, 'figure'));
    setupDragAndDrop(this.modelDropZone, this.modelInput);
    setupDragAndDrop(this.figureDropZone, this.figureInput);

    this.clearModelButton.addEventListener('click', () => this.clearImage('model'));
    this.clearFigureButton.addEventListener('click', () => this.clearImage('figure'));

    this.backgroundButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.backgroundButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.background = (button as HTMLElement).dataset.background as 'studio' | 'indoor' | 'outdoor' | 'luxury' | 'paris' | 'prambanan' | 'singapura' | 'jewel' | 'grandcanyon' | 'cappadocia' | 'islami';
        });
    });
    
    this.styleButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.styleButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.hijabStyle = (button as HTMLElement).dataset.style as string;
        });
    });

    this.generateButton.addEventListener('click', () => this.generatePoses());
    this.startOverButton.addEventListener('click', () => this.reset());
    this.downloadAllButton.addEventListener('click', () => this.downloadAll());

    this.outputGrid.addEventListener('click', (e) => this.handleGridClick(e));

    this.updateUploadUI('model', false);
    this.updateUploadUI('figure', false);
  },
  
  updateUploadUI(type: 'model' | 'figure', hasImage: boolean) {
      const labelText = type === 'model' ? this.modelLabelText : this.figureLabelText;
      const preview = type === 'model' ? this.modelPreview : this.figurePreview;
      const dropZone = type === 'model' ? this.modelDropZone : this.figureDropZone;

      labelText.style.display = 'flex';
      preview.style.display = hasImage ? 'block' : 'none';
      if (hasImage) {
        dropZone.style.minHeight = 'auto';
        if (type === 'figure') {
            dropZone.style.height = '75px';
        } else {
            dropZone.style.height = '150px';
        }
      } else {
        if (type === 'figure') {
            dropZone.style.minHeight = '60px';
        } else {
            dropZone.style.minHeight = '120px';
        }
        dropZone.style.height = 'auto';
      }
  },

  async handleFileUpload(e: Event, type: 'model' | 'figure') {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const dataUrl = await blobToDataUrl(file);
      const base64Data = dataUrl.split(',')[1];
      if (type === 'model') {
        this.modelImage = base64Data;
        this.modelPreview.src = dataUrl;
        this.clearModelButton.style.display = 'flex';
        this.updateUploadUI('model', true);
        this.generateButton.disabled = false;
        this.statusEl.innerText = 'Ready to generate poses.';
      } else {
        this.figureImage = base64Data;
        this.figurePreview.src = dataUrl;
        this.clearFigureButton.style.display = 'flex';
        this.updateUploadUI('figure', true);
      }
    } catch (error) {
      console.error('Error converting file to base64:', error);
      this.statusEl.innerText = 'Error processing image file.';
    }
  },

  clearImage(type: 'model' | 'figure') {
    if (type === 'model') {
        this.modelImage = null;
        this.modelPreview.src = '#';
        this.modelInput.value = '';
        this.clearModelButton.style.display = 'none';
        this.updateUploadUI('model', false);
        this.generateButton.disabled = true;
        this.statusEl.innerText = 'Upload a portrait photo to start.';
    } else {
        this.figureImage = null;
        this.figurePreview.src = '#';
        this.figureInput.value = '';
        this.clearFigureButton.style.display = 'none';
        this.updateUploadUI('figure', false);
    }
  },
  
  reset() {
      this.clearImage('model');
      this.clearImage('figure');
      this.results = [];
      this.isRunning = false;
      this.outputContainer.style.display = 'none';
      this.albumActions.style.display = 'none';
      this.outputGrid.innerHTML = '';
  },

  getBackgroundDescription() {
    switch (this.background) {
        case 'indoor':
            return 'a cozy and stylish indoor setting, like a modern living room or a cafe.';
        case 'outdoor':
            return 'a beautiful outdoor scene, like a park with flowers or a serene beach.';
        case 'luxury':
            return 'a luxurious and elegant setting, such as a high-end hotel lobby or a designer room.';
        case 'islami':
            return 'in a luxurious room with an Islamic feel, featuring elegant Islamic architecture and decor.';
        case 'paris':
            return 'in front of the Eiffel Tower in Paris, France.';
        case 'prambanan':
            return 'in front of the majestic Prambanan temple in Indonesia.';
        case 'singapura':
            return 'in front of the iconic Merlion statue in Singapore, with the modern city skyline in the background.';
        case 'jewel':
            return 'inside the stunning Jewel Changi Airport in Singapore, with the Rain Vortex waterfall in the background.';
        case 'grandcanyon':
            return 'at the edge of the Grand Canyon in America, during a beautiful sunset.';
        case 'cappadocia':
            return 'in Cappadocia, Turkey, with numerous hot air balloons floating in the sky during sunrise.';
        case 'studio':
        default:
            return 'a clean, minimalist white studio setting.';
    }
  },

  getHijabStyleDescription(style: string): string {
    switch (style) {
        case 'casual': return 'casual hijab style, like a simple pashmina or paris scarf, suitable for daily wear.';
        case 'formal': return 'formal hijab style, elegant and neat, suitable for a party or official event.';
        case 'sporty': return 'sporty hijab style, practical and comfortable for exercise.';
        case 'chic': return 'chic and stylish hijab style, following the latest fashion trends.';
        case 'syari': return 'syari hijab style, long and covering the chest area, looking modest and graceful.';
        case 'turban': return 'modern turban hijab style, wrapped around the head stylishly.';
        case 'pastel': return 'hijab style with soft, pastel colors, looking sweet and feminine.';
        case 'earth-tone': return 'hijab style with earthy colors like brown, beige, and green, looking calm and natural.';
        case 'monochrome': return 'monochrome hijab style, using black, white, or gray tones for a classic and elegant look.';
        default: return '';
    }
  },

  async generatePoses() {
    if (!this.modelImage) {
        this.statusEl.innerText = 'Please upload a portrait photo.';
        return;
    }
    
    this.isRunning = true;
    this.generateButton.disabled = true;
    this.statusEl.innerText = 'Initializing...';
    this.progressWrapper.style.display = 'block';
    this.progressBar.style.width = '0%';
    this.outputContainer.style.display = 'block';
    this.outputGrid.innerHTML = '';

    const promptsToGenerate = POSE_PROMPTS[this.poseCategory];
    this.results = promptsToGenerate.map(prompt => ({ prompt, status: 'pending', imageUrl: null }));
    this.render();

    const jobs = this.results.map((_, index) => index);
    let completedJobs = 0;
    
    const runJob = async (jobIndex: number) => {
        if (!this.isRunning) return;

        try {
            // Step 1: Generate image
            const result = this.results[jobIndex];
            const backgroundDescription = this.getBackgroundDescription();
            const hijabStyleDescription = this.getHijabStyleDescription(this.hijabStyle);
            const styleInstruction = this.hijabStyle !== 'default' 
                ? `The person must be styled as a woman wearing a ${hijabStyleDescription}` 
                : `The person's clothing and style must be consistent with the reference image.`;

            const basePrompt = `Using the provided image of the person and the optional image of the mini figure display, create a new photorealistic image. The person's identity, face, and features MUST be preserved exactly as in the original photo. ${styleInstruction}

**Pose Instruction:**
The new image should show the person in the following pose: ${result.prompt}. The mini figure display should be held by the person naturally in this pose.

**Quality and Constraints:**
- The background must be ${backgroundDescription}
- The final image must be anatomically correct, high quality, and professional-looking.
- **CRITICAL:** Avoid any form of anatomical distortion. Specifically, prevent malformed hands, extra fingers, extra limbs, or distorted facial features. Ensure hands have exactly five fingers.
- The person's interaction with the mini figure display must look natural and believable.

Output only the final image.`;
            
            const response = await generateImageEditContent(basePrompt, this.modelImage!, this.figureImage, null, this.getApiKey);
            
            if (!this.isRunning) return;

            const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
            if (!imagePart?.inlineData) throw new Error("No image data in response.");
            const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            
            this.results[jobIndex] = { 
                ...result, 
                status: 'done', 
                imageUrl
            };
        } catch (e: any) {
            console.error(`Error generating pose ${jobIndex}:`, e);
            this.results[jobIndex] = { ...this.results[jobIndex], status: 'error', errorMessage: e.message };
        } finally {
            if (this.isRunning) {
                completedJobs++;
                const progress = (completedJobs / jobs.length) * 100;
                this.progressBar.style.width = `${progress}%`;
                this.statusEl.innerText = `Generating... (${completedJobs}/${jobs.length})`;
                this.render();
            }
        }
    };

    // Run jobs with concurrency
    for (let i = 0; i < jobs.length; i += this.concurrency) {
        if (!this.isRunning) break;
        const chunk = jobs.slice(i, i + this.concurrency);
        await Promise.all(chunk.map(jobIndex => runJob(jobIndex)));
    }
    
    this.statusEl.innerText = 'Generation complete!';
    this.isRunning = false;
    this.generateButton.disabled = false;
    this.albumActions.style.display = 'flex';
    await delay(1500);
    this.progressWrapper.style.display = 'none';
  },

  render() {
    this.outputGrid.innerHTML = '';
    this.results.forEach((result, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'video-result-item'; // Use a consistent wrapper class
        let contentHTML = '';

        const downloadIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
        const previewIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 10c-2.48 0-4.5-2.02-4.5-4.5S9.52 5.5 12 5.5s4.5 2.02 4.5 4.5-2.02 4.5-4.5 4.5zm0-7C10.62 7.5 9.5 8.62 9.5 10s1.12 2.5 2.5 2.5 2.5-1.12 2.5-2.5S13.38 7.5 12 7.5z"/></svg>`;

        if (result.status === 'pending') {
            wrapper.className = 'video-result-item-pending';
            contentHTML = `<p class="prompt-text">Menunggu...</p>`;
        } else if (result.status === 'error') {
            wrapper.className = 'image-result-item-failed';
            contentHTML = `<strong>Gagal</strong><p>${result.errorMessage || 'Unknown error'}</p>`;
        } else if (result.imageUrl) {
            contentHTML += `<div style="position: relative;">
                              <img src="${result.imageUrl}" alt="${result.prompt}" style="width: 100%; display: block;">`;

            if (result.status === 'done') {
                contentHTML += `<div class="productshot-result-item-overlay">
                                  <button class="icon-button" data-action="preview" data-index="${index}" title="Preview">${previewIcon}</button>
                                  <button class="icon-button" data-action="download" data-index="${index}" title="Download">${downloadIcon}</button>
                                </div>`;
            }
            contentHTML += `</div>`;
        }
        wrapper.innerHTML = contentHTML;
        this.outputGrid.appendChild(wrapper);
    });
  },

  handleGridClick(e: MouseEvent) {
    const button = (e.target as HTMLElement).closest('button');
    if (!button) return;

    const htmlButton = button as HTMLButtonElement;
    const action = htmlButton.dataset.action;
    const index = parseInt(htmlButton.dataset.index!, 10);
    const result = this.results[index];

    if (result) {
        if (action === 'preview' && result.imageUrl) {
            this.showPreviewModal(result.imageUrl);
        } else if (action === 'download' && result.imageUrl) {
            downloadFile(result.imageUrl, `pose_affiliator_${index + 1}.png`);
        }
    }
  },

  async downloadAll() {
    this.downloadAllButton.disabled = true;
    const span = this.downloadAllButton.querySelector('span')!;
    const originalText = span.innerText;
    let downloadedCount = 0;

    for(const [index, result] of this.results.entries()) {
        if (result.status === 'done' && result.imageUrl) {
            downloadedCount++;
            span.innerText = `Downloading ${downloadedCount}/${this.results.filter(r => r.status === 'done').length}...`;
            downloadFile(result.imageUrl, `pose_affiliator_${index + 1}.png`);
            await delay(300);
        }
    }
    span.innerText = originalText;
    this.downloadAllButton.disabled = false;
  }
};