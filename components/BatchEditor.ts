/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { blobToDataUrl, delay, downloadFile, parseAndFormatErrorMessage, withGenericRetry } from "../utils/helpers.js";
import { generateImageEditContent } from "../utils/gemini.js";

// Type definitions
type EditResult = {
    status: 'pending' | 'done' | 'error';
    imageUrl: string | null;
    errorMessage?: string;
};

export const BatchEditor = {
  // DOM Elements
  uploadButton: document.querySelector('#batch-editor-upload-button') as HTMLButtonElement,
  fileInput: document.querySelector('#batch-editor-file-input') as HTMLInputElement,
  fileList: document.querySelector('#batch-editor-file-list') as HTMLDivElement,
  promptInput: document.querySelector('#batch-editor-prompt-input') as HTMLTextAreaElement,
  promptCounter: document.querySelector('#batch-editor-prompt-counter') as HTMLSpanElement,
  generateButton: document.querySelector('#generate-batch-edit-button') as HTMLButtonElement,
  stopButton: document.querySelector('#stop-batch-edit-button') as HTMLButtonElement,
  statusEl: document.querySelector('#batch-editor-status') as HTMLParagraphElement,
  progressWrapper: document.querySelector('#batch-editor-progress-wrapper') as HTMLDivElement,
  progressBar: document.querySelector('#batch-editor-progress-bar') as HTMLDivElement,
  outputContainer: document.querySelector('#batch-editor-output-container') as HTMLDivElement,
  outputGrid: document.querySelector('#batch-editor-output-grid') as HTMLDivElement,
  actionsContainer: document.querySelector('#batch-editor-actions') as HTMLDivElement,
  downloadAllButton: document.querySelector('#download-all-batch-edit-button') as HTMLButtonElement,
  autoDownloadToggle: document.querySelector('#batch-editor-auto-download') as HTMLInputElement,
  
  // State
  files: [] as File[],
  prompts: [] as string[],
  isRunning: false,
  autoDownloadEnabled: false,
  results: [] as EditResult[][], // 2D array: results[fileIndex][promptIndex]
  concurrency: 2,
  
  // Dependencies
  getApiKey: (() => '') as () => string,
  showPreviewModal: ((url: string | null) => {}) as (url: string | null) => void,

  init(dependencies: { getApiKey: () => string; showPreviewModal: (url: string | null) => void; }) {
    this.getApiKey = dependencies.getApiKey;
    this.showPreviewModal = dependencies.showPreviewModal;

    this.promptInput.addEventListener('input', () => this.updatePromptCounter());
    this.generateButton.addEventListener('click', () => this.generateEdits());
    this.stopButton.addEventListener('click', () => { this.isRunning = false; });
    this.uploadButton.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    this.downloadAllButton.addEventListener('click', () => this.downloadAll());
    this.outputGrid.addEventListener('click', (e) => this.handleGridClick(e));
    this.autoDownloadToggle.addEventListener('change', () => {
        this.autoDownloadEnabled = this.autoDownloadToggle.checked;
    });
    this.autoDownloadEnabled = this.autoDownloadToggle.checked;

    this.updatePromptCounter();
    this.updateGenerateButtonState();
  },

  updatePromptCounter() {
    this.prompts = this.promptInput.value.split('\n').map(p => p.trim()).filter(p => p);
    const count = this.prompts.length;
    this.promptCounter.innerText = `${count} / 20`;
    this.promptCounter.style.color = count > 20 ? 'var(--color-primary)' : 'var(--color-text-muted)';
    this.updateGenerateButtonState();
  },

  handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files) {
        this.files = [];
    } else {
        this.files = Array.from(input.files).slice(0, 20);
    }
    this.fileList.innerHTML = this.files.length > 0
      ? this.files.map(file => `<p>${file.name}</p>`).join('')
      : '<p>No images selected.</p>';
    this.updateGenerateButtonState();
  },
  
  updateGenerateButtonState() {
      const promptCount = this.promptInput.value.split('\n').filter(p => p.trim()).length;
      this.generateButton.disabled = this.isRunning || this.files.length === 0 || promptCount === 0;
  },
  
  setLoading(loading: boolean) {
      this.isRunning = loading;
      this.generateButton.style.display = loading ? 'none' : 'flex';
      this.stopButton.style.display = loading ? 'flex' : 'none';
      this.progressWrapper.style.display = loading ? 'block' : 'none';
      this.promptInput.disabled = loading;
      this.fileInput.disabled = loading;
      this.uploadButton.disabled = loading;
      if (loading) {
          this.actionsContainer.style.display = 'none';
          this.progressBar.style.width = '0%';
          this.outputContainer.style.display = 'block';
      }
      this.updateGenerateButtonState();
  },

  async generateEdits() {
    this.prompts = this.promptInput.value.split('\n').map(p => p.trim()).filter(p => p).slice(0, 20);
    if (this.prompts.length === 0 || this.files.length === 0) {
        this.statusEl.innerText = 'Please provide source images and editing prompts.';
        return;
    }

    this.setLoading(true);
    this.statusEl.innerText = 'Preparing jobs...';
    
    // Initialize results structure and UI placeholders
    this.results = Array(this.files.length).fill(0).map(() => Array(this.prompts.length).fill({ status: 'pending', imageUrl: null }));
    this.outputGrid.innerHTML = '';
    this.files.forEach((file, fileIndex) => {
        const group = document.createElement('div');
        group.className = 'batch-edit-result-group';
        group.innerHTML = `<h3>${file.name}</h3>`;

        const grid = document.createElement('div');
        grid.className = 'image-results-grid';
        grid.id = `batch-edit-grid-${fileIndex}`;
        
        this.prompts.forEach((prompt, promptIndex) => {
            const placeholder = document.createElement('div');
            placeholder.className = 'image-result-item productshot-result-item-text-state';
            placeholder.id = `batch-edit-job-${fileIndex}-${promptIndex}`;
            placeholder.innerHTML = `<p class="productshot-item-subtitle" title="${prompt}">Pending: ${prompt}</p>`;
            grid.appendChild(placeholder);
        });

        group.appendChild(grid);
        this.outputGrid.appendChild(group);
    });

    // Create a flat list of jobs to run
    const jobs: { fileIndex: number, promptIndex: number }[] = [];
    for (let i = 0; i < this.files.length; i++) {
        for (let j = 0; j < this.prompts.length; j++) {
            jobs.push({ fileIndex: i, promptIndex: j });
        }
    }

    let completedJobs = 0;
    const totalJobs = jobs.length;

    const runJob = async (job: { fileIndex: number, promptIndex: number }) => {
        if (!this.isRunning) return;

        const { fileIndex, promptIndex } = job;
        const placeholder = document.querySelector(`#batch-edit-job-${fileIndex}-${promptIndex}`);
        if (!placeholder) return;
        
        try {
            const file = this.files[fileIndex];
            const prompt = this.prompts[promptIndex];
            
            const dataUrl = await blobToDataUrl(file);
            const imageBytes = dataUrl.split(',')[1];

            const generateFn = () => generateImageEditContent(prompt, imageBytes, '', null, this.getApiKey);
            const response = await withGenericRetry(generateFn, {
                retries: 5,
                delayMs: 2000,
                onRetry: (attempt) => {
                    if (this.isRunning && placeholder.firstChild) {
                       (placeholder.firstChild as HTMLElement).innerText = `Retry ${attempt}/5: ${prompt}`;
                    }
                }
            });

            if (!this.isRunning) return;

            const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
            if (!imagePart?.inlineData) throw new Error("No image data in response.");

            const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            this.results[fileIndex][promptIndex] = { status: 'done', imageUrl };

            if (this.autoDownloadEnabled) {
                downloadFile(imageUrl, `edit_${file.name}_${prompt.substring(0, 20).replace(/\s/g, '_')}.png`);
            }

            const resultItem = document.createElement('div');
            resultItem.className = 'image-result-item';
            resultItem.innerHTML = `
              <img src="${imageUrl}" alt="Edited image for: ${prompt}">
              <div class="productshot-result-item-overlay">
                 <button class="icon-button productshot-preview-single" data-file-index="${fileIndex}" data-prompt-index="${promptIndex}" aria-label="Preview image">
                    <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 10c-2.48 0-4.5-2.02-4.5-4.5S9.52 5.5 12 5.5s4.5 2.02 4.5 4.5-2.02 4.5-4.5 4.5zm0-7C10.62 7.5 9.5 8.62 9.5 10s1.12 2.5 2.5 2.5 2.5-1.12 2.5-2.5S13.38 7.5 12 7.5z"/></svg>
                 </button>
                 <button class="icon-button productshot-download-single" data-file-index="${fileIndex}" data-prompt-index="${promptIndex}" aria-label="Download image">
                    <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                 </button>
              </div>`;
            placeholder.replaceWith(resultItem);

        } catch(e: any) {
            this.results[fileIndex][promptIndex] = { status: 'error', imageUrl: null, errorMessage: e.message };
            const errorItem = document.createElement('div');
            errorItem.className = 'image-result-item-failed';
            errorItem.innerHTML = `<strong>Failed</strong><p title="${this.prompts[promptIndex]}">${this.prompts[promptIndex]}</p>`;
            placeholder.replaceWith(errorItem);
        } finally {
            if (this.isRunning) {
                completedJobs++;
                const progress = (completedJobs / totalJobs) * 100;
                this.progressBar.style.width = `${progress}%`;
                this.statusEl.innerText = `Processing... (${completedJobs}/${totalJobs})`;
            }
        }
    };
    
    // Run jobs with concurrency
    for (let i = 0; i < jobs.length; i += this.concurrency) {
        if (!this.isRunning) break;
        const chunk = jobs.slice(i, i + this.concurrency);
        await Promise.all(chunk.map((job) => runJob(job)));
    }

    this.statusEl.innerText = 'All edits complete!';
    if (!this.isRunning) {
        this.statusEl.innerText = 'Batch editing stopped.';
    }
    
    this.setLoading(false);
    if (this.results.flat().some(r => r.status === 'done')) {
        this.actionsContainer.style.display = 'flex';
    }
  },

  // FIX: Cast button element to HTMLElement to safely access dataset property.
  handleGridClick(e: MouseEvent) {
    const button = (e.target as HTMLElement).closest('button.icon-button');
    if (!button) return;

    const htmlButton = button as HTMLElement;
    const fileIndex = parseInt(htmlButton.dataset.fileIndex!, 10);
    const promptIndex = parseInt(htmlButton.dataset.promptIndex!, 10);
    const result = this.results[fileIndex]?.[promptIndex];

    if (result?.imageUrl) {
        if (button.classList.contains('productshot-preview-single')) {
            this.showPreviewModal(result.imageUrl);
        } else if (button.classList.contains('productshot-download-single')) {
            const file = this.files[fileIndex];
            const prompt = this.prompts[promptIndex];
            downloadFile(result.imageUrl, `edit_${file.name}_${prompt.substring(0, 15).replace(/\s/g, '_')}.png`);
        }
    }
  },

  async downloadAll() {
    this.downloadAllButton.disabled = true;
    const span = this.downloadAllButton.querySelector('span')!;
    const originalText = span.innerText;
    let successfulDownloads = 0;
    const totalSuccessful = this.results.flat().filter(r => r.status === 'done').length;

    for (let i = 0; i < this.results.length; i++) {
        for (let j = 0; j < this.results[i].length; j++) {
            const result = this.results[i][j];
            if (result.status === 'done' && result.imageUrl) {
                successfulDownloads++;
                span.innerText = `Downloading ${successfulDownloads}/${totalSuccessful}...`;
                const file = this.files[i];
                const prompt = this.prompts[j];
                downloadFile(result.imageUrl, `edit_${file.name}_${prompt.substring(0, 15).replace(/\s/g, '_')}.png`);
                await delay(300);
            }
        }
    }
    span.innerText = originalText;
    this.downloadAllButton.disabled = false;
  },
};