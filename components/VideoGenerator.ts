/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { blobToDataUrl, delay, downloadFile, parseAndFormatErrorMessage, setupDragAndDrop, withGenericRetry, withRetry } from "../utils/helpers.js";
import { generateVideoContent, enhancePromptWithAI } from "../utils/gemini.js";

const ESTIMATED_VIDEO_STEPS = 20; // Approx 100 seconds (20 * 5s delay)

export const VideoGenerator = {
  // Solo DOM Elements
  uploadInput: document.querySelector('#file-input') as HTMLInputElement,
  imagePreview: document.querySelector('#image-preview') as HTMLImageElement,
  promptEl: document.querySelector('#prompt-input') as HTMLInputElement,
  enhancePromptButton: document.querySelector('#enhance-prompt-button') as HTMLButtonElement,
  generateButton: document.querySelector('#generate-button') as HTMLButtonElement,
  statusEl: document.querySelector('#status') as HTMLParagraphElement,
  videoEl: document.querySelector('#video') as HTMLVideoElement,
  outputContainer: document.querySelector('#output-container') as HTMLDivElement,
  aspectRatioButtons: document.querySelectorAll('.video-aspect-ratio-button'),
  clearImageButton: document.querySelector('#clear-video-image') as HTMLButtonElement,
  progressWrapper: document.querySelector('#video-progress-wrapper') as HTMLDivElement,
  progressBar: document.querySelector('#video-progress-bar') as HTMLDivElement,
  autoDownloadToggle: document.querySelector('#video-auto-download') as HTMLInputElement,
  
  // Batch DOM Elements
  soloModeButton: document.querySelector('#video-mode-solo-button') as HTMLButtonElement,
  batchModeButton: document.querySelector('#video-mode-batch-button') as HTMLButtonElement,
  soloPanel: document.querySelector('#video-gen-solo-panel') as HTMLDivElement,
  batchPanel: document.querySelector('#video-gen-batch-panel') as HTMLDivElement,
  batchPromptInput: document.querySelector('#batch-prompt-input') as HTMLTextAreaElement,
  batchPromptCounter: document.querySelector('#batch-prompt-counter') as HTMLSpanElement,
  batchAspectRatioButtons: document.querySelectorAll('.batch-video-aspect-ratio-button'),
  batchDelayInput: document.querySelector('#batch-video-delay-input') as HTMLInputElement,
  batchUploadButton: document.querySelector('#batch-upload-button') as HTMLButtonElement,
  batchFileInput: document.querySelector('#batch-file-input') as HTMLInputElement,
  batchFileList: document.querySelector('#batch-file-list') as HTMLDivElement,
  generateBatchButton: document.querySelector('#generate-batch-button') as HTMLButtonElement,
  stopBatchButton: document.querySelector('#stop-batch-button') as HTMLButtonElement,
  batchStatus: document.querySelector('#batch-status') as HTMLParagraphElement,
  batchProgressWrapper: document.querySelector('#batch-video-progress-wrapper') as HTMLDivElement,
  batchProgressBar: document.querySelector('#batch-video-progress-bar') as HTMLDivElement,
  batchOutputContainer: document.querySelector('#batch-output-container') as HTMLDivElement,
  batchOutputGrid: document.querySelector('#batch-output-grid') as HTMLDivElement,
  batchActionsContainer: document.querySelector('#batch-video-actions') as HTMLDivElement,
  downloadAllButton: document.querySelector('#download-all-videos-button') as HTMLButtonElement,

  // Solo State
  prompt: '',
  base64Data: '',
  aspectRatio: '16:9',
  autoDownloadEnabled: true,
  
  // Batch State
  batchAspectRatio: '16:9',
  batchFiles: [] as File[],
  isBatchProcessRunning: false,
  batchVideoDelaySeconds: 10,
  batchVideoResults: [] as { url: string; prompt: string; }[],
  
  // Dependencies
  getApiKey: (() => '') as () => string,

  init(dependencies: { getApiKey: () => string; }) {
    this.getApiKey = dependencies.getApiKey;
    
    // Solo Listeners
    this.uploadInput.addEventListener('change', (e) => this.handleFileUpload(e));
    setupDragAndDrop(document.querySelector('.file-drop-zone[for="file-input"]'), this.uploadInput);
    this.promptEl.addEventListener('input', () => this.prompt = this.promptEl.value);
    this.generateButton.addEventListener('click', () => this.generateVideo());
    this.enhancePromptButton.addEventListener('click', () => this.enhancePrompt());
    this.clearImageButton.addEventListener('click', () => this.clearImage());
    this.aspectRatioButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.aspectRatioButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.aspectRatio = (button as HTMLElement).dataset.ratio || '16:9';
        });
    });
    this.autoDownloadToggle.addEventListener('change', () => {
        this.autoDownloadEnabled = this.autoDownloadToggle.checked;
    });
    this.autoDownloadEnabled = this.autoDownloadToggle.checked;

    // Batch Listeners
    this.soloModeButton.addEventListener('click', () => this.setMode('solo'));
    this.batchModeButton.addEventListener('click', () => this.setMode('batch'));
    this.batchUploadButton.addEventListener('click', () => this.batchFileInput.click());
    this.batchFileInput.addEventListener('change', (e) => this.handleBatchFileUpload(e));
    this.batchPromptInput?.addEventListener('input', () => this.updateBatchPromptCounter());
    this.generateBatchButton.addEventListener('click', () => this.generateBatchVideos());
    this.stopBatchButton.addEventListener('click', () => { this.isBatchProcessRunning = false; });
    this.downloadAllButton.addEventListener('click', () => this.downloadAllBatchVideos());
    this.batchDelayInput?.addEventListener('input', () => {
        this.batchVideoDelaySeconds = this.batchDelayInput.valueAsNumber || 10;
    });
    this.batchAspectRatioButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.batchAspectRatioButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.batchAspectRatio = (button as HTMLElement).dataset.ratio || '16:9';
        });
    });

    this.setMode('solo');
    this.updateBatchPromptCounter();
  },

  setLoading(loading: boolean, isBatch: boolean = false) {
    if (isBatch) {
      this.generateBatchButton.disabled = loading;
      this.batchUploadButton.disabled = loading;
      this.batchPromptInput.disabled = loading;
      this.batchAspectRatioButtons.forEach(b => (b as HTMLButtonElement).disabled = loading);

      this.generateBatchButton.style.display = this.isBatchProcessRunning ? 'none' : 'flex';
      this.stopBatchButton.style.display = this.isBatchProcessRunning ? 'flex' : 'none';
      
      this.batchProgressWrapper.style.display = loading ? 'block' : 'none';

      if (loading) {
        this.batchProgressBar.style.width = '0%';
        this.batchActionsContainer.style.display = 'none';
      }

    } else {
      this.generateButton.disabled = loading;
      this.uploadInput.disabled = loading;
      this.promptEl.disabled = loading;
      this.enhancePromptButton.disabled = loading;
      this.aspectRatioButtons.forEach(b => (b as HTMLButtonElement).disabled = loading);

      this.progressWrapper.style.display = loading ? 'block' : 'none';
      if(loading) {
        this.progressBar.style.width = '0%';
        this.outputContainer.style.display = 'none';
        this.videoEl.src = '';
      }
    }
  },

  updateStatus(message: string) {
    this.statusEl.innerText = message;
  },

  async handleFileUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      try {
          const dataUrl = await blobToDataUrl(file);
          this.imagePreview.src = dataUrl;
          this.base64Data = dataUrl.split(',')[1];
          this.imagePreview.classList.remove('image-preview-hidden');
          this.clearImageButton.style.display = 'flex';
      } catch (error) {
          console.error('Error converting file to base64:', error);
          this.statusEl.innerText = 'Error processing image file.';
      }
    }
  },

  clearImage() {
    this.base64Data = '';
    this.imagePreview.src = '#';
    this.imagePreview.classList.add('image-preview-hidden');
    this.uploadInput.value = '';
    this.clearImageButton.style.display = 'none';
  },

  async generateVideo() {
    if (this.prompt.trim() === '') {
        this.statusEl.innerText = 'Please enter a prompt.';
        return;
    }
    this.setLoading(true);

    const updateStatus = (message: string, step?: number) => {
        this.statusEl.innerText = message;
        if (step !== undefined && this.progressBar) {
            const progress = Math.min(95, Math.max(0, (step / ESTIMATED_VIDEO_STEPS) * 100));
            this.progressBar.style.width = `${progress}%`;
        }
    };

    updateStatus('Initializing video generation...', 0);

    try {
        const videoUrl = await withRetry(
            () => generateVideoContent(this.prompt, this.base64Data, this.aspectRatio, 'veo-2.0-generate-001', this.getApiKey, updateStatus),
            {
                retries: 10,
                delayMs: 2000,
                onRetry: (attempt) => {
                    updateStatus(`Quota limit reached. Retrying in 2s... (Attempt ${attempt}/10)`);
                }
            }
        );
        this.progressBar.style.width = '100%';
        updateStatus('Video generated successfully!');
        this.videoEl.src = videoUrl;
        this.outputContainer.style.display = 'block';
        if (this.autoDownloadEnabled) {
            downloadFile(videoUrl, `video_${Date.now()}.mp4`);
        }

    } catch (e: any) {
        const errorMessage = parseAndFormatErrorMessage(e, 'Video generation');
        console.error('Error during video generation:', e);
        updateStatus(errorMessage);
    } finally {
        await delay(1500);
        this.setLoading(false);
        this.statusEl.innerText = 'Ready.';
    }
  },

  async enhancePrompt() {
    const userPrompt = this.promptEl.value.trim();
    if (!userPrompt) {
        this.statusEl.innerText = 'Please enter a prompt to enhance.';
        return;
    }

    const originalButtonHTML = this.enhancePromptButton.innerHTML;
    this.enhancePromptButton.disabled = true;
    this.enhancePromptButton.innerHTML = '<span>Enhancing...</span>';
    this.statusEl.innerText = 'Enhancing prompt with AI...';

    try {
        const generateFn = () => enhancePromptWithAI(userPrompt, this.getApiKey);
        const response = await withRetry(generateFn, {
            retries: 10,
            delayMs: 2000,
            onRetry: (attempt) => {
                this.statusEl.innerText = `Enhancement quota reached. Retrying... (${attempt}/10)`;
            }
        });
        
        this.promptEl.value = response;
        this.prompt = response;
        this.statusEl.innerText = 'Prompt enhanced successfully!';
    } catch (e: any) {
        console.error("Prompt enhancement failed:", e);
        const errorMessage = parseAndFormatErrorMessage(e, 'Prompt enhancement');
        this.statusEl.innerText = errorMessage;
    } finally {
        this.enhancePromptButton.disabled = false;
        this.enhancePromptButton.innerHTML = originalButtonHTML;
    }
  },

  // Batch Methods
  setMode(mode: 'solo' | 'batch') {
    if (mode === 'solo') {
        this.soloPanel.style.display = 'flex';
        this.batchPanel.style.display = 'none';
        this.soloModeButton.classList.add('active');
        this.batchModeButton.classList.remove('active');
    } else {
        this.soloPanel.style.display = 'none';
        this.batchPanel.style.display = 'block';
        this.soloModeButton.classList.remove('active');
        this.batchModeButton.classList.add('active');
    }
  },

  handleBatchFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files) {
        this.batchFiles = [];
        this.batchFileList.innerHTML = '<p>No images selected.</p>';
        return;
    }
    this.batchFiles = Array.from(input.files).slice(0, 10);
    this.batchFileList.innerHTML = this.batchFiles.length > 0
      ? this.batchFiles.map(file => `<p>${file.name}</p>`).join('')
      : '<p>No images selected.</p>';
  },

  async interruptibleDelay(ms: number, updateStatus: (message: string) => void): Promise<void> {
    return new Promise((resolve) => {
        let secondsLeft = Math.ceil(ms / 1000);
        const interval = setInterval(() => {
            if (!this.isBatchProcessRunning) {
                clearInterval(interval);
                resolve();
                return;
            }
            secondsLeft--;
            updateStatus(`Next video in ${secondsLeft}s... (Click STOP to cancel)`);
            if (secondsLeft <= 0) {
                clearInterval(interval);
                resolve();
            }
        }, 1000);
        updateStatus(`Next video in ${secondsLeft}s... (Click STOP to cancel)`);
    });
  },

  updateBatchPromptCounter() {
    const count = this.batchPromptInput.value.split('\n').filter(p => p.trim()).length;
    this.batchPromptCounter.innerText = `${count} / 10`;
    this.batchPromptCounter.style.color = count > 10 ? 'var(--color-primary)' : 'var(--color-text-muted)';
  },

  async generateBatchVideos() {
    const prompts = this.batchPromptInput.value.split('\n').map(p => p.trim()).filter(p => p).slice(0, 10);
    if (prompts.length === 0) {
        this.batchStatus.innerText = 'Please enter at least one prompt.';
        return;
    }

    this.isBatchProcessRunning = true;
    this.batchVideoResults = [];
    this.setLoading(true, true);
    this.batchOutputGrid.innerHTML = '';
    this.batchOutputContainer.style.display = 'block';
    
    const updateStatus = (message: string) => {
        this.batchStatus.innerText = message;
    };

    try {
        for (const [index, prompt] of prompts.entries()) {
            if (!this.isBatchProcessRunning) {
                updateStatus('Batch process stopped by user.');
                break;
            }

            updateStatus(`[${index + 1}/${prompts.length}] Generating: Waiting`);
            const imageFile = this.batchFiles[index];
            let imageBytes = '';
            
            try {
                if (imageFile) {
                    updateStatus(`[${index + 1}/${prompts.length}] Preparing image: ${imageFile.name}`);
                    const dataUrl = await blobToDataUrl(imageFile);
                    imageBytes = dataUrl.split(',')[1];
                }

                const generateFn = () => generateVideoContent(prompt, imageBytes, this.batchAspectRatio, 'veo-2.0-generate-001', this.getApiKey, (msg) => {
                     updateStatus(`[${index + 1}/${prompts.length}] ${msg}`);
                });

                const videoUrl = await withGenericRetry(generateFn, {
                    retries: 10,
                    delayMs: this.batchVideoDelaySeconds * 1000,
                    onRetry: (attempt) => {
                        updateStatus(`[${index + 1}/${prompts.length}] Failed. Retrying in ${this.batchVideoDelaySeconds}s... (Attempt ${attempt}/10)`);
                    }
                });
                
                this.batchVideoResults.push({ url: videoUrl, prompt });

                if (this.autoDownloadEnabled) {
                    downloadFile(videoUrl, `video_${prompt.substring(0, 20).replace(/\s/g, '_')}_${index}.mp4`);
                }

                const videoItem = document.createElement('div');
                videoItem.className = 'video-result-item';
                videoItem.innerHTML = `
                  <video src="${videoUrl}" controls autoplay loop muted></video>
                  <div class="result-info">
                      <p>${prompt}</p>
                      <button class="secondary-button download-button">
                          <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                          <span>Download</span>
                      </button>
                  </div>`;
                videoItem.querySelector('.download-button')?.addEventListener('click', () => downloadFile(videoUrl, `video_${prompt.substring(0, 15).replace(/\s/g, '_')}.mp4`));
                this.batchOutputGrid.appendChild(videoItem);

                if (index < prompts.length - 1 && this.isBatchProcessRunning) {
                    await this.interruptibleDelay(this.batchVideoDelaySeconds * 1000, updateStatus);
                }

            } catch (e: any) {
                console.error(`Failed to generate video for prompt "${prompt}" after all retries:`, e);
                const errorItem = document.createElement('div');
                errorItem.className = 'video-result-item-failed';
                errorItem.innerHTML = `<strong>Failed</strong><p>${prompt}</p>`;
                this.batchOutputGrid.appendChild(errorItem);
                updateStatus(`[${index + 1}/${prompts.length}] Generation failed.`);
                 if (index < prompts.length - 1 && this.isBatchProcessRunning) {
                    await this.interruptibleDelay(this.batchVideoDelaySeconds * 1000, updateStatus);
                }
            } finally {
                const progress = ((index + 1) / prompts.length) * 100;
                this.batchProgressBar.style.width = `${progress}%`;
            }
        }
    } finally {
        this.isBatchProcessRunning = false;
        updateStatus(this.batchStatus.innerText.includes('stopped') ? 'Batch process stopped.' : 'Batch generation complete.');
        this.setLoading(false, true);
        if (this.batchVideoResults.length > 0) {
            this.batchActionsContainer.style.display = 'flex';
        }
        await delay(1500);
        this.batchProgressWrapper.style.display = 'none';
        this.batchStatus.innerText = 'Ready for batch generation.';
    }
  },

  async downloadAllBatchVideos() {
    if (this.batchVideoResults.length === 0) return;

    this.downloadAllButton.disabled = true;
    const span = this.downloadAllButton.querySelector('span')!;
    const originalText = span.innerText;
    
    for (const [index, result] of this.batchVideoResults.entries()) {
        span.innerText = `Downloading ${index + 1}/${this.batchVideoResults.length}...`;
        downloadFile(result.url, `video_${result.prompt.substring(0, 20).replace(/\s/g, '_')}_${index}.mp4`);
        await delay(500); // Videos are larger, maybe a slightly longer delay
    }

    span.innerText = originalText;
    this.downloadAllButton.disabled = false;
  },

  // Called from index.tsx
  loadImageFromEditor(imageUrl: string) {
    this.imagePreview.src = imageUrl;
    this.imagePreview.classList.remove('image-preview-hidden');
    this.clearImageButton.style.display = 'flex';
    this.base64Data = imageUrl.split(',')[1];
    this.statusEl.innerText = 'Image from NanaLingLung loaded successfully.';
  }
};