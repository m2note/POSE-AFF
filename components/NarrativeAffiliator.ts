/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { blobToDataUrl, delay, parseAndFormatErrorMessage, setupDragAndDrop, withRetry } from "../utils/helpers.js";

const loadingMessages = [
    'Menganalisis produk...',
    'Menulis draf pertama...',
    'Menambahkan sentuhan kreatif...',
    'Memoles call to action...',
    'Menyiapkan narasi akhir...',
];

interface NarrativeVariation {
    style: string;
    title: string;
    narrative: string;
}

export const NarrativeAffiliator = {
  // DOM Elements
  fileInput: document.querySelector('#narrative-file-input') as HTMLInputElement,
  dropZone: document.querySelector('.file-drop-zone[for="narrative-file-input"]') as HTMLLabelElement,
  imagePreview: document.querySelector('#narrative-image-preview') as HTMLImageElement,
  clearImageButton: document.querySelector('#clear-narrative-image-button') as HTMLButtonElement,
  generateButton: document.querySelector('#generate-narrative-button') as HTMLButtonElement,
  statusEl: document.querySelector('#narrative-status') as HTMLParagraphElement,
  progressWrapper: document.querySelector('#narrative-progress-wrapper') as HTMLDivElement,
  progressBar: document.querySelector('#narrative-progress-bar') as HTMLDivElement,
  outputContainer: document.querySelector('#narrative-output-container') as HTMLDivElement,
  
  // State
  base64Image: null as string | null,
  isLoading: false,
  
  // Dependencies
  getApiKey: (() => '') as () => string,

  init(dependencies: { getApiKey: () => string; }) {
    this.getApiKey = dependencies.getApiKey;

    // Listeners
    this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    setupDragAndDrop(this.dropZone, this.fileInput);
    this.clearImageButton.addEventListener('click', () => this.clearImage());
    this.generateButton.addEventListener('click', () => this.generateNarrative());
  },

  setLoading(loading: boolean) {
    this.isLoading = loading;
    this.generateButton.disabled = loading;
    this.fileInput.disabled = loading;
    
    this.progressWrapper.style.display = loading ? 'block' : 'none';
    if (loading) {
        this.progressBar.style.width = '0%';
        this.outputContainer.style.display = 'none';
        this.outputContainer.innerHTML = '';
    }
  },

  updateGenerateButtonState() {
      this.generateButton.disabled = this.isLoading || !this.base64Image;
  },
  
  async handleFileUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const dataUrl = await blobToDataUrl(file);
      this.base64Image = dataUrl.split(',')[1];
      this.imagePreview.src = dataUrl;
      this.imagePreview.classList.remove('image-preview-hidden');
      this.clearImageButton.style.display = 'flex';
      this.statusEl.innerText = 'Ready to generate narrative.';
    } catch (error) {
      console.error('Error converting file to base64:', error);
      this.statusEl.innerText = 'Error processing image file.';
      this.base64Image = null;
    }
    this.updateGenerateButtonState();
  },

  clearImage() {
    this.base64Image = null;
    this.imagePreview.src = '#';
    this.imagePreview.classList.add('image-preview-hidden');
    this.fileInput.value = '';
    this.clearImageButton.style.display = 'none';
    this.statusEl.innerText = 'Upload a product photo to start.';
    this.updateGenerateButtonState();
  },

  async generateNarrative() {
    if (!this.base64Image) {
        this.statusEl.innerText = 'Please upload a product photo first.';
        return;
    }
    this.setLoading(true);

    let messageIndex = 0;
    let statusInterval: number;
    const updateStatus = (message: string, step?: number) => {
        this.statusEl.innerText = message;
        if (step !== undefined && this.progressBar) {
            const progress = Math.min(95, Math.max(0, (step / loadingMessages.length) * 100));
            this.progressBar.style.width = `${progress}%`;
        }
    };
    updateStatus('Initializing generation...', 0);
    statusInterval = window.setInterval(() => {
        messageIndex++;
        updateStatus(loadingMessages[messageIndex % loadingMessages.length], messageIndex);
    }, 1500);

    const basePrompt = `Analyze the product in the image. You are an expert affiliate marketer. For the product, create 4 distinct and compelling content packages for a social media post.

**Instructions for each of the 4 variations:**
1.  **Generate a Title/Caption:** A short, catchy, and SEO-friendly title or caption (max 15 words).
2.  **Generate a Narrative:** A compelling narrative for a social media video post.
3.  **Create 4 distinct variations**, one for each of the following styles:
    *   **Gen Z:** Trendy, casual, energetic slang. Use relevant emojis.
    *   **Story Telling:** A short, relatable story where the product is the hero. Evoke emotion.
    *   **Review Produk:** A concise, trustworthy review highlighting 2-3 key benefits.
    *   **Humoris:** A funny and witty take on the product.
4.  **All content must be in Indonesian.**
5.  The narrative should be suitable for a 15-20 second spoken narration and must end with a strong call to action.
6.  Return the output as a valid JSON array of objects.`;

    const responseSchema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                style: {
                    type: Type.STRING,
                    description: "The style of the narrative (e.g., 'Gen Z', 'Story Telling', 'Review Produk', 'Humoris')."
                },
                title: {
                    type: Type.STRING,
                    description: "The generated catchy title or caption for the post."
                },
                narrative: {
                    type: Type.STRING,
                    description: "The generated narrative text."
                }
            },
            required: ['style', 'title', 'narrative']
        }
    };
    
    try {
        const ai = new GoogleGenAI({apiKey: this.getApiKey()});
        const generateFn = () => ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                parts: [
                    { inlineData: { data: this.base64Image!, mimeType: 'image/png' } },
                    { text: basePrompt }
                ]
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            }
        });
        
        const response: GenerateContentResponse = await withRetry(generateFn, {
             retries: 5,
             delayMs: 2000,
             onRetry: (attempt) => updateStatus(`Quota limit reached. Retrying... (Attempt ${attempt}/5)`)
        });
        
        const resultText = response.text;
        const cleanedJson = resultText.replace(/^```json\s*|```\s*$/g, '');
        const narratives: NarrativeVariation[] = JSON.parse(cleanedJson);

        this.outputContainer.innerHTML = ''; // Clear previous results

        narratives.forEach(item => {
            const card = document.createElement('div');
            card.className = 'narrative-result-card';

            const styleTitle = document.createElement('h4');
            styleTitle.textContent = item.style;
            
            // Title/Caption Section
            const titleSection = document.createElement('div');
            titleSection.className = 'narrative-content-section';
            const titleHeader = document.createElement('h5');
            titleHeader.textContent = 'Judul / Caption';
            const titleText = document.createElement('p');
            titleText.className = 'narrative-text';
            titleText.textContent = item.title;
            titleSection.appendChild(titleHeader);
            titleSection.appendChild(titleText);

            // Narrative Section
            const narrativeSection = document.createElement('div');
            narrativeSection.className = 'narrative-content-section';
            const narrativeHeader = document.createElement('h5');
            narrativeHeader.textContent = 'Narasi';
            const narrativeText = document.createElement('p');
            narrativeText.className = 'narrative-text';
            narrativeText.textContent = item.narrative;
            narrativeSection.appendChild(narrativeHeader);
            narrativeSection.appendChild(narrativeText);
            
            // Button Group
            const buttonGroup = document.createElement('div');
            buttonGroup.className = 'narrative-button-group';

            const copyIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;

            const copyTitleButton = document.createElement('button');
            copyTitleButton.className = 'secondary-button';
            copyTitleButton.innerHTML = `${copyIconSVG}<span>Salin Judul</span>`;
            copyTitleButton.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(item.title);
                    const originalText = copyTitleButton.innerHTML;
                    copyTitleButton.innerHTML = `<span>Copied!</span>`;
                    await delay(2000);
                    copyTitleButton.innerHTML = originalText;
                } catch (err) { console.error('Failed to copy title: ', err); }
            });

            const copyNarrativeButton = document.createElement('button');
            copyNarrativeButton.className = 'secondary-button';
            copyNarrativeButton.innerHTML = `${copyIconSVG}<span>Salin Narasi</span>`;
            copyNarrativeButton.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(item.narrative);
                    const originalText = copyNarrativeButton.innerHTML;
                    copyNarrativeButton.innerHTML = `<span>Copied!</span>`;
                    await delay(2000);
                    copyNarrativeButton.innerHTML = originalText;
                } catch (err) { console.error('Failed to copy narrative: ', err); }
            });

            buttonGroup.appendChild(copyTitleButton);
            buttonGroup.appendChild(copyNarrativeButton);

            card.appendChild(styleTitle);
            card.appendChild(titleSection);
            card.appendChild(narrativeSection);
            card.appendChild(buttonGroup);
            this.outputContainer.appendChild(card);
        });
        
        this.outputContainer.style.display = 'grid';
        updateStatus('Narrative variations generated successfully!');
        this.progressBar.style.width = '100%';

    } catch(e: any) {
        const errorMessage = parseAndFormatErrorMessage(e, 'Narrative generation');
        console.error(`Error generating narrative:`, e);
        updateStatus(errorMessage);
        this.progressBar.style.width = '0%';
    } finally {
        clearInterval(statusInterval);
        await delay(1500);
        this.setLoading(false);
        this.statusEl.innerText = 'Ready.';
    }
  },
};