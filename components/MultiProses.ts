/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { blobToDataUrl, delay, downloadFile, parseAndFormatErrorMessage, withGenericRetry } from "../utils/helpers.js";
import { generateVideoContent } from "../utils/gemini.js";

export const MultiProses = {
  // DOM Elements
  promptInput: document.querySelector('#multi-proses-prompt-input') as HTMLTextAreaElement,
  promptCounter: document.querySelector('#multi-proses-prompt-counter') as HTMLSpanElement,
  modelButtons: document.querySelectorAll('.multi-proses-model-button'),
  aspectRatioButtons: document.querySelectorAll('.multi-proses-aspect-ratio-button'),
  aspect169Button: document.querySelector('#multi-proses-aspect-16-9') as HTMLButtonElement,
  aspect916Button: document.querySelector('#multi-proses-aspect-9-16') as HTMLButtonElement,
  modeButtons: document.querySelectorAll('.multi-proses-mode-button'),
  concurrencyButtons: document.querySelectorAll('.multi-proses-concurrency-button'),
  imagePanel: document.querySelector('#multi-proses-image-panel') as HTMLDivElement,
  uploadButton: document.querySelector('#multi-proses-upload-button') as HTMLButtonElement,
  fileInput: document.querySelector('#multi-proses-file-input') as HTMLInputElement,
  fileList: document.querySelector('#multi-proses-file-list') as HTMLDivElement,
  generateButton: document.querySelector('#generate-multi-proses-button') as HTMLButtonElement,
  stopButton: document.querySelector('#stop-multi-proses-button') as HTMLButtonElement,
  statusEl: document.querySelector('#multi-proses-status') as HTMLParagraphElement,
  progressWrapper: document.querySelector('#multi-proses-progress-wrapper') as HTMLDivElement,
  progressBar: document.querySelector('#multi-proses-progress-bar') as HTMLDivElement,
  outputContainer: document.querySelector('#multi-proses-output-container') as HTMLDivElement,
  outputGrid: document.querySelector('#multi-proses-output-grid') as HTMLDivElement,
  actionsContainer: document.querySelector('#multi-proses-actions') as HTMLDivElement,
  downloadAllButton: document.querySelector('#download-all-multi-proses-button') as HTMLButtonElement,
  autoDownloadToggle: document.querySelector('#multi-proses-auto-download') as HTMLInputElement,
  
  // State
  model: 'veo-2.0-generate-001',
  aspectRatio: '16:9',
  mode: 'text-to-video' as 'text-to-video' | 'image-to-video',
  concurrency: 2,
  files: [] as File[],
  isRunning: false,
  autoDownloadEnabled: false,
  jobResults: [] as { url: string; prompt: string; }[],
  
  // Dependencies
  getApiKey: (() => '') as () => string,

  init(dependencies: { getApiKey: () => string; }) {
    this.getApiKey = dependencies.getApiKey;

    // Listeners
    this.promptInput.addEventListener('input', () => this.updatePromptCounter());
    this.generateButton.addEventListener('click', () => this.generateVideos());
    this.stopButton.addEventListener('click', () => { this.isRunning = false; });
    this.uploadButton.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    this.downloadAllButton.addEventListener('click', () => this.downloadAllMultiProsesVideos());
    this.autoDownloadToggle.addEventListener('change', () => {
        this.autoDownloadEnabled = this.autoDownloadToggle.checked;
    });
    this.autoDownloadEnabled = this.autoDownloadToggle.checked;

    this.modelButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.modelButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.model = (button as HTMLElement).dataset.model!;
            if (this.model.includes('veo-3.0')) {
                this.aspectRatio = '16:9';
                this.aspect169Button.classList.add('active');
                this.aspect916Button.classList.remove('active');
                this.aspect916Button.disabled = true;
            } else {
                this.aspect916Button.disabled = false;
            }
        });
    });

    this.aspectRatioButtons.forEach(button => {
        button.addEventListener('click', () => {
            if ((button as HTMLButtonElement).disabled) return;
            this.aspectRatioButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.aspectRatio = (button as HTMLElement).dataset.ratio!;
        });
    });

    this.modeButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.modeButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.mode = (button as HTMLElement).dataset.mode as 'text-to-video' | 'image-to-video';
            this.imagePanel.style.display = this.mode === 'image-to-video' ? 'flex' : 'none';
        });
    });

    this.concurrencyButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.concurrencyButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.concurrency = parseInt((button as HTMLElement).dataset.concurrency!, 10) || 2;
        });
    });

    this.updatePromptCounter();
  },

  updatePromptCounter() {
    const count = this.promptInput.value.split('\n').filter(p => p.trim()).length;
    this.promptCounter.innerText = `${count} / 20`;
    this.promptCounter.style.color = count > 20 ? 'var(--color-primary)' : 'var(--color-text-muted)';
  },

  handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files) {
        this.files = [];
        this.fileList.innerHTML = '<p>No images selected.</p>';
        return;
    }
    this.files = Array.from(input.files).slice(0, 20);
    this.fileList.innerHTML = this.files.length > 0
      ? this.files.map(file => `<p>${file.name}</p>`).join('')
      : '<p>No images selected.</p>';
  },

  async generateVideos() {
    const prompts = this.promptInput.value.split('\n').map(p => p.trim()).filter(p => p).slice(0, 20);
    if (prompts.length === 0) {
        this.statusEl.innerText = 'Please enter at least one prompt.';
        return;
    }

    this.isRunning = true;
    this.jobResults = [];
    this.actionsContainer.style.display = 'none';
    this.generateButton.style.display = 'none';
    this.stopButton.style.display = 'flex';
    this.generateButton.disabled = true;
    this.statusEl.innerText = 'Starting generation...';
    this.progressWrapper.style.display = 'block';
    this.progressBar.style.width = '0%';
    this.outputGrid.innerHTML = '';
    this.outputContainer.style.display = 'block';

    prompts.forEach((prompt, index) => {
        const placeholder = document.createElement('div');
        placeholder.className = 'video-result-item-pending';
        placeholder.id = `multi-proses-job-${index}`;
        placeholder.innerHTML = `
            <p class="prompt-text">${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}</p>
            <p class="status-text">Waiting to start...</p>
        `;
        this.outputGrid.appendChild(placeholder);
    });
    
    let completedJobs = 0;

    const runSingleJob = async (prompt: string, index: number) => {
        const jobPlaceholder = document.querySelector(`#multi-proses-job-${index}`)!;
        const statusText = jobPlaceholder.querySelector('.status-text') as HTMLParagraphElement;

        try {
            let currentModel = this.model;
            if (index >= 8) { // After 8 videos, swap models if they are V3
                if (this.model === 'veo-3.0-fast-generate-preview') currentModel = 'veo-3.0-generate-preview';
                else if (this.model === 'veo-3.0-generate-preview') currentModel = 'veo-3.0-fast-generate-preview';
            }

            const imageFile = this.mode === 'image-to-video' ? this.files[index] : undefined;
            let imageBytes = '';
            
            if (imageFile) {
                statusText.innerText = `Preparing image...`;
                const dataUrl = await blobToDataUrl(imageFile);
                imageBytes = dataUrl.split(',')[1];
            }

            const generateFn = () => generateVideoContent(prompt, imageBytes, this.aspectRatio, currentModel, this.getApiKey, (msg) => {
                 if (this.isRunning) statusText.innerText = msg;
            });

            const videoUrl = await withGenericRetry(generateFn, {
                retries: 10,
                delayMs: 2000,
                onRetry: (attempt) => {
                    if (this.isRunning) statusText.innerText = `Failed. Retrying in 2s... (${attempt}/10)`;
                }
            });

            if (!this.isRunning) return;
            
            this.jobResults.push({ url: videoUrl, prompt });
            if (this.autoDownloadEnabled) {
                downloadFile(videoUrl, `multi-proses_${prompt.substring(0, 20).replace(/\s/g, '_')}_${index}.mp4`);
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
                </div>
            `;
            videoItem.querySelector('.download-button')?.addEventListener('click', () => downloadFile(videoUrl, `video_${prompt.substring(0, 15).replace(/\s/g, '_')}.mp4`));
            jobPlaceholder.replaceWith(videoItem);

        } catch (e: any) {
            if (!this.isRunning) return;
            console.error(`Failed to generate video for prompt "${prompt}" after all retries:`, e);
            const errorItem = document.createElement('div');
            errorItem.className = 'video-result-item-failed';
            errorItem.innerHTML = `<strong>Failed</strong><p>${prompt}</p><p class="error-message">${parseAndFormatErrorMessage(e, 'Generation')}</p>`;
            jobPlaceholder.replaceWith(errorItem);
        } finally {
             if (this.isRunning) {
                completedJobs++;
                const progress = (completedJobs / prompts.length) * 100;
                this.progressBar.style.width = `${progress}%`;
            }
        }
    };
    
    try {
        for (let i = 0; i < prompts.length; i += this.concurrency) {
            if (!this.isRunning) {
                this.statusEl.innerText = 'Process stopped by user.';
                break;
            }

            const batchNumber = (i / this.concurrency) + 1;
            const totalBatches = Math.ceil(prompts.length / this.concurrency);
            this.statusEl.innerText = `Processing batch ${batchNumber} of ${totalBatches}...`;

            const chunk = prompts.slice(i, i + this.concurrency);
            const chunkPromises = chunk.map((prompt, chunkIndex) => {
                return runSingleJob(prompt, i + chunkIndex);
            });
            
            await Promise.all(chunkPromises);

            if (i + this.concurrency < prompts.length && this.isRunning) {
                this.statusEl.innerText = `Batch ${batchNumber} complete. Waiting 5 seconds...`;
                await delay(5000);
            }
        }
    } finally {
        this.statusEl.innerText = this.isRunning ? 'All generation tasks complete.' : 'Process stopped.';
        this.isRunning = false;
        this.generateButton.disabled = false;
        this.generateButton.style.display = 'flex';
        this.stopButton.style.display = 'none';
        this.progressWrapper.style.display = 'none';
        if (this.jobResults.length > 0) {
            this.actionsContainer.style.display = 'flex';
        }
    }
  },

  async downloadAllMultiProsesVideos() {
    if (this.jobResults.length === 0) return;

    this.downloadAllButton.disabled = true;
    const span = this.downloadAllButton.querySelector('span')!;
    const originalText = span.innerText;
    
    for (const [index, result] of this.jobResults.entries()) {
        span.innerText = `Downloading ${index + 1}/${this.jobResults.length}...`;
        downloadFile(result.url, `multi-proses_${result.prompt.substring(0, 20).replace(/\s/g, '_')}_${index}.mp4`);
        await delay(500);
    }

    span.innerText = originalText;
    this.downloadAllButton.disabled = false;
  },
};