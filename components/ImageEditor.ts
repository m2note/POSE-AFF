/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { blobToDataUrl, delay, downloadFile, parseAndFormatErrorMessage, setupDragAndDrop, withRetry } from "../utils/helpers.js";
import { generateImageEditContent } from "../utils/gemini.js";

const editorLoadingMessages = [
    'Applying artistic filters...',
    'Consulting with Nano Banana...',
    'Painting new pixels...',
    'Enhancing image details...',
    'Finalizing the masterpiece...',
];

export const ImageEditor = {
  // DOM Elements
  uploadInput1: document.querySelector('#editor-file-input-1') as HTMLInputElement,
  imagePreview1: document.querySelector('#editor-image-preview-1') as HTMLImageElement,
  clearImage1Button: document.querySelector('#clear-editor-image-1') as HTMLButtonElement,
  selectEditAreaButton: document.querySelector('#select-edit-area-button') as HTMLButtonElement,
  uploadInput2: document.querySelector('#editor-file-input-2') as HTMLInputElement,
  imagePreview2: document.querySelector('#editor-image-preview-2') as HTMLImageElement,
  clearImage2Button: document.querySelector('#clear-editor-image-2') as HTMLButtonElement,
  promptEl: document.querySelector('#editor-prompt-input') as HTMLTextAreaElement,
  quickIdeaButtons: document.querySelectorAll('.quick-idea-button'),
  editImageButton: document.querySelector('#edit-image-button') as HTMLButtonElement,
  previewImageButton: document.querySelector('#preview-image-button') as HTMLButtonElement,
  downloadImageButton: document.querySelector('#download-image-button') as HTMLButtonElement,
  sendToVideoButton: document.querySelector('#send-to-video-button') as HTMLButtonElement,
  statusEl: document.querySelector('#editor-status') as HTMLParagraphElement,
  progressWrapper: document.querySelector('#editor-progress-wrapper') as HTMLDivElement,
  progressBar: document.querySelector('#editor-progress-bar') as HTMLDivElement,
  outputImage: document.querySelector('#editor-output-image') as HTMLImageElement,
  outputPlaceholder: document.querySelector('#editor-output-placeholder') as HTMLSpanElement,
  autoDownloadToggle: document.querySelector('#editor-auto-download') as HTMLInputElement,
  // Mask Editor Modal
  maskEditorModal: document.querySelector('#mask-editor-modal') as HTMLDivElement,
  maskCanvas: document.querySelector('#mask-canvas') as HTMLCanvasElement,
  brushSizeSlider: document.querySelector('#brush-size-slider') as HTMLInputElement,
  maskUndoButton: document.querySelector('#mask-undo-button') as HTMLButtonElement,
  maskClearButton: document.querySelector('#mask-clear-button') as HTMLButtonElement,
  maskSaveButton: document.querySelector('#mask-save-button') as HTMLButtonElement,
  maskEditorCloseButton: document.querySelector('#mask-editor-close-button') as HTMLButtonElement,

  // State
  prompt: '',
  base64Data1: '',
  base64Data2: '',
  maskBase64Data: null as string | null,
  outputImageUrl: null as string | null,
  isLoading: false,
  autoDownloadEnabled: false,
  // Mask State
  maskCtx: null as CanvasRenderingContext2D | null,
  isDrawingMask: false,
  brushSize: 30,
  maskHistory: [] as ImageData[],
  
  // Dependencies
  getApiKey: (() => '') as () => string,
  showPreviewModal: ((url: string | null) => {}) as (url: string | null) => void,
  onSendToVideo: ((url: string) => {}) as (url: string) => void,
  
  init(dependencies: { getApiKey: () => string; showPreviewModal: (url: string | null) => void; onSendToVideo: (url: string) => void; }) {
    this.getApiKey = dependencies.getApiKey;
    this.showPreviewModal = dependencies.showPreviewModal;
    this.onSendToVideo = dependencies.onSendToVideo;

    // Listeners
    this.uploadInput1.addEventListener('change', (e) => this.handleFileUpload(e, 1));
    this.uploadInput2.addEventListener('change', (e) => this.handleFileUpload(e, 2));
    setupDragAndDrop(document.querySelector('.file-drop-zone[for="editor-file-input-1"]'), this.uploadInput1);
    setupDragAndDrop(document.querySelector('.file-drop-zone[for="editor-file-input-2"]'), this.uploadInput2);

    this.clearImage1Button.addEventListener('click', () => this.clearImage(1));
    this.clearImage2Button.addEventListener('click', () => this.clearImage(2));

    this.promptEl.addEventListener('input', () => this.prompt = this.promptEl.value);
    this.editImageButton.addEventListener('click', () => this.generateEdit());
    
    this.previewImageButton.addEventListener('click', () => this.showPreviewModal(this.outputImageUrl));
    this.downloadImageButton.addEventListener('click', () => this.downloadEditedImage());
    this.sendToVideoButton?.addEventListener('click', () => {
        if (this.outputImageUrl) this.onSendToVideo(this.outputImageUrl);
    });

    this.autoDownloadToggle.addEventListener('change', () => {
        this.autoDownloadEnabled = this.autoDownloadToggle.checked;
    });
    this.autoDownloadEnabled = this.autoDownloadToggle.checked;

    this.quickIdeaButtons.forEach(button => {
        button.addEventListener('click', () => {
            const idea = button.textContent || '';
            let template = '';
            switch (idea) {
                case 'Ubah Latar': template = 'Ubah latar belakang menjadi '; break;
                case 'Tambahkan Objek': template = 'Tambahkan '; break;
                case 'Ganti Warna': template = 'Ubah warna [objek] menjadi '; break;
                case 'Gaya Kartun': template = 'Ubah gambar menjadi gaya kartun animasi'; break;
            }
            this.promptEl.value = template;
            this.promptEl.focus();
            this.prompt = template;
        });
    });

    // Mask Editor Listeners
    this.selectEditAreaButton.addEventListener('click', () => this.showMaskEditor());
    this.maskEditorCloseButton.addEventListener('click', () => this.hideMaskEditor());
    this.maskUndoButton.addEventListener('click', () => this.undoLastMaskAction());
    this.maskClearButton.addEventListener('click', () => this.clearMask());
    this.maskSaveButton.addEventListener('click', () => this.saveMask());
    this.brushSizeSlider.addEventListener('input', (e) => {
        this.brushSize = parseInt((e.target as HTMLInputElement).value, 10);
    });
    this.maskCanvas.addEventListener('mousedown', (e) => this.startDrawingMask(e));
    this.maskCanvas.addEventListener('mousemove', (e) => this.drawOnMask(e));
    this.maskCanvas.addEventListener('mouseup', () => this.stopDrawingMask());
    this.maskCanvas.addEventListener('mouseout', () => this.stopDrawingMask());
  },

  setLoading(loading: boolean) {
    this.isLoading = loading;
    this.editImageButton.disabled = loading;
    this.uploadInput1.disabled = loading;
    this.uploadInput2.disabled = loading;
    this.promptEl.disabled = loading;

    this.progressWrapper.style.display = loading ? 'block' : 'none';
    if (loading) {
        this.progressBar.style.width = '0%';
        this.outputImage.classList.add('image-preview-hidden');
        this.outputPlaceholder.style.display = 'block';
    }
    
    this.updateActionButtonsState();
  },

  updateActionButtonsState() {
    const hasOutput = !!this.outputImageUrl;
    this.previewImageButton.disabled = !hasOutput || this.isLoading;
    this.downloadImageButton.disabled = !hasOutput || this.isLoading;
    if (this.sendToVideoButton) {
      this.sendToVideoButton.disabled = !hasOutput || this.isLoading;
    }
  },

  async handleFileUpload(e: Event, imageNumber: 1 | 2) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const dataUrl = await blobToDataUrl(file);
      const base64Data = dataUrl.split(',')[1];
      if (imageNumber === 1) {
        this.imagePreview1.src = dataUrl;
        this.base64Data1 = base64Data;
        this.imagePreview1.classList.remove('image-preview-hidden');
        this.clearImage1Button.style.display = 'flex';
        this.selectEditAreaButton.style.display = 'flex';
        this.maskBase64Data = null; // Clear old mask
      } else {
        this.imagePreview2.src = dataUrl;
        this.base64Data2 = base64Data;
        this.imagePreview2.classList.remove('image-preview-hidden');
        this.clearImage2Button.style.display = 'flex';
      }
    } catch (error) {
      console.error('Error converting file to base64:', error);
      this.statusEl.innerText = 'Error processing image file.';
    }
  },

  clearImage(imageNumber: 1 | 2) {
    if (imageNumber === 1) {
      this.base64Data1 = '';
      this.imagePreview1.src = '#';
      this.imagePreview1.classList.add('image-preview-hidden');
      this.uploadInput1.value = '';
      this.clearImage1Button.style.display = 'none';
      this.selectEditAreaButton.style.display = 'none';
      this.maskBase64Data = null;
    } else {
      this.base64Data2 = '';
      this.imagePreview2.src = '#';
      this.imagePreview2.classList.add('image-preview-hidden');
      this.uploadInput2.value = '';
      this.clearImage2Button.style.display = 'none';
    }
  },

  downloadEditedImage() {
    if (this.outputImageUrl) {
        downloadFile(this.outputImageUrl, 'edited-image.png');
    }
  },

  async generateEdit() {
    if (this.prompt.trim() === '') {
        this.statusEl.innerText = 'Please enter an editing command.';
        return;
    }
    if (this.base64Data1 === '' && this.base64Data2 === '') {
        this.statusEl.innerText = 'Please upload at least one source image.';
        return;
    }
    this.setLoading(true);
    this.outputImageUrl = null;
    this.updateActionButtonsState();

    let messageIndex = 0;
    let statusInterval: number;

    const updateStatus = (message: string, step?: number) => {
        this.statusEl.innerText = message;
        if (step !== undefined && this.progressBar) {
            const progress = Math.min(95, Math.max(0, (step / editorLoadingMessages.length) * 100));
            this.progressBar.style.width = `${progress}%`;
        }
    };

    updateStatus('Initializing image edit...', 0);
    
    statusInterval = window.setInterval(() => {
        messageIndex++;
        updateStatus(editorLoadingMessages[messageIndex % editorLoadingMessages.length], messageIndex);
    }, 1500);

    try {
        const response = await withRetry(
            () => generateImageEditContent(this.prompt, this.base64Data1, this.base64Data2, this.maskBase64Data, this.getApiKey),
            {
                retries: 10,
                delayMs: 2000,
                onRetry: (attempt) => {
                    updateStatus(`Quota limit reached. Retrying... (Attempt ${attempt}/10)`);
                }
            }
        );

        const candidate = response.candidates?.[0];
        if (!candidate || !candidate.content || !candidate.content.parts) {
            throw new Error("Invalid response structure from the API.");
        }

        const imagePart = candidate.content.parts.find(p => p.inlineData);
        if (imagePart?.inlineData) {
            this.progressBar.style.width = '100%';
            updateStatus(`Image edited successfully!`);
            this.outputImageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            this.outputImage.src = this.outputImageUrl;
            this.outputImage.classList.remove('image-preview-hidden');
            this.outputPlaceholder.style.display = 'none';

            if (this.autoDownloadEnabled) {
                this.downloadEditedImage();
            }
        } else {
            const textPart = candidate.content.parts.find(p => p.text);
            const errorMessage = textPart?.text ? `Model responded with text: '${textPart.text}'` : "No image data found in response.";
            throw new Error(errorMessage);
        }
    } catch (e: any) {
        const errorMessage = parseAndFormatErrorMessage(e, 'Image editing');
        console.error(`Error during image editing:`, e);
        updateStatus(errorMessage);
        this.progressBar.style.width = '0%';
    } finally {
        clearInterval(statusInterval);
        await delay(1500);
        this.setLoading(false);
        this.statusEl.innerText = 'Ready for editing.';
    }
  },

  // Mask Editor Methods
  showMaskEditor() {
    if (!this.base64Data1) {
        this.statusEl.innerText = 'Please upload a Base Image first.';
        return;
    }
    this.maskEditorModal.style.display = 'flex';
    this.initializeMaskCanvas();
  },

  hideMaskEditor() {
    this.maskEditorModal.style.display = 'none';
  },

  initializeMaskCanvas() {
    this.maskCtx = this.maskCanvas.getContext('2d');
    if (!this.maskCtx) return;
    const img = new Image();
    img.onload = () => {
        this.maskCanvas.width = img.naturalWidth;
        this.maskCanvas.height = img.naturalHeight;
        this.maskCtx?.drawImage(img, 0, 0);
        this.maskHistory = [];
        this.saveMaskState();
    };
    img.src = `data:image/png;base64,${this.base64Data1}`;
  },

  saveMaskState() {
    if (this.maskCtx) {
        this.maskHistory.push(this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height));
    }
  },

  undoLastMaskAction() {
    if (this.maskHistory.length > 1) {
        this.maskHistory.pop();
        const lastState = this.maskHistory[this.maskHistory.length - 1];
        this.maskCtx?.putImageData(lastState, 0, 0);
    }
  },

  clearMask() {
    if (this.maskHistory.length > 0) {
        const initialState = this.maskHistory[0];
        this.maskCtx?.putImageData(initialState, 0, 0);
        this.maskHistory = [initialState];
    }
  },

  getMousePos(canvas: HTMLCanvasElement, evt: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (evt.clientX - rect.left) * (canvas.width / rect.width),
        y: (evt.clientY - rect.top) * (canvas.height / rect.height)
    };
  },

  drawOnMask(e: MouseEvent) {
    if (!this.isDrawingMask || !this.maskCtx) return;
    const pos = this.getMousePos(this.maskCanvas, e);
    this.maskCtx.lineTo(pos.x, pos.y);
    this.maskCtx.stroke();
  },

  startDrawingMask(e: MouseEvent) {
    if (!this.maskCtx) return;
    this.isDrawingMask = true;
    this.maskCtx.lineJoin = 'round';
    this.maskCtx.lineCap = 'round';
    this.maskCtx.lineWidth = this.brushSize;
    this.maskCtx.strokeStyle = 'rgba(221, 132, 72, 0.7)';
    this.maskCtx.beginPath();
    const pos = this.getMousePos(this.maskCanvas, e);
    this.maskCtx.moveTo(pos.x, pos.y);
    this.drawOnMask(e);
  },

  stopDrawingMask() {
    if (this.isDrawingMask && this.maskCtx) {
        this.maskCtx.closePath();
        this.saveMaskState();
    }
    this.isDrawingMask = false;
  },

  saveMask() {
    if (!this.maskCtx) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.maskCanvas.width;
    tempCanvas.height = this.maskCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    const canvasImageData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height).data;
    const maskImageData = tempCtx.createImageData(this.maskCanvas.width, this.maskCanvas.height);
    const maskData = maskImageData.data;
    const originalImagePixels = this.maskHistory[0].data;

    for (let i = 0; i < canvasImageData.length; i += 4) {
        if (canvasImageData[i] !== originalImagePixels[i] || 
            canvasImageData[i+1] !== originalImagePixels[i+1] || 
            canvasImageData[i+2] !== originalImagePixels[i+2]) {
            maskData[i] = 255; maskData[i+1] = 255; maskData[i+2] = 255; maskData[i+3] = 255;
        }
    }
    
    tempCtx.putImageData(maskImageData, 0, 0);
    const maskDataUrl = tempCanvas.toDataURL('image/png');
    this.maskBase64Data = maskDataUrl.split(',')[1];
    
    this.statusEl.innerText = 'Mask saved successfully!';
    this.hideMaskEditor();
  }
};