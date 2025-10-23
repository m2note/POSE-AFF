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

const BONEKA_POSES = [
    'happily hugging the doll tightly.',
    'tossing the doll gently into the air with a joyful expression.',
    'jumping in the air while holding the doll.',
    'dancing cheerfully with the doll as a partner.',
    'sitting on the ground, sharing a secret with the doll.',
    'looking very happy, showing the doll to the camera.',
    'looking sad, finding comfort by holding the doll close.',
    'running through the scene, holding the doll by its hand.',
    'lying down and cuddling with the doll.'
];


export const PoseBoneka = {
  // DOM Elements
  characterInput: document.querySelector('#pose-boneka-character-file-input') as HTMLInputElement,
  characterDropZone: document.querySelector('#pose-boneka-character-drop-zone') as HTMLLabelElement,
  characterLabelText: document.querySelector('#pose-boneka-character-label-text') as HTMLSpanElement,
  characterPreview: document.querySelector('#pose-boneka-character-preview') as HTMLImageElement,
  clearCharacterButton: document.querySelector('#pose-boneka-clear-character-button') as HTMLButtonElement,
  dollInput: document.querySelector('#pose-boneka-doll-file-input') as HTMLInputElement,
  dollDropZone: document.querySelector('#pose-boneka-doll-drop-zone') as HTMLLabelElement,
  dollLabelText: document.querySelector('#pose-boneka-doll-label-text') as HTMLSpanElement,
  dollPreview: document.querySelector('#pose-boneka-doll-preview') as HTMLImageElement,
  clearDollButton: document.querySelector('#pose-boneka-clear-doll-button') as HTMLButtonElement,
  backgroundButtons: document.querySelectorAll('.pose-boneka-background-button') as NodeListOf<HTMLButtonElement>,
  styleButtons: document.querySelectorAll('.pose-boneka-style-button') as NodeListOf<HTMLButtonElement>,
  generateButton: document.querySelector('#pose-boneka-generate-button') as HTMLButtonElement,
  statusEl: document.querySelector('#pose-boneka-status') as HTMLParagraphElement,
  progressWrapper: document.querySelector('#pose-boneka-progress-wrapper') as HTMLDivElement,
  progressBar: document.querySelector('#pose-boneka-progress-bar') as HTMLDivElement,
  outputContainer: document.querySelector('#pose-boneka-output-container') as HTMLDivElement,
  outputGrid: document.querySelector('#pose-boneka-output-grid') as HTMLDivElement,
  albumActions: document.querySelector('#pose-boneka-album-actions') as HTMLDivElement,
  downloadAllButton: document.querySelector('#pose-boneka-download-all-button') as HTMLButtonElement,
  startOverButton: document.querySelector('#pose-boneka-start-over-button') as HTMLButtonElement,
  
  // State
  characterImage: null as string | null,
  dollImage: null as string | null,
  background: 'paris' as 'paris' | 'singapore' | 'outdoor' | 'indoor' | 'prambanan' | 'luxury' | 'dual-scale' | 'jewel' | 'grandcanyon' | 'cappadocia' | 'islami',
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

    this.characterInput.addEventListener('change', (e) => this.handleFileUpload(e, 'character'));
    this.dollInput.addEventListener('change', (e) => this.handleFileUpload(e, 'doll'));
    setupDragAndDrop(this.characterDropZone, this.characterInput);
    setupDragAndDrop(this.dollDropZone, this.dollInput);

    this.clearCharacterButton.addEventListener('click', () => this.clearImage('character'));
    this.clearDollButton.addEventListener('click', () => this.clearImage('doll'));

    this.backgroundButtons.forEach(button => {
        button.addEventListener('click', () => {
            this.backgroundButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            this.background = (button as HTMLElement).dataset.background as 'paris' | 'singapore' | 'outdoor' | 'indoor' | 'prambanan' | 'luxury' | 'dual-scale' | 'jewel' | 'grandcanyon' | 'cappadocia' | 'islami';
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

    this.updateUploadUI('character', false);
    this.updateUploadUI('doll', false);
    this.updateGenerateButtonState();
  },
  
  updateUploadUI(type: 'character' | 'doll', hasImage: boolean) {
      const labelText = type === 'character' ? this.characterLabelText : this.dollLabelText;
      const preview = type === 'character' ? this.characterPreview : this.dollPreview;
      const dropZone = type === 'character' ? this.characterDropZone : this.dollDropZone;

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

  async handleFileUpload(e: Event, type: 'character' | 'doll') {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const dataUrl = await blobToDataUrl(file);
      const base64Data = dataUrl.split(',')[1];
      if (type === 'character') {
        this.characterImage = base64Data;
        this.characterPreview.src = dataUrl;
        this.clearCharacterButton.style.display = 'flex';
        this.updateUploadUI('character', true);
      } else {
        this.dollImage = base64Data;
        this.dollPreview.src = dataUrl;
        this.clearDollButton.style.display = 'flex';
        this.updateUploadUI('doll', true);
      }
    } catch (error) {
      console.error('Error converting file to base64:', error);
      this.statusEl.innerText = 'Error processing image file.';
    }
    this.updateGenerateButtonState();
  },

  clearImage(type: 'character' | 'doll') {
    if (type === 'character') {
        this.characterImage = null;
        this.characterPreview.src = '#';
        this.characterInput.value = '';
        this.clearCharacterButton.style.display = 'none';
        this.updateUploadUI('character', false);
    } else {
        this.dollImage = null;
        this.dollPreview.src = '#';
        this.dollInput.value = '';
        this.clearDollButton.style.display = 'none';
        this.updateUploadUI('doll', false);
    }
    this.updateGenerateButtonState();
  },
  
  updateGenerateButtonState() {
      const enabled = !!this.characterImage && !!this.dollImage && !this.isRunning;
      this.generateButton.disabled = !enabled;
      if (!this.characterImage || !this.dollImage) {
          this.statusEl.innerText = 'Upload a character and doll photo to start.';
      } else {
          this.statusEl.innerText = 'Ready to generate poses.';
      }
  },
  
  reset() {
      this.clearImage('character');
      this.clearImage('doll');
      this.results = [];
      this.isRunning = false;
      this.outputContainer.style.display = 'none';
      this.albumActions.style.display = 'none';
      this.outputGrid.innerHTML = '';
      this.updateGenerateButtonState();
  },

  getBackgroundDescription() {
    switch (this.background) {
        case 'singapore':
            return 'in front of the Merlion statue in Singapore, with Marina Bay Sands in the background.';
        case 'outdoor':
            return 'in a beautiful, vibrant flower garden during a sunny day.';
        case 'indoor':
            return 'in a cozy, well-lit living room of a house.';
        case 'prambanan':
            return 'in front of the majestic Prambanan temple in Indonesia.';
        case 'luxury':
            return 'in a luxurious and elegant setting, such as a high-end hotel lobby or a designer room.';
        case 'islami':
            return 'in a luxurious room with an Islamic feel, featuring elegant Islamic architecture and decor.';
        case 'jewel':
            return 'inside the stunning Jewel Changi Airport in Singapore, with the Rain Vortex waterfall in the background.';
        case 'grandcanyon':
            return 'at the edge of the Grand Canyon in America, during a beautiful sunset.';
        case 'cappadocia':
            return 'in Cappadocia, Turkey, with numerous hot air balloons floating in the sky during sunrise.';
        case 'paris':
        default:
            return 'in front of the Eiffel Tower in Paris, France.';
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
    if (!this.characterImage || !this.dollImage) {
        this.statusEl.innerText = 'Please upload both a character and a doll photo.';
        return;
    }
    
    this.isRunning = true;
    this.generateButton.disabled = true;
    this.statusEl.innerText = 'Initializing...';
    this.progressWrapper.style.display = 'block';
    this.progressBar.style.width = '0%';
    this.outputContainer.style.display = 'block';
    this.outputGrid.innerHTML = '';

    this.results = BONEKA_POSES.map(prompt => ({ prompt, status: 'pending', imageUrl: null }));
    this.render();

    const jobs = this.results.map((_, index) => index);
    let completedJobs = 0;
    
    const runJob = async (jobIndex: number) => {
        if (!this.isRunning) return;

        try {
            // Step 1: Generate image
            const result = this.results[jobIndex];
            let sceneInstruction = '';
            
            const hijabStyleDescription = this.getHijabStyleDescription(this.hijabStyle);
            const styleInstruction = this.hijabStyle !== 'default' 
                ? `The person must be styled as a woman wearing a ${hijabStyleDescription}` 
                : `The person's clothing and style must be consistent with the reference image.`;


            if (this.background === 'dual-scale') {
                const adaptedPose = result.prompt
                    .replace('hugging the doll tightly', 'posing happily')
                    .replace('tossing the doll gently into the air', 'posing joyfully')
                    .replace('jumping in the air while holding the doll', 'jumping in the air')
                    .replace('dancing cheerfully with the doll as a partner', 'dancing cheerfully')
                    .replace('sitting on the ground, sharing a secret with the doll', 'posing playfully')
                    .replace('looking very happy, showing the doll to the camera', 'posing happily towards the camera')
                    .replace('looking sad, finding comfort by holding the doll close', 'posing thoughtfully')
                    .replace('running through the scene, holding the doll by its hand', 'running through the scene')
                    .replace('lying down and cuddling with the doll', 'lying down and posing cutely');
                
                sceneInstruction = `The new image should show the person ${adaptedPose}. The background is a giant, oversized version of the provided doll image. The person should appear small in comparison to the giant doll, which should be scaled to be twice as large as it would typically be in such a composition. The overall scene should be photorealistic and well-lit.`;
            } else {
                const backgroundDescription = this.getBackgroundDescription();
                sceneInstruction = `The new image should show the person ${result.prompt}. The doll should be rendered at twice its normal size, making it look like a large, oversized plush toy. The background must be ${backgroundDescription}.`;
            }

            const basePrompt = `Using the provided image of the person and the image of the doll, create a new photorealistic image. The person's identity, face, and features MUST be preserved exactly as in the original photo. ${styleInstruction}

            **Scene Instruction:**
            ${sceneInstruction}

            **Quality and Constraints:**
            - The final image must be anatomically correct, high quality, and professional-looking.
            - **CRITICAL:** Avoid any form of anatomical distortion. Specifically, prevent malformed hands, extra fingers, extra limbs, or distorted facial features. Ensure hands have exactly five fingers.
            - The person's interaction with the doll (if any) must look natural and believable, even with its larger size.

            Output only the final image.`;
            
            const response = await generateImageEditContent(basePrompt, this.characterImage!, this.dollImage, null, this.getApiKey);
            
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
        wrapper.className = 'video-result-item';
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
            downloadFile(result.imageUrl, `pose_boneka_${index + 1}.png`);
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
            downloadFile(result.imageUrl, `pose_boneka_${index + 1}.png`);
            await delay(300);
        }
    }
    span.innerText = originalText;
    this.downloadAllButton.disabled = false;
  }
};