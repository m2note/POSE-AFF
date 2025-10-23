/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { blobToDataUrl, delay, downloadFile, parseAndFormatErrorMessage, setupDragAndDrop, withGenericRetry } from "../utils/helpers.js";
import { generateStyledImage, generateVideoContent } from "../utils/gemini.js";

const PRODUCT_STYLE_THEMES = [
    'Minimalist background with soft lighting',
    'In a vibrant, colorful scene',
    'In a dynamic, action-oriented shot',
    'In an elegant studio setup',
    'In a natural outdoor setting',
    'With a high-tech, futuristic look',
];

const LOOKBOOK_PROMPTS = [
    'Recreate the image as a professional full-body fashion shot. The model should have a confident, straight-on pose, showcasing the product clearly. Place the subject in a clean, minimalist photo studio. If a person is in the original image, you must preserve their exact identity, including face, hair, and body features. Do not add accessories.',
    'Generate an image of the model in a walking pose, as if captured mid-stride. This should be a full-body or three-quarter shot from a slightly low angle to add dynamism. The setting is a clean, professional photo studio. It is essential to maintain the exact identity and appearance of any person from the original photo. The product must remain the focus. No extra accessories.',
    'Create a shot of the model in a relaxed, seated pose on a simple stool or block. This should be a three-quarter view, focusing on how the product looks in a natural, casual context. Use a clean, minimalist photo studio background. Preserve the exact likeness and identity of the person from the original image. The product should be well-lit and clearly visible. No accessories.',
    'Generate a clean profile (side) view of the subject, either standing or from the waist up, to highlight the product\'s silhouette. The background must be a seamless white setup in a professional photo studio. Preserve the exact likeness and identity of the person from the original image without any changes. No accessories.',
    'Produce a detailed close-up shot focusing on the product itself. If it\'s an apparel item, focus on the texture and fit on the model. If it\'s an accessory, make it the hero of the shot. The background should be a clean, minimalist photo studio. If a person is present, ensure their identity is identical to the original photo. Add no extra accessories.',
    'Create an "over the shoulder" shot where the model is looking back towards the camera. This pose is engaging and showcases the back or side of the product. Use a clean, minimalist photo studio setting. You must maintain the absolute identity of the person in the original photo across this new pose. No extra accessories.'
];

const MIX_STYLE_PROMPTS = [
    'A 3D render of this product on a simple background.',
    'A cartoon drawing of this product, vibrant and fun.',
    'A pop-art style image of this product with bold colors and dots.',
    'A watercolor painting of this product, soft and artistic.',
    'A pixel art version of this product, 8-bit retro style.',
    'An anime-style illustration of this product, clean lines and bright colors.'
];

type ProductShotState = 'idle' | 'image-uploaded' | 'generating' | 'results-shown';
type ProductShotMode = 'ProductStyle' | 'LookBook' | 'MixStyle';
type ImageResult = {
    prompt: string;
    status: 'pending' | 'done' | 'error' | 'video-generating' | 'video-done' | 'video-error';
    imageUrl: string | null;
    videoUrl?: string | null;
    errorMessage?: string;
    videoStatusText?: string;
};

export const ProductShotPro = {
  // DOM Elements
  idleState: document.querySelector('#productshot-idle-state') as HTMLDivElement,
  uploadedState: document.querySelector('#productshot-uploaded-state') as HTMLDivElement,
  resultsState: document.querySelector('#productshot-results-state') as HTMLDivElement,
  fileInput: document.querySelector('#productshot-file-input') as HTMLInputElement,
  previewImage: document.querySelector('#productshot-preview-image') as HTMLImageElement,
  customPromptInput: document.querySelector('#productshot-custom-prompt-input') as HTMLTextAreaElement,
  generateButton: document.querySelector('#productshot-generate-button') as HTMLButtonElement,
  changePhotoButton: document.querySelector('#productshot-change-photo-button') as HTMLButtonElement,
  resultsGrid: document.querySelector('#productshot-results-grid') as HTMLDivElement,
  albumActions: document.querySelector('#productshot-album-actions') as HTMLDivElement,
  downloadAlbumButton: document.querySelector('#productshot-download-album-button') as HTMLButtonElement,
  startOverButton: document.querySelector('#productshot-start-over-button') as HTMLButtonElement,
  statusEl: document.querySelector('#productshot-status') as HTMLParagraphElement,
  progressWrapper: document.querySelector('#productshot-progress-wrapper') as HTMLDivElement,
  progressBar: document.querySelector('#productshot-progress-bar') as HTMLDivElement,
  autoDownloadToggle: document.querySelector('#productshot-auto-download') as HTMLInputElement,
  // Mode Elements
  modeButtons: document.querySelectorAll('#productshot-pro-card .button-group .toggle-button'),
  productStyleSettings: document.querySelector('#productshot-productstyle-settings') as HTMLDivElement,
  themesContainer: document.querySelector('#productshot-themes-container') as HTMLDivElement,
  selectAll: document.querySelector('#productshot-select-all') as HTMLAnchorElement,
  deselectAll: document.querySelector('#productshot-deselect-all') as HTMLAnchorElement,

  // State
  state: 'idle' as ProductShotState,
  mode: 'ProductStyle' as ProductShotMode,
  sourceImage: null as string | null, // Base64 string
  sourceImageAspectRatio: null as string | null,
  customPrompt: '',
  imageResults: [] as ImageResult[],
  selectedThemes: [] as string[],
  autoDownloadEnabled: false,
  
  // Dependencies
  getApiKey: (() => '') as () => string,
  showPreviewModal: ((url: string | null) => {}) as (url: string | null) => void,

  init(dependencies: { getApiKey: () => string; showPreviewModal: (url: string | null) => void; }) {
    this.getApiKey = dependencies.getApiKey;
    this.showPreviewModal = dependencies.showPreviewModal;
    
    // Listeners
    this.fileInput.addEventListener('change', (e) => this.handleUpload(e));
    this.customPromptInput.addEventListener('input', () => {
        this.customPrompt = this.customPromptInput.value.trim();
    });
    setupDragAndDrop(document.querySelector('.productshot-uploader[for="productshot-file-input"]'), this.fileInput);
    this.changePhotoButton.addEventListener('click', () => this.fileInput.click());
    this.generateButton.addEventListener('click', () => this.runGeneration());
    this.resultsGrid.addEventListener('click', (e) => this.handleGridClick(e));
    this.downloadAlbumButton.addEventListener('click', () => this.handleDownloadAlbum());
    this.startOverButton.addEventListener('click', () => this.handleStartOver());
    
    this.autoDownloadToggle.addEventListener('change', () => {
        this.autoDownloadEnabled = this.autoDownloadToggle.checked;
    });
    this.autoDownloadEnabled = this.autoDownloadToggle.checked;

    // Mode switcher
    this.modeButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.modeButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            const buttonId = button.id;
            if (buttonId.includes('lookbook')) this.mode = 'LookBook';
            else if (buttonId.includes('mixstyle')) this.mode = 'MixStyle';
            else this.mode = 'ProductStyle';
            this.render();
            this.updateGenerateButton();
        });
    });

    this.selectAll?.addEventListener('click', (e) => {
        e.preventDefault();
        this.selectedThemes = [...PRODUCT_STYLE_THEMES];
        document.querySelectorAll('.theme-tag').forEach(btn => btn.classList.add('active'));
        this.updateGenerateButton();
    });
    this.deselectAll?.addEventListener('click', (e) => {
        e.preventDefault();
        this.selectedThemes = [];
        document.querySelectorAll('.theme-tag').forEach(btn => btn.classList.remove('active'));
        this.updateGenerateButton();
    });

    this.populateThemes();
    this.render();
    this.updateGenerateButton();
  },

  render() {
    this.idleState.style.display = this.state === 'idle' ? 'block' : 'none';
    this.uploadedState.style.display = this.state === 'image-uploaded' ? 'block' : 'none';
    this.resultsState.style.display = (this.state === 'generating' || this.state === 'results-shown') ? 'block' : 'none';
    this.albumActions.style.display = this.state === 'results-shown' ? 'flex' : 'none';
    this.productStyleSettings.style.display = this.mode === 'ProductStyle' ? 'block' : 'none';
    
    this.progressWrapper.style.display = this.state === 'generating' ? 'block' : 'none';

    if (this.state === 'image-uploaded' && this.sourceImage) {
        this.previewImage.src = `data:image/png;base64,${this.sourceImage}`;
    }

    if (this.state === 'generating' || this.state === 'results-shown') {
        this.resultsGrid.className = 'productshot-results-grid'; // Reset classes
        if (this.mode === 'LookBook') {
            this.resultsGrid.classList.add('lookbook-mode');
        } else if (this.mode === 'MixStyle') {
            this.resultsGrid.classList.add('mixstyle-mode');
        }

        if (this.sourceImageAspectRatio) {
            this.resultsGrid.style.setProperty('--product-shot-aspect-ratio', this.sourceImageAspectRatio);
        }

        this.resultsGrid.innerHTML = ''; // Clear previous results
        this.imageResults.forEach((result, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'productshot-result-wrapper';

            const item = document.createElement('div');
            item.className = 'productshot-result-item';

            const previewSVG = `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 10c-2.48 0-4.5-2.02-4.5-4.5S9.52 5.5 12 5.5s4.5 2.02 4.5 4.5-2.02 4.5-4.5 4.5zm0-7C10.62 7.5 9.5 8.62 9.5 10s1.12 2.5 2.5 2.5 2.5-1.12 2.5-2.5S13.38 7.5 12 7.5z"/></svg>`;
            const downloadSVG = `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
            const regenerateSVG = `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>`;

            let itemContentHTML = '';

            if (result.status === 'pending') {
                item.classList.add('productshot-result-item-text-state');
                itemContentHTML = `<span>Pending...</span><p class="productshot-item-subtitle">${result.prompt}</p>`;
            } else if (result.status === 'error') {
                item.classList.add('productshot-result-item-text-state');
                itemContentHTML = `<span>Error</span><p class="productshot-item-subtitle">${result.errorMessage || 'Failed'}</p>`;
            } else if (result.status === 'video-done' && result.videoUrl) {
                itemContentHTML = `
                    <video src="${result.videoUrl}" autoplay loop muted controls></video>
                    <div class="productshot-result-item-overlay">
                        <button class="icon-button productshot-download-single" data-index="${index}" aria-label="Download video">
                            ${downloadSVG}
                        </button>
                    </div>`;
            } else if (result.imageUrl) { // Covers 'done', 'video-generating', 'video-error'
                itemContentHTML = `
                    <img src="${result.imageUrl}" alt="Generated image for ${result.prompt}">
                    <div class="productshot-result-item-overlay">
                        <button class="icon-button productshot-preview-single" data-index="${index}" aria-label="Preview image">
                           ${previewSVG}
                        </button>
                        <button class="icon-button productshot-download-single" data-index="${index}" aria-label="Download image">
                           ${downloadSVG}
                        </button>
                        <button class="icon-button productshot-regenerate-single" data-index="${index}" aria-label="Regenerate image">
                           ${regenerateSVG}
                        </button>
                    </div>`;
                
                if (result.status === 'video-generating') {
                    itemContentHTML += `<div class="video-generation-status">${result.videoStatusText || 'Generating video...'}</div>`;
                }
                if (result.status === 'video-error') {
                    itemContentHTML += `<div class="video-generation-status" style="background-color: #dc3545; color: white;">Video Failed. Click below to retry.</div>`;
                }
            }
            item.innerHTML = itemContentHTML;
            wrapper.appendChild(item);

            if (this.mode === 'LookBook' && (result.status === 'done' || result.status === 'video-error')) {
                const videoSVG = `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>`;
                const actionsContainer = document.createElement('div');
                actionsContainer.className = 'lookbook-video-actions';
                
                const button = document.createElement('button');
                button.className = 'secondary-button lookbook-create-video-single';
                button.dataset.index = index.toString();
                button.innerHTML = `${videoSVG} <span>Buat Video</span>`;
                
                actionsContainer.appendChild(button);
                wrapper.appendChild(actionsContainer);
            }
            
            this.resultsGrid.appendChild(wrapper);
        });
    }

    this.updateStatusText();
  },

  updateStatusText() {
    switch (this.state) {
        case 'idle': this.statusEl.innerText = 'Upload a product image to start.'; break;
        case 'image-uploaded': this.statusEl.innerText = `Ready to generate with ${this.mode} mode.`; break;
        case 'generating':
            const doneCount = this.imageResults.filter(r => r.status !== 'pending' && r.status !== 'video-generating').length;
            this.statusEl.innerText = `Generating... (${doneCount}/${this.imageResults.length})`;
            break;
        case 'results-shown':
            const errorCount = this.imageResults.filter(r => r.status === 'error').length;
            const videoGeneratingCount = this.imageResults.filter(r => r.status === 'video-generating').length;
            if (videoGeneratingCount > 0) {
                this.statusEl.innerText = `Generating ${videoGeneratingCount} video(s)...`;
            } else {
                this.statusEl.innerText = `Generation complete. ${errorCount > 0 ? `${errorCount} failed.` : ''}`;
            }
            break;
    }
  },

  async handleUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
        const dataUrl = await blobToDataUrl(file);
        this.sourceImage = dataUrl.split(',')[1];
        
        const img = new Image();
        img.onload = () => {
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                this.sourceImageAspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
            }
        };
        img.src = dataUrl;

        this.state = 'image-uploaded';
        this.updateGenerateButton();
        this.render();
    } catch (error) {
        console.error('Error processing product shot image:', error);
        this.statusEl.innerText = 'Error processing image file.';
    }
  },

  runGeneration() {
      switch(this.mode) {
          case 'ProductStyle': this.runProductStyleGeneration(); break;
          case 'LookBook': this.runPromptBasedGeneration(LOOKBOOK_PROMPTS); break;
          case 'MixStyle': this.runPromptBasedGeneration(MIX_STYLE_PROMPTS); break;
      }
  },

  async runProductStyleGeneration() {
    if (!this.sourceImage) return;

    if (this.customPrompt) {
        // If custom prompt is used, generate N variations of it, where N is number of selected themes (or at least 1)
        const numVariations = this.selectedThemes.length > 0 ? this.selectedThemes.length : 1;
        const prompts = Array(numVariations).fill(this.customPrompt);
        await this.runPromptBasedGeneration(prompts);
        return;
    }
    
    if (this.selectedThemes.length === 0) {
        this.statusEl.innerText = 'Please select at least one theme.';
        return;
    }

    const prompts = this.selectedThemes.map(theme => `Reimagine this product photo by placing the object ${theme}, changing the photo angle to create a dynamic and professional advertisement.`);
    await this.runPromptBasedGeneration(prompts);
  },

  async runPromptBasedGeneration(prompts: string[]) {
    if (!this.sourceImage) return;

    // For LookBook and MixStyle, we prepend the custom prompt if it exists.
    // For ProductStyle with a custom prompt, the `prompts` array is already just the custom prompt.
    const finalPrompts = (this.mode === 'LookBook' || this.mode === 'MixStyle') && this.customPrompt
        ? prompts.map(p => `${this.customPrompt}. ${p}`)
        : prompts;

    this.state = 'generating';
    this.imageResults = finalPrompts.map(prompt => ({ prompt, status: 'pending', imageUrl: null }));
    this.progressBar.style.width = '0%';
    this.render();
    
    let completedJobs = 0;
    const totalJobs = this.imageResults.length;

    const updateProgress = () => {
      completedJobs++;
      const progress = (completedJobs / totalJobs) * 100;
      this.progressBar.style.width = `${progress}%`;
      this.updateStatusText();
    };

    const generationPromises = this.imageResults.map(async (result, index) => {
        try {
            const response = await generateStyledImage(this.sourceImage!, result.prompt, this.getApiKey);
            const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);

            if (imagePart?.inlineData) {
                const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
                this.imageResults[index] = { ...result, status: 'done', imageUrl };
                if (this.autoDownloadEnabled) {
                    downloadFile(imageUrl, `product_shot_${this.mode}_${index + 1}.png`);
                }
            } else {
                const textPart = response.candidates?.[0]?.content?.parts.find(p => p.text);
                throw new Error(textPart?.text || "No image data in response.");
            }
        } catch (e: any) {
            console.error(`Error generating for prompt "${result.prompt}":`, e);
            this.imageResults[index] = { ...result, status: 'error', errorMessage: e.message };
        } finally {
            updateProgress();
            this.render();
        }
    });

    await Promise.all(generationPromises);
    this.state = 'results-shown';
    this.render();
  },

  handleGridClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const previewBtn = target.closest('.productshot-preview-single');
    const downloadBtn = target.closest('.productshot-download-single');
    const regenerateBtn = target.closest('.productshot-regenerate-single');
    const createVideoBtn = target.closest('.lookbook-create-video-single');

    if (previewBtn) {
        const index = parseInt(previewBtn.getAttribute('data-index')!, 10);
        const result = this.imageResults[index];
        if (result?.imageUrl) this.showPreviewModal(result.imageUrl);
    } else if (downloadBtn) {
        const index = parseInt(downloadBtn.getAttribute('data-index')!, 10);
        const result = this.imageResults[index];
        if (result?.videoUrl) {
            downloadFile(result.videoUrl, `product_shot_video_${index + 1}.mp4`);
        } else if (result?.imageUrl) {
            downloadFile(result.imageUrl, `product_shot_image_${index + 1}.png`);
        }
    } else if (regenerateBtn) {
        const index = parseInt(regenerateBtn.getAttribute('data-index')!, 10);
        this.regenerateSingle(index);
    } else if (createVideoBtn) {
        const index = parseInt(createVideoBtn.getAttribute('data-index')!, 10);
        this.generateSingleLookBookVideo(index);
    }
  },

  async regenerateSingle(index: number) {
    if (!this.sourceImage || index < 0 || index >= this.imageResults.length) return;
    
    const resultToRegen = this.imageResults[index];
    resultToRegen.status = 'pending';
    resultToRegen.imageUrl = null;
    this.render();

    try {
        const response = await generateStyledImage(this.sourceImage, resultToRegen.prompt, this.getApiKey);
        const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);

        if (imagePart?.inlineData) {
            const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            this.imageResults[index] = { ...resultToRegen, status: 'done', imageUrl };
             if (this.autoDownloadEnabled) {
                downloadFile(imageUrl, `product_shot_regen_${this.mode}_${index + 1}.png`);
            }
        } else {
            throw new Error("No image data in response.");
        }
    } catch (e: any) {
        console.error(`Error regenerating for prompt "${resultToRegen.prompt}":`, e);
        this.imageResults[index] = { ...resultToRegen, status: 'error', errorMessage: e.message };
    } finally {
        this.render();
    }
  },

  async handleDownloadAlbum() {
    const successfulResults = this.imageResults.filter(r => r.status === 'done' && r.imageUrl);
    for (let i = 0; i < successfulResults.length; i++) {
        downloadFile(successfulResults[i].imageUrl!, `product_shot_${i + 1}.png`);
        await delay(300);
    }
  },

  handleStartOver() {
    this.state = 'idle';
    this.sourceImage = null;
    this.sourceImageAspectRatio = null;
    this.resultsGrid.style.removeProperty('--product-shot-aspect-ratio');
    this.imageResults = [];
    this.selectedThemes = [];
    this.fileInput.value = '';
    this.customPromptInput.value = '';
    this.customPrompt = '';
    document.querySelectorAll('.theme-tag').forEach(btn => btn.classList.remove('active'));
    this.updateGenerateButton();
    this.render();
  },

  populateThemes() {
    this.themesContainer.innerHTML = '';
    PRODUCT_STYLE_THEMES.forEach(theme => {
        const button = document.createElement('button');
        button.className = 'theme-tag';
        button.textContent = theme.split(' ')[0].replace(',', '');
        button.title = theme;
        button.addEventListener('click', () => this.handleThemeClick(theme, button));
        this.themesContainer.appendChild(button);
    });
  },

  handleThemeClick(theme: string, buttonEl: HTMLButtonElement) {
    const index = this.selectedThemes.indexOf(theme);
    if (index > -1) {
        this.selectedThemes.splice(index, 1);
        buttonEl.classList.remove('active');
    } else {
        this.selectedThemes.push(theme);
        buttonEl.classList.add('active');
    }
    this.updateGenerateButton();
  },

  updateGenerateButton() {
    const span = this.generateButton.querySelector('span');
    if (!span) return;
    
    const hasImage = !!this.sourceImage;
    if (!hasImage) {
        this.generateButton.disabled = true;
        span.textContent = 'Generate';
        return;
    }

    if (this.mode === 'ProductStyle') {
        const count = this.selectedThemes.length;
        this.generateButton.disabled = count === 0;
        span.textContent = count > 0 ? `Generate (${count})` : 'Generate';
    } else if (this.mode === 'LookBook') {
        this.generateButton.disabled = false;
        span.textContent = 'Generate Looks';
    } else if (this.mode === 'MixStyle') {
        this.generateButton.disabled = false;
        span.textContent = 'Generate Styles';
    }
  },

  async generateSingleLookBookVideo(index: number) {
    const result = this.imageResults[index];
    if (!result.imageUrl) return;

    result.status = 'video-generating';
    result.videoStatusText = 'Initializing...';
    this.render();

    try {
        const imageBytes = result.imageUrl.split(',')[1];
        const videoPrompt = "The model in the image comes to life, holding their pose but with gentle, subtle movements. They give a sweet, gentle smile to the camera. The shot is static, focusing on the details of the clothing and the model's graceful style.";

        const updateCallback = (message: string, step?: number) => {
            if (this.imageResults[index].status === 'video-generating') {
                this.imageResults[index].videoStatusText = message;
                this.render();
            }
        };
        
        const generateFn = () => generateVideoContent(
            videoPrompt,
            imageBytes,
            '9:16',
            'veo-2.0-generate-001',
            this.getApiKey,
            updateCallback
        );

        const videoUrl = await withGenericRetry(generateFn, {
            retries: 10,
            delayMs: 3000,
            onRetry: (attempt, error) => {
                updateCallback(`Retry ${attempt}/10...`);
            }
        });

        result.status = 'video-done';
        result.videoUrl = videoUrl;
        if (this.autoDownloadEnabled) {
            downloadFile(videoUrl, `product_shot_lookbook_video_${index + 1}.mp4`);
        }

    } catch (e: any) {
        console.error(`Video generation failed for item ${index}:`, e);
        result.status = 'video-error';
        result.errorMessage = parseAndFormatErrorMessage(e, 'Video generation');
    } finally {
        this.render();
    }
  }
};