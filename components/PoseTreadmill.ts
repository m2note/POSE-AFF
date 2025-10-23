/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality, Type } from "@google/genai";
import { blobToDataUrl, delay, downloadFile, parseAndFormatErrorMessage, setupDragAndDrop } from "../utils/helpers.js";

type PoseResult = {
    prompt: string;
    status: 'pending' | 'done' | 'error';
    imageUrl: string | null;
    errorMessage?: string;
};

const TREADMILL_POSES = [
    'A high angle shot of the person standing confidently on a treadmill.',
    'A high angle shot of the person in a dynamic running pose on the treadmill.',
    'A wide shot capturing the full body of the person standing on the treadmill, looking powerful.',
    'A wide shot of the person stretching on the treadmill, as if preparing for a run.'
];

export const PoseTreadmill = {
  // DOM Elements
  garmentInputs: [
      document.querySelector('#pose-treadmill-garment-input-1') as HTMLInputElement,
      document.querySelector('#pose-treadmill-garment-input-2') as HTMLInputElement,
      document.querySelector('#pose-treadmill-garment-input-3') as HTMLInputElement,
  ],
  garmentPreviews: [
      document.querySelector('#pose-treadmill-garment-preview-1') as HTMLImageElement,
      document.querySelector('#pose-treadmill-garment-preview-2') as HTMLImageElement,
      document.querySelector('#pose-treadmill-garment-preview-3') as HTMLImageElement,
  ],
   garmentLabels: [
      document.querySelector('#pose-treadmill-garment-label-1') as HTMLSpanElement,
      document.querySelector('#pose-treadmill-garment-label-2') as HTMLSpanElement,
      document.querySelector('#pose-treadmill-garment-label-3') as HTMLSpanElement,
  ],
  clearGarmentButtons: [
      document.querySelector('#pose-treadmill-clear-garment-1') as HTMLButtonElement,
      document.querySelector('#pose-treadmill-clear-garment-2') as HTMLButtonElement,
      document.querySelector('#pose-treadmill-clear-garment-3') as HTMLButtonElement,
  ],
  modelInput: document.querySelector('#pose-treadmill-model-input') as HTMLInputElement,
  modelPreview: document.querySelector('#pose-treadmill-model-preview') as HTMLImageElement,
  modelLabel: document.querySelector('#pose-treadmill-model-label') as HTMLSpanElement,
  clearModelButton: document.querySelector('#pose-treadmill-clear-model-button') as HTMLButtonElement,
  generateButton: document.querySelector('#pose-treadmill-generate-button') as HTMLButtonElement,
  statusEl: document.querySelector('#pose-treadmill-status') as HTMLParagraphElement,
  progressWrapper: document.querySelector('#pose-treadmill-progress-wrapper') as HTMLDivElement,
  progressBar: document.querySelector('#pose-treadmill-progress-bar') as HTMLDivElement,
  outputContainer: document.querySelector('#pose-treadmill-output-container') as HTMLDivElement,
  outputGrid: document.querySelector('#pose-treadmill-output-grid') as HTMLDivElement,
  albumActions: document.querySelector('#pose-treadmill-album-actions') as HTMLDivElement,
  downloadAllButton: document.querySelector('#pose-treadmill-download-all-button') as HTMLButtonElement,
  startOverButton: document.querySelector('#pose-treadmill-start-over-button') as HTMLButtonElement,
  autoDownloadToggle: document.querySelector('#pose-treadmill-auto-download') as HTMLInputElement,

  // State
  modelImage: null as string | null,
  garmentImages: [null, null, null] as (string | null)[],
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
    this.garmentInputs.forEach((input, i) => {
        const dropZone = (input.closest('.file-drop-zone') as HTMLLabelElement);
        if (dropZone) {
            setupDragAndDrop(dropZone, input);
        }
        input.addEventListener('change', (e) => this.handleFileUpload(e, 'garment', i));
    });

    this.clearGarmentButtons.forEach((button, i) => {
        button.addEventListener('click', () => this.clearImage('garment', i));
    });
    
    setupDragAndDrop(this.modelInput.closest('.file-drop-zone') as HTMLLabelElement, this.modelInput);
    this.modelInput.addEventListener('change', (e) => this.handleFileUpload(e, 'model'));
    this.clearModelButton.addEventListener('click', () => this.clearImage('model'));

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

  async handleFileUpload(e: Event, type: 'model' | 'garment', index = 0) {
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
        this.garmentImages[index] = base64Data;
        this.garmentPreviews[index].src = dataUrl;
        this.clearGarmentButtons[index].style.display = 'flex';
        this.garmentPreviews[index].classList.remove('image-preview-hidden');
        this.garmentLabels[index].style.display = 'none';
      }
    } catch (error) {
      console.error('Error converting file to base64:', error);
      this.statusEl.innerText = 'Error processing image file.';
    }
    this.updateGenerateButtonState();
  },

  clearImage(type: 'model' | 'garment', index = 0) {
    if (type === 'model') {
        this.modelImage = null;
        this.modelPreview.src = '#';
        this.modelInput.value = '';
        this.clearModelButton.style.display = 'none';
        this.modelPreview.classList.add('image-preview-hidden');
        this.modelLabel.style.display = 'block';
    } else {
        this.garmentImages[index] = null;
        this.garmentPreviews[index].src = '#';
        this.garmentInputs[index].value = '';
        this.clearGarmentButtons[index].style.display = 'none';
        this.garmentPreviews[index].classList.add('image-preview-hidden');
        this.garmentLabels[index].style.display = 'block';
    }
    this.updateGenerateButtonState();
  },

  updateGenerateButtonState() {
      const hasGarment = this.garmentImages.some(img => img !== null);
      const enabled = !!this.modelImage && hasGarment && !this.isRunning;
      this.generateButton.disabled = !enabled;
      if (!this.modelImage || !hasGarment) {
          this.statusEl.innerText = 'Upload model & min. 1 pakaian untuk memulai.';
      } else {
          this.statusEl.innerText = 'Siap untuk menghasilkan pose.';
      }
  },

  reset() {
      this.clearImage('model');
      this.garmentImages.forEach((_, i) => this.clearImage('garment', i));
      this.results = [];
      this.isRunning = false;
      this.outputContainer.style.display = 'none';
      this.albumActions.style.display = 'none';
      this.outputGrid.innerHTML = '';
      this.updateGenerateButtonState();
  },

  async generatePoses() {
    if (!this.modelImage || !this.garmentImages.some(img => img !== null)) {
        this.statusEl.innerText = 'Please upload a model and at least one garment photo.';
        return;
    }
    
    this.isRunning = true;
    this.generateButton.disabled = true;
    this.statusEl.innerText = 'Initializing...';
    this.progressWrapper.style.display = 'block';
    this.progressBar.style.width = '0%';
    this.outputContainer.style.display = 'block';
    this.outputGrid.innerHTML = '';

    this.results = TREADMILL_POSES.map(prompt => ({ prompt, status: 'pending', imageUrl: null }));
    this.render();

    const jobs = this.results.map((_, index) => index);
    let completedJobs = 0;
    
    const runJob = async (jobIndex: number) => {
        if (!this.isRunning) return;

        try {
            // Step 1: Generate image
            const result = this.results[jobIndex];
            const basePrompt = `You are an expert at creating realistic images with consistent characters and clothing based on references. Your task is to generate a photorealistic image using the provided reference images.

            **Core Instructions (Must be followed with 100% accuracy):**
            1.  **Character Consistency:** The person in the generated image must be **identical** to the person in the reference model image. Do not alter their face, hair style and color, skin tone, or body type in any way.
            2.  **Clothing Accuracy:** The person must be wearing the **exact clothing items** provided in the reference garment images. Replicate the color, style, fit, and any logos or patterns from the clothing images perfectly. Do not add, remove, or alter any clothing items.

            **Scene Instruction:**
            The person is in the corner of a room on a treadmill. The background includes a clothes hanger rack with a few items on it and some simple wall decorations. The lighting is bright and natural, like a home gym.

            **Pose Instruction (This should be the only variation):**
            The person's pose must be: ${result.prompt}.

            **Quality and Constraints:**
            - The final image must be ultra-realistic, anatomically correct, and high quality.
            - **CRITICAL:** Avoid any form of anatomical distortion. Specifically, prevent malformed hands, extra fingers, extra limbs, or distorted facial features. Ensure hands have exactly five fingers.

            Output only the final, resulting image.`;
            
            const parts = [];
            this.garmentImages.forEach(g => g && parts.push({ inlineData: { data: g, mimeType: 'image/png' } }));
            parts.push({ inlineData: { data: this.modelImage!, mimeType: 'image/png' } });
            parts.push({ text: basePrompt });

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
                imageUrl,
            };

            if (this.autoDownloadEnabled) {
                downloadFile(imageUrl, `pose_treadmill_${jobIndex + 1}.png`);
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
        wrapper.className = 'video-result-item'; // Use consistent class
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
            downloadFile(result.imageUrl, `pose_treadmill_${index + 1}.png`);
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
            downloadFile(result.imageUrl, `pose_treadmill_${index + 1}.png`);
            await delay(300);
        }
    }
    span.innerText = originalText;
    this.downloadAllButton.disabled = false;
  }
};