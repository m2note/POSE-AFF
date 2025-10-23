/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { delay, parseAndFormatErrorMessage, withGenericRetry, withRetry, downloadFile } from "../utils/helpers.js";
import { generateImageContent } from "../utils/gemini.js";

const estesSoloLordLoadingMessages = [
    'Sketching initial concepts...',
    'Mixing digital paints...',
    'Adding primary details...',
    'Applying lighting and shadows...',
    'Rendering the final image...',
];

export const ImageGenerator = {
  // DOM Elements
  promptEl: document.querySelector('#estes-sololord-prompt-input') as HTMLTextAreaElement,
  aspectRatioButtons: document.querySelectorAll('.aspect-ratio-button'),
  modelQualityButtons: document.querySelectorAll('.model-quality-button'),
  generateButton: document.querySelector('#generate-estes-sololord-button') as HTMLButtonElement,
  statusEl: document.querySelector('#estes-sololord-status') as HTMLParagraphElement,
  progressWrapper: document.querySelector('#estes-sololord-progress-wrapper') as HTMLDivElement,
  progressBar: document.querySelector('#estes-sololord-progress-bar') as HTMLDivElement,
  outputImage: document.querySelector('#estes-sololord-output-image') as HTMLImageElement,
  outputPlaceholder: document.querySelector('#estes-sololord-output-placeholder') as HTMLSpanElement,
  previewButton: document.querySelector('#preview-estes-sololord-button') as HTMLButtonElement,
  downloadButton: document.querySelector('#download-estes-sololord-button') as HTMLButtonElement,
  autoDownloadToggle: document.querySelector('#estes-auto-download') as HTMLInputElement,
  
  // Batch DOM Elements
  soloModeButton: document.querySelector('#estes-mode-solo-button') as HTMLButtonElement,
  batchModeButton: document.querySelector('#estes-mode-batch-button') as HTMLButtonElement,
  soloPanel: document.querySelector('#estes-sololord-solo-panel') as HTMLDivElement,
  batchPanel: document.querySelector('#estes-sololord-batch-panel') as HTMLDivElement,
  batchSettings: document.querySelector('#batch-estes-sololord-settings') as HTMLDivElement,
  batchPromptInput: document.querySelector('#batch-estes-sololord-prompt-input') as HTMLTextAreaElement,
  batchPromptCounter: document.querySelector('#batch-estes-sololord-prompt-counter') as HTMLSpanElement,
  batchAspectRatioButtons: document.querySelectorAll('.batch-aspect-ratio-button'),
  batchModelQualityButtons: document.querySelectorAll('.batch-model-quality-button'),
  batchDelayInput: document.querySelector('#batch-image-delay-input') as HTMLInputElement,
  generateBatchButton: document.querySelector('#generate-batch-estes-sololord-button') as HTMLButtonElement,
  stopBatchButton: document.querySelector('#stop-batch-estes-sololord-button') as HTMLButtonElement,
  batchStatus: document.querySelector('#batch-estes-sololord-status') as HTMLParagraphElement,
  batchProgressWrapper: document.querySelector('#batch-estes-sololord-progress-wrapper') as HTMLDivElement,
  batchProgressBar: document.querySelector('#batch-estes-sololord-progress-bar') as HTMLDivElement,
  batchOutputContainer: document.querySelector('#batch-estes-sololord-output-container') as HTMLDivElement,
  batchOutputGrid: document.querySelector('#batch-estes-sololord-output-grid') as HTMLDivElement,
  batchActionsContainer: document.querySelector('#batch-estes-sololord-actions') as HTMLDivElement,
  downloadAllButton: document.querySelector('#download-all-estes-sololord-button') as HTMLButtonElement,

  // State
  prompt: '',
  aspectRatio: '1:1',
  model: 'imagen-4.0-generate-001',
  outputFormat: 'image/jpeg' as 'image/png' | 'image/jpeg',
  outputImageUrl: null as string | null,
  isBatchRunning: false,
  batchAspectRatio: '1:1',
  batchModel: 'imagen-4.0-generate-001',
  batchDelaySeconds: 5,
  isLoading: false,
  autoDownloadEnabled: false,
  batchResults: [] as { url: string; prompt: string; }[],

  // Dependencies
  getApiKey: (() => '') as () => string,
  showPreviewModal: ((url: string | null) => {}) as (url: string | null) => void,

  init(dependencies: { getApiKey: () => string; showPreviewModal: (url: string | null) => void; }) {
    this.getApiKey = dependencies.getApiKey;
    this.showPreviewModal = dependencies.showPreviewModal;

    this.promptEl.addEventListener('input', () => this.prompt = this.promptEl.value);
    this.generateButton.addEventListener('click', () => this.generateImage());
    this.previewButton.addEventListener('click', () => this.showPreviewModal(this.outputImageUrl));
    this.downloadButton.addEventListener('click', () => this.downloadGeneratedImage());
    this.autoDownloadToggle.addEventListener('change', () => {
        this.autoDownloadEnabled = this.autoDownloadToggle.checked;
    });
    this.autoDownloadEnabled = this.autoDownloadToggle.checked;
    
    this.aspectRatioButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.aspectRatioButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.aspectRatio = (button as HTMLElement).dataset.ratio || '1:1';
        });
    });

    this.modelQualityButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.modelQualityButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.model = (button as HTMLElement).dataset.model || 'imagen-4.0-generate-001';
        });
    });
    
    // Batch listeners
    this.soloModeButton.addEventListener('click', () => this.setMode('solo'));
    this.batchModeButton.addEventListener('click', () => this.setMode('batch'));
    this.generateBatchButton.addEventListener('click', () => this.generateBatchImages());
    this.batchPromptInput.addEventListener('input', () => this.updateBatchPromptCounter());
    this.stopBatchButton.addEventListener('click', () => { this.isBatchRunning = false; });
    this.downloadAllButton.addEventListener('click', () => this.downloadAllBatchImages());
    this.batchDelayInput?.addEventListener('input', () => {
        this.batchDelaySeconds = this.batchDelayInput.valueAsNumber || 5;
    });
    this.batchAspectRatioButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.batchAspectRatioButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.batchAspectRatio = (button as HTMLElement).dataset.ratio || '1:1';
        });
    });
    this.batchModelQualityButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.batchModelQualityButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.batchModel = (button as HTMLElement).dataset.model || 'imagen-4.0-generate-001';
        });
    });
    
    this.setMode('solo');
    this.updateActionButtonsState();
    this.updateBatchPromptCounter();
  },

  setLoading(loading: boolean, isBatch: boolean = false) {
    this.isLoading = loading;
    if (isBatch) {
      this.generateBatchButton.disabled = loading;
      this.generateBatchButton.style.display = this.isBatchRunning ? 'none' : 'flex';
      this.stopBatchButton.style.display = this.isBatchRunning ? 'flex' : 'none';
      if (loading) {
        this.batchActionsContainer.style.display = 'none';
      }
    } else {
      this.generateButton.disabled = loading;
      this.promptEl.disabled = loading;
      this.aspectRatioButtons.forEach(b => (b as HTMLButtonElement).disabled = loading);
      this.modelQualityButtons.forEach(b => (b as HTMLButtonElement).disabled = loading);

      if (loading) {
        this.progressWrapper.style.display = 'block';
        this.progressBar.style.width = '0%';
        this.outputImageUrl = null;
        this.outputImage.src = '#';
        this.outputImage.classList.add('image-preview-hidden');
        this.outputPlaceholder.style.display = 'block';
      }
    }
    this.updateActionButtonsState();
  },

  updateActionButtonsState() {
    const hasOutput = !!this.outputImageUrl;
    this.previewButton.disabled = !hasOutput || this.isLoading;
    this.downloadButton.disabled = !hasOutput || this.isLoading;
  },
  
  downloadGeneratedImage() {
    if (this.outputImageUrl) {
      const mimeType = this.outputImageUrl.split(';')[0].split(':')[1];
      const extension = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : 'png';
      downloadFile(this.outputImageUrl, `generated-image.${extension}`);
    }
  },

  async generateImage() {
    if (this.prompt.trim() === '') {
      this.statusEl.innerText = 'Please enter a prompt.';
      return;
    }
    this.setLoading(true);

    let messageIndex = 0;
    const totalSteps = estesSoloLordLoadingMessages.length;
    let statusInterval: number;

    const updateStatus = (message: string, step?: number) => {
      this.statusEl.innerText = message;
      if (step !== undefined && this.progressBar) {
        const progress = Math.min(95, Math.max(0, (step / totalSteps) * 100));
        this.progressBar.style.width = `${progress}%`;
      }
    };
    
    updateStatus('Initializing image generation...', 0);

    statusInterval = window.setInterval(() => {
        messageIndex++;
        updateStatus(estesSoloLordLoadingMessages[messageIndex % totalSteps], messageIndex);
    }, 2000);

    try {
      const base64Image = await withRetry(
          () => generateImageContent(this.prompt, this.aspectRatio, this.model, this.outputFormat, this.getApiKey),
          {
              retries: 10,
              delayMs: 2000,
              onRetry: (attempt) => {
                  updateStatus(`Quota limit reached. Retrying... (Attempt ${attempt}/10)`);
              }
          }
      );
        
      clearInterval(statusInterval);
      this.progressBar.style.width = '100%';
      updateStatus(`Image generated successfully!`);
      
      this.outputImageUrl = `data:${this.outputFormat};base64,${base64Image}`;
      this.outputImage.src = this.outputImageUrl;
      this.outputImage.classList.remove('image-preview-hidden');
      this.outputPlaceholder.style.display = 'none';

      if (this.autoDownloadEnabled) {
          this.downloadGeneratedImage();
      }

    } catch (e: any) {
      clearInterval(statusInterval);
      const errorMessage = parseAndFormatErrorMessage(e, 'Image generation');
      console.error(`Error during image generation:`, e);
      updateStatus(errorMessage);
      this.progressBar.style.width = '0%';
    } finally {
      await delay(1500);
      this.setLoading(false);
      this.progressWrapper.style.display = 'none';
      this.statusEl.innerText = 'Ready for generation.';
    }
  },

  // Batch Methods
  setMode(mode: 'solo' | 'batch') {
    if (mode === 'solo') {
      this.soloPanel.style.display = 'block';
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

  updateBatchPromptCounter() {
    const count = this.batchPromptInput.value.split('\n').filter(p => p.trim()).length;
    this.batchPromptCounter.innerText = `${count} / 10`;
    this.batchPromptCounter.style.color = count > 10 ? 'var(--color-primary)' : 'var(--color-text-muted)';
  },

  async interruptibleImageDelay(ms: number, updateStatus: (message: string) => void): Promise<void> {
    return new Promise((resolve) => {
        let secondsLeft = Math.ceil(ms / 1000);
        const interval = setInterval(() => {
            if (!this.isBatchRunning) {
                clearInterval(interval);
                resolve();
                return;
            }
            secondsLeft--;
            updateStatus(`Next image in ${secondsLeft}s... (Click STOP to cancel)`);
            if (secondsLeft <= 0) {
                clearInterval(interval);
                resolve();
            }
        }, 1000);
        updateStatus(`Next image in ${secondsLeft}s... (Click STOP to cancel)`);
    });
  },

  async generateBatchImages() {
    const prompts = this.batchPromptInput.value.split('\n').map(p => p.trim()).filter(p => p).slice(0, 10);
    if (prompts.length === 0) {
        this.batchStatus.innerText = 'Please enter at least one prompt.';
        return;
    }

    this.isBatchRunning = true;
    this.batchResults = [];
    this.setLoading(true, true);
    this.batchOutputGrid.innerHTML = '';
    this.batchOutputContainer.style.display = 'block';
    
    this.batchSettings.style.display = 'none';
    this.batchProgressWrapper.style.display = 'block';
    this.batchProgressBar.style.width = '0%';

    const updateStatus = (message: string) => {
        this.batchStatus.innerText = message;
    };

    try {
        for (const [index, prompt] of prompts.entries()) {
            if (!this.isBatchRunning) {
                updateStatus('Batch process stopped by user.');
                break;
            }

            updateStatus(`[${index + 1}/${prompts.length}] Generating: Waiting`);
            
            try {
                const generateFn = () => generateImageContent(prompt, this.batchAspectRatio, this.batchModel, 'image/jpeg', this.getApiKey);
                const base64Image = await withGenericRetry(generateFn, {
                    retries: 5,
                    delayMs: this.batchDelaySeconds * 1000,
                    onRetry: (attempt) => {
                        updateStatus(`[${index + 1}/${prompts.length}] Failed. Retrying in ${this.batchDelaySeconds}s... (Attempt ${attempt}/5)`);
                    }
                });

                const imageUrl = `data:image/jpeg;base64,${base64Image}`;
                this.batchResults.push({ url: imageUrl, prompt });

                if (this.autoDownloadEnabled) {
                    downloadFile(imageUrl, `image_${prompt.substring(0, 20).replace(/\s/g, '_')}_${index}.jpg`);
                }

                const imageItem = document.createElement('div');
                imageItem.className = 'image-result-item';
                imageItem.innerHTML = `
                  <img src="${imageUrl}" alt="Generated image for: ${prompt}">
                  <div class="result-info">
                    <p>${prompt}</p>
                    <button class="secondary-button download-button">
                      <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                      <span>Download</span>
                    </button>
                  </div>`;
                imageItem.querySelector('.download-button')?.addEventListener('click', () => downloadFile(imageUrl, `image_${prompt.substring(0, 15).replace(/\s/g, '_')}.jpg`));
                this.batchOutputGrid.appendChild(imageItem);

            } catch (e: any) {
                console.error(`Failed to generate image for prompt "${prompt}" after all retries:`, e);
                const errorItem = document.createElement('div');
                errorItem.className = 'image-result-item-failed';
                errorItem.innerHTML = `<strong>Failed</strong><p>${prompt}</p>`;
                this.batchOutputGrid.appendChild(errorItem);
                updateStatus(`[${index + 1}/${prompts.length}] Generation failed.`);
            }

            const progress = ((index + 1) / prompts.length) * 100;
            this.batchProgressBar.style.width = `${progress}%`;
            
            if (index < prompts.length - 1 && this.isBatchRunning) {
                await this.interruptibleImageDelay(this.batchDelaySeconds * 1000, updateStatus);
            }
        }
    } finally {
        this.isBatchRunning = false;
        updateStatus(this.batchStatus.innerText.includes('stopped') ? 'Batch process stopped.' : 'Batch generation complete.');
        this.setLoading(false, true);
        
        if (this.batchResults.length > 0) {
            this.batchActionsContainer.style.display = 'flex';
        }
        
        await delay(1500);
        this.batchProgressWrapper.style.display = 'none';
        this.batchSettings.style.display = 'block';
        this.batchStatus.innerText = 'Ready for batch generation.';
    }
  },

  async downloadAllBatchImages() {
    if (this.batchResults.length === 0) return;

    this.downloadAllButton.disabled = true;
    const span = this.downloadAllButton.querySelector('span')!;
    const originalText = span.innerText;
    
    for (const [index, result] of this.batchResults.entries()) {
        span.innerText = `Downloading ${index + 1}/${this.batchResults.length}...`;
        downloadFile(result.url, `image_${result.prompt.substring(0, 20).replace(/\s/g, '_')}_${index}.jpg`);
        await delay(300); // Prevent browser blocking
    }

    span.innerText = originalText;
    this.downloadAllButton.disabled = false;
  }
};