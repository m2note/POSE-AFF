/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { blobToDataUrl, delay, downloadFile, parseAndFormatErrorMessage, setupDragAndDrop } from "../utils/helpers.js";
import { generateImageEditContent } from "../utils/gemini.js";

type PoseResult = {
    prompt: string;
    status: 'pending' | 'done' | 'error';
    imageUrl: string | null;
    errorMessage?: string;
};

const GANCI_POSES = [
    'holding the keychain up close to the camera with one hand, showing its details.',
    'dangling the keychain from their index finger with a smile.',
    'showing the keychain attached to a set of keys they are holding.',
    'holding out an open palm to the camera, with the keychain resting on it.',
    'holding the keychain in their palm, presenting it to the viewer.',
    'posing with the keychain hooked onto a belt loop of their jeans.',
    'looking down at the keychain in their hand with a look of admiration.',
    'raising one hand that is holding the keychain.',
    'casually holding a bag where the keychain is prominently attached and visible.'
];

export const PoseGanci = {
  // DOM Elements
  referenceInput: document.querySelector('#pose-ganci-reference-file-input') as HTMLInputElement,
  referenceDropZone: document.querySelector('#pose-ganci-reference-drop-zone') as HTMLLabelElement,
  referenceLabelText: document.querySelector('#pose-ganci-reference-label-text') as HTMLSpanElement,
  referencePreview: document.querySelector('#pose-ganci-reference-preview') as HTMLImageElement,
  clearReferenceButton: document.querySelector('#pose-ganci-clear-reference-button') as HTMLButtonElement,
  keychainInput: document.querySelector('#pose-ganci-keychain-file-input') as HTMLInputElement,
  keychainDropZone: document.querySelector('#pose-ganci-keychain-drop-zone') as HTMLLabelElement,
  keychainLabelText: document.querySelector('#pose-ganci-keychain-label-text') as HTMLSpanElement,
  keychainPreview: document.querySelector('#pose-ganci-keychain-preview') as HTMLImageElement,
  clearKeychainButton: document.querySelector('#pose-ganci-clear-keychain-button') as HTMLButtonElement,
  generateButton: document.querySelector('#pose-ganci-generate-button') as HTMLButtonElement,
  statusEl: document.querySelector('#pose-ganci-status') as HTMLParagraphElement,
  progressWrapper: document.querySelector('#pose-ganci-progress-wrapper') as HTMLDivElement,
  progressBar: document.querySelector('#pose-ganci-progress-bar') as HTMLDivElement,
  outputContainer: document.querySelector('#pose-ganci-output-container') as HTMLDivElement,
  outputGrid: document.querySelector('#pose-ganci-output-grid') as HTMLDivElement,
  albumActions: document.querySelector('#pose-ganci-album-actions') as HTMLDivElement,
  downloadAllButton: document.querySelector('#pose-ganci-download-all-button') as HTMLButtonElement,
  startOverButton: document.querySelector('#pose-ganci-start-over-button') as HTMLButtonElement,
  autoDownloadToggle: document.querySelector('#pose-ganci-auto-download') as HTMLInputElement,

  // State
  referenceImage: null as string | null,
  keychainImage: null as string | null,
  results: [] as PoseResult[],
  isRunning: false,
  concurrency: 3,
  autoDownloadEnabled: false,

  // Dependencies
  getApiKey: (() => '') as () => string,
  showPreviewModal: ((url: string | null) => {}) as (url: string | null) => void,

  init(dependencies: { getApiKey: () => string; showPreviewModal: (url: string | null) => void; }) {
    this.getApiKey = dependencies.getApiKey;
    this.showPreviewModal = dependencies.showPreviewModal;

    this.referenceInput.addEventListener('change', (e) => this.handleFileUpload(e, 'reference'));
    this.keychainInput.addEventListener('change', (e) => this.handleFileUpload(e, 'keychain'));
    setupDragAndDrop(this.referenceDropZone, this.referenceInput);
    setupDragAndDrop(this.keychainDropZone, this.keychainInput);

    this.clearReferenceButton.addEventListener('click', () => this.clearImage('reference'));
    this.clearKeychainButton.addEventListener('click', () => this.clearImage('keychain'));

    this.generateButton.addEventListener('click', () => this.generatePoses());
    this.startOverButton.addEventListener('click', () => this.reset());
    this.downloadAllButton.addEventListener('click', () => this.downloadAll());
    this.autoDownloadToggle.addEventListener('change', () => {
        this.autoDownloadEnabled = this.autoDownloadToggle.checked;
    });
    this.autoDownloadEnabled = this.autoDownloadToggle.checked;

    this.outputGrid.addEventListener('click', (e) => this.handleGridClick(e));

    this.updateUploadUI('reference', false);
    this.updateUploadUI('keychain', false);
    this.updateGenerateButtonState();
  },

  updateUploadUI(type: 'reference' | 'keychain', hasImage: boolean) {
      const labelText = type === 'reference' ? this.referenceLabelText : this.keychainLabelText;
      const preview = type === 'reference' ? this.referencePreview : this.keychainPreview;
      const dropZone = type === 'reference' ? this.referenceDropZone : this.keychainDropZone;

      labelText.style.display = 'flex';
      preview.style.display = hasImage ? 'block' : 'none';
      if(hasImage) {
        dropZone.style.minHeight = 'auto';
        dropZone.style.height = '150px';
      } else {
        dropZone.style.minHeight = '120px';
        dropZone.style.height = 'auto';
      }
  },

  async handleFileUpload(e: Event, type: 'reference' | 'keychain') {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const dataUrl = await blobToDataUrl(file);
      const base64Data = dataUrl.split(',')[1];
      if (type === 'reference') {
        this.referenceImage = base64Data;
        this.referencePreview.src = dataUrl;
        this.clearReferenceButton.style.display = 'flex';
        this.updateUploadUI('reference', true);
      } else {
        this.keychainImage = base64Data;
        this.keychainPreview.src = dataUrl;
        this.clearKeychainButton.style.display = 'flex';
        this.updateUploadUI('keychain', true);
      }
    } catch (error) {
      console.error('Error converting file to base64:', error);
      this.statusEl.innerText = 'Error processing image file.';
    }
    this.updateGenerateButtonState();
  },

  clearImage(type: 'reference' | 'keychain') {
    if (type === 'reference') {
        this.referenceImage = null;
        this.referencePreview.src = '#';
        this.referenceInput.value = '';
        this.clearReferenceButton.style.display = 'none';
        this.updateUploadUI('reference', false);
    } else {
        this.keychainImage = null;
        this.keychainPreview.src = '#';
        this.keychainInput.value = '';
        this.clearKeychainButton.style.display = 'none';
        this.updateUploadUI('keychain', false);
    }
    this.updateGenerateButtonState();
  },

  updateGenerateButtonState() {
      const enabled = !!this.referenceImage && !!this.keychainImage && !this.isRunning;
      this.generateButton.disabled = !enabled;
      if (!this.referenceImage || !this.keychainImage) {
          this.statusEl.innerText = 'Upload a reference and keychain photo to start.';
      } else {
          this.statusEl.innerText = 'Ready to generate poses.';
      }
  },

  reset() {
      this.clearImage('reference');
      this.clearImage('keychain');
      this.results = [];
      this.isRunning = false;
      this.outputContainer.style.display = 'none';
      this.albumActions.style.display = 'none';
      this.outputGrid.innerHTML = '';
      this.updateGenerateButtonState();
  },

  async generatePoses() {
    if (!this.referenceImage || !this.keychainImage) {
        this.statusEl.innerText = 'Please upload both a reference and a keychain photo.';
        return;
    }

    this.isRunning = true;
    this.generateButton.disabled = true;
    this.statusEl.innerText = 'Initializing...';
    this.progressWrapper.style.display = 'block';
    this.progressBar.style.width = '0%';
    this.outputContainer.style.display = 'block';
    this.outputGrid.innerHTML = '';

    this.results = GANCI_POSES.map(prompt => ({ prompt, status: 'pending', imageUrl: null }));
    this.render();

    const jobs = this.results.map((_, index) => index);
    let completedJobs = 0;

    const runJob = async (jobIndex: number) => {
        if (!this.isRunning) return;

        try {
            const result = this.results[jobIndex];
            const basePrompt = `Using the provided image of the person and the image of the keychain product, create a new photorealistic image. The person's identity, face, and features MUST be preserved exactly as in the original photo.

            **Scene Instruction:**
            The new image should show the person ${result.prompt}. The main focus should be on the keychain product, making it look appealing and clear. The background should be a clean, minimalist white studio setting to not distract from the product.

            **Quality and Constraints:**
            - The final image must be anatomically correct, high quality, and professional-looking.
            - **CRITICAL:** Avoid any form of anatomical distortion. Specifically, prevent malformed hands, extra fingers, extra limbs, or distorted facial features. Ensure hands have exactly five fingers.
            - The person's interaction with the keychain must look natural and believable.

            Output only the final image.`;

            const response = await generateImageEditContent(basePrompt, this.referenceImage!, this.keychainImage, null, this.getApiKey);

            if (!this.isRunning) return;

            const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
            if (!imagePart?.inlineData) throw new Error("No image data in response.");

            const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            this.results[jobIndex] = { ...result, status: 'done', imageUrl };

            if (this.autoDownloadEnabled) {
                downloadFile(imageUrl, `pose_ganci_${jobIndex + 1}.png`);
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
        let itemHTML = '';
        if (result.status === 'pending') {
            itemHTML = `<div class="productshot-result-item productshot-result-item-text-state"><span>Pending...</span></div>`;
        } else if (result.status === 'error') {
            itemHTML = `<div class="image-result-item-failed"><strong>Failed</strong><p>${result.errorMessage || 'Unknown error'}</p></div>`;
        } else if (result.status === 'done' && result.imageUrl) {
            itemHTML = `<div class="image-result-item">
              <img src="${result.imageUrl}" alt="Generated pose: ${result.prompt}">
              <div class="productshot-result-item-overlay">
                 <button class="icon-button" data-action="preview" data-index="${index}" aria-label="Preview image">
                    <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 10c-2.48 0-4.5-2.02-4.5-4.5S9.52 5.5 12 5.5s4.5 2.02 4.5 4.5-2.02 4.5-4.5 4.5zm0-7C10.62 7.5 9.5 8.62 9.5 10s1.12 2.5 2.5 2.5 2.5-1.12 2.5-2.5S13.38 7.5 12 7.5z"/></svg>
                 </button>
                 <button class="icon-button" data-action="download" data-index="${index}" aria-label="Download image">
                    <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                 </button>
              </div>
            </div>`;
        }
        this.outputGrid.innerHTML += itemHTML;
    });
  },

  // FIX: Cast button element to HTMLElement to safely access dataset property.
  handleGridClick(e: MouseEvent) {
    const button = (e.target as HTMLElement).closest('button');
    if (!button) return;

    const htmlButton = button as HTMLElement;
    const action = htmlButton.dataset.action;
    const index = parseInt(htmlButton.dataset.index!, 10);
    const result = this.results[index];

    if (result && result.imageUrl) {
        if (action === 'preview') {
            this.showPreviewModal(result.imageUrl);
        } else if (action === 'download') {
            downloadFile(result.imageUrl, `pose_ganci_${index + 1}.png`);
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
            downloadFile(result.imageUrl, `pose_ganci_${index + 1}.png`);
            await delay(300);
        }
    }
    span.innerText = originalText;
    this.downloadAllButton.disabled = false;
  }
};