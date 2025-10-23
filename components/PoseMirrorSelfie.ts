/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality } from "@google/genai";
import { blobToDataUrl, delay, downloadFile, setupDragAndDrop } from "../utils/helpers.js";

type PoseResult = {
    prompt: string;
    status: 'pending' | 'done' | 'error';
    imageUrl: string | null;
    errorMessage?: string;
};

const SELFIE_POSES = [
    'A confident selfie pose, looking directly at the camera.',
    'A cheerful selfie pose with a bright smile.',
    'A slightly angled selfie pose for a dynamic look.',
    'A cute selfie pose, head tilted slightly.'
];

type BackgroundType = 'studio' | 'bedroom' | 'elevator' | 'gym' | 'boutique' | 'luxury-living-room' | 'islamic-room';

export const PoseMirrorSelfie = {
  // DOM Elements
  productInput: document.querySelector('#pose-mirror-selfie-product-input') as HTMLInputElement,
  productPreview: document.querySelector('#pose-mirror-selfie-product-preview') as HTMLImageElement,
  productLabel: document.querySelector('#pose-mirror-selfie-product-label') as HTMLSpanElement,
  clearProductButton: document.querySelector('#pose-mirror-selfie-clear-product-button') as HTMLButtonElement,
  modelInput: document.querySelector('#pose-mirror-selfie-model-input') as HTMLInputElement,
  modelPreview: document.querySelector('#pose-mirror-selfie-model-preview') as HTMLImageElement,
  modelLabel: document.querySelector('#pose-mirror-selfie-model-label') as HTMLSpanElement,
  clearModelButton: document.querySelector('#pose-mirror-selfie-clear-model-button') as HTMLButtonElement,
  backgroundButtons: document.querySelectorAll('.pose-mirror-selfie-background-button'),
  styleButtons: document.querySelectorAll('.pose-mirror-selfie-style-button') as NodeListOf<HTMLButtonElement>,
  generateButton: document.querySelector('#pose-mirror-selfie-generate-button') as HTMLButtonElement,
  statusEl: document.querySelector('#pose-mirror-selfie-status') as HTMLParagraphElement,
  progressWrapper: document.querySelector('#pose-mirror-selfie-progress-wrapper') as HTMLDivElement,
  progressBar: document.querySelector('#pose-mirror-selfie-progress-bar') as HTMLDivElement,
  outputContainer: document.querySelector('#pose-mirror-selfie-output-container') as HTMLDivElement,
  outputGrid: document.querySelector('#pose-mirror-selfie-output-grid') as HTMLDivElement,
  albumActions: document.querySelector('#pose-mirror-selfie-album-actions') as HTMLDivElement,
  downloadAllButton: document.querySelector('#pose-mirror-selfie-download-all-button') as HTMLButtonElement,
  startOverButton: document.querySelector('#pose-mirror-selfie-start-over-button') as HTMLButtonElement,
  autoDownloadToggle: document.querySelector('#pose-mirror-selfie-auto-download') as HTMLInputElement,

  // State
  modelImage: null as string | null,
  productImage: null as string | null,
  background: 'studio' as BackgroundType,
  hijabStyle: 'default' as string,
  results: [] as PoseResult[],
  isRunning: false,
  concurrency: 2,
  autoDownloadEnabled: false,

  // Dependencies
  getApiKey: (() => '') as () => string,
  showPreviewModal: ((url: string | null) => {}) as (url: string | null) => void,

  init(dependencies: { getApiKey: () => string; showPreviewModal: (url: string | null) => void; }) {
    this.getApiKey = dependencies.getApiKey;
    this.showPreviewModal = dependencies.showPreviewModal;

    // Listeners
    setupDragAndDrop(this.productInput.closest('.file-drop-zone') as HTMLLabelElement, this.productInput);
    this.productInput.addEventListener('change', (e) => this.handleFileUpload(e, 'product'));
    this.clearProductButton.addEventListener('click', () => this.clearImage('product'));
    
    setupDragAndDrop(this.modelInput.closest('.file-drop-zone') as HTMLLabelElement, this.modelInput);
    this.modelInput.addEventListener('change', (e) => this.handleFileUpload(e, 'model'));
    this.clearModelButton.addEventListener('click', () => this.clearImage('model'));

    this.backgroundButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.backgroundButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.background = (button as HTMLElement).dataset.background as BackgroundType;
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
    this.autoDownloadToggle.addEventListener('change', () => {
        this.autoDownloadEnabled = this.autoDownloadToggle.checked;
    });
    this.autoDownloadEnabled = this.autoDownloadToggle.checked;

    this.outputGrid.addEventListener('click', (e) => this.handleGridClick(e));

    this.updateGenerateButtonState();
  },

  async handleFileUpload(e: Event, type: 'model' | 'product') {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const dataUrl = await blobToDataUrl(file);
      const base64Data = dataUrl.split(',')[1];
      if (type === 'model') {
        this.modelImage = base64Data;
        this.modelPreview.src = dataUrl;
        this.clearModelButton.style.display = 'flex';
        this.modelPreview.classList.remove('image-preview-hidden');
        this.modelLabel.style.display = 'none';
      } else {
        this.productImage = base64Data;
        this.productPreview.src = dataUrl;
        this.clearProductButton.style.display = 'flex';
        this.productPreview.classList.remove('image-preview-hidden');
        this.productLabel.style.display = 'none';
      }
    } catch (error) {
      console.error('Error converting file to base64:', error);
      this.statusEl.innerText = 'Error processing image file.';
    }
    this.updateGenerateButtonState();
  },

  clearImage(type: 'model' | 'product') {
    if (type === 'model') {
        this.modelImage = null;
        this.modelPreview.src = '#';
        this.modelInput.value = '';
        this.clearModelButton.style.display = 'none';
        this.modelPreview.classList.add('image-preview-hidden');
        this.modelLabel.style.display = 'block';
    } else {
        this.productImage = null;
        this.productPreview.src = '#';
        this.productInput.value = '';
        this.clearProductButton.style.display = 'none';
        this.productPreview.classList.add('image-preview-hidden');
        this.productLabel.style.display = 'block';
    }
    this.updateGenerateButtonState();
  },

  updateGenerateButtonState() {
      const enabled = !!this.modelImage && !!this.productImage && !this.isRunning;
      this.generateButton.disabled = !enabled;
      if (!this.modelImage || !this.productImage) {
          this.statusEl.innerText = 'Unggah produk dan model untuk memulai.';
      } else {
          this.statusEl.innerText = 'Siap untuk menghasilkan pose.';
      }
  },

  reset() {
      this.clearImage('model');
      this.clearImage('product');
      this.results = [];
      this.isRunning = false;
      this.outputContainer.style.display = 'none';
      this.albumActions.style.display = 'none';
      this.outputGrid.innerHTML = '';
      this.updateGenerateButtonState();
  },

  getBackgroundDescription() {
    switch (this.background) {
        case 'bedroom': return "a stylish and tidy bedroom.";
        case 'elevator': return "inside a modern, well-lit elevator.";
        case 'gym': return "in a bright, modern gym.";
        case 'boutique': return "in a chic clothing boutique.";
        case 'luxury-living-room': return "in a luxurious living room with a large, ornate mirror.";
        case 'islamic-room': return "in a room with beautiful Islamic decor and a mirror.";
        case 'studio':
        default: return "a clean, minimalist photo studio.";
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
    if (!this.modelImage || !this.productImage) {
        this.statusEl.innerText = 'Please upload a model and a product photo.';
        return;
    }
    
    this.isRunning = true;
    this.generateButton.disabled = true;
    this.statusEl.innerText = 'Initializing...';
    this.progressWrapper.style.display = 'block';
    this.progressBar.style.width = '0%';
    this.outputContainer.style.display = 'block';
    this.outputGrid.innerHTML = '';

    this.results = SELFIE_POSES.map(prompt => ({ prompt, status: 'pending', imageUrl: null }));
    this.render();

    const jobs = this.results.map((_, index) => index);
    let completedJobs = 0;
    
    const runJob = async (jobIndex: number) => {
        if (!this.isRunning) return;

        try {
            const result = this.results[jobIndex];
            const backgroundDescription = this.getBackgroundDescription();
            const hijabStyleDescription = this.getHijabStyleDescription(this.hijabStyle);
            const styleInstruction = this.hijabStyle !== 'default' 
                ? `They must be styled as a woman wearing a ${hijabStyleDescription}` 
                : `Their clothing and style should be consistent with the reference image.`;
            
            const basePrompt = `You are an expert at creating realistic images with consistent characters and products based on references. Your task is to generate a photorealistic image using the provided reference images.

            **Core Instructions (Must be followed with 100% accuracy):**
            1.  **Character Consistency:** The person in the generated image must be **identical** to the person in the reference model image. ${styleInstruction} Do not alter their face, hair style and color, skin tone, or body type in any way.
            2.  **Product Consistency:** The display product held by the person must be **identical** to the product in the reference product image. Replicate it perfectly.

            **Scene Instruction:**
            The new image must be a mirror selfie. The person is holding a modern smartphone (an iPhone) in one hand to take the photo in front of a mirror. With their other hand, they are holding the display product, showing it clearly towards the camera. The background is ${backgroundDescription}.
            
            **Pose Instruction (This should be the only variation):**
            The person's pose must be: ${result.prompt}.

            **Quality and Constraints:**
            - The final image must be anatomically correct, high quality, and professional-looking.
            - **CRITICAL:** Avoid any form of anatomical distortion. Specifically, prevent malformed hands, extra fingers, extra limbs, or distorted facial features. Ensure hands have exactly five fingers.

            Output only the final, resulting image.`;
            
            const parts = [
                { inlineData: { data: this.productImage!, mimeType: 'image/png' } },
                { inlineData: { data: this.modelImage!, mimeType: 'image/png' } },
                { text: basePrompt }
            ];

            const ai = new GoogleGenAI({apiKey: this.getApiKey()});
            const genResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image-preview',
                contents: { parts },
                config: { responseModalities: [Modality.IMAGE] },
            });
            
            if (!this.isRunning) return;
            const imagePart = genResponse.candidates?.[0]?.content?.parts.find(p => p.inlineData);
            if (!imagePart?.inlineData) throw new Error("No image data in response.");
            const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            
            this.results[jobIndex] = { 
                ...result, 
                status: 'done', 
                imageUrl
            };

            if (this.autoDownloadEnabled) {
                downloadFile(imageUrl, `pose_product_selfie_${jobIndex + 1}.png`);
            }

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
        wrapper.className = 'productshot-result-item';
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
            downloadFile(result.imageUrl, `pose_product_selfie_${index + 1}.png`);
        }
    }
  },

  async downloadAll() {
    this.downloadAllButton.disabled = true;
    const span = this.downloadAllButton.querySelector('span')!;
    const originalText = span.innerText;
    let downloadedCount = 0;
    const successfulCount = this.results.filter(r => r.status === 'done').length;

    for(const [index, result] of this.results.entries()) {
        if (result.status === 'done' && result.imageUrl) {
            downloadedCount++;
            span.innerText = `Downloading ${downloadedCount}/${successfulCount}...`;
            downloadFile(result.imageUrl, `pose_product_selfie_${index + 1}.png`);
            await delay(300);
        }
    }
    span.innerText = originalText;
    this.downloadAllButton.disabled = false;
  }
};