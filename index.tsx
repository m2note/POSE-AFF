/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { setupDragAndDrop } from './utils/helpers.js';
import { PoseMirrorSelfie } from './components/PoseMirrorSelfie.js';

// === DOM Elements ===
// Image Preview Modal
const imagePreviewModal = document.querySelector('#image-preview-modal') as HTMLDivElement;
const modalPreviewImage = document.querySelector('#modal-preview-image') as HTMLImageElement;
const modalPreviewCloseButton = document.querySelector('#modal-preview-close-button') as HTMLButtonElement;
// API Key Modal
const showApiKeyModalButton = document.querySelector('#show-api-key-modal-button') as HTMLButtonElement;
const apiKeyModal = document.querySelector('#api-key-modal') as HTMLDivElement;
const apiKeyModalCloseButton = document.querySelector('#api-key-modal-close-button') as HTMLButtonElement;
const premiumApiKeyInput = document.querySelector('#premium-api-key-input') as HTMLInputElement;
const saveApiKeyButton = document.querySelector('#save-api-key-button') as HTMLButtonElement;
const clearApiKeyButton = document.querySelector('#clear-api-key-button') as HTMLButtonElement;
const apiKeyStatusIndicator = document.querySelector('#api-key-status-indicator') as HTMLSpanElement;
const apiKeyModalStatus = document.querySelector('#api-key-modal-status') as HTMLParagraphElement;

// === State ===
let premiumApiKey: string | null = null;

// === API Key Management ===
function getApiKey(): string {
  return premiumApiKey || (process.env.API_KEY as string);
}

function updateApiKeyStatusUI() {
  if (apiKeyStatusIndicator) {
    if (premiumApiKey) {
      apiKeyStatusIndicator.classList.add('active');
    } else {
      apiKeyStatusIndicator.classList.remove('active');
    }
  }
}

function saveApiKey() {
  const newKey = premiumApiKeyInput.value.trim();
  if (newKey) {
    premiumApiKey = newKey;
    localStorage.setItem('premiumApiKey', newKey);
    apiKeyModalStatus.innerText = 'API Key saved successfully!';
    updateApiKeyStatusUI();
    setTimeout(() => {
      hideApiKeyModal();
      apiKeyModalStatus.innerText = '';
    }, 1500);
  } else {
    apiKeyModalStatus.innerText = 'Please enter a valid API Key.';
  }
}

function clearApiKey() {
  premiumApiKey = null;
  localStorage.removeItem('premiumApiKey');
  premiumApiKeyInput.value = '';
  apiKeyModalStatus.innerText = 'API Key cleared.';
  updateApiKeyStatusUI();
}

function showApiKeyModal() {
  if (apiKeyModal) {
    apiKeyModal.style.display = 'flex';
  }
}

function hideApiKeyModal() {
  if (apiKeyModal) {
    apiKeyModal.style.display = 'none';
  }
}

// === Image Preview Modal Logic ===
function showPreviewModal(imageUrl: string | null) {
  if (imagePreviewModal && modalPreviewImage && imageUrl) {
    modalPreviewImage.src = imageUrl;
    imagePreviewModal.style.display = 'flex';
  }
}

function hidePreviewModal() {
  if (imagePreviewModal) {
    imagePreviewModal.style.display = 'none';
    modalPreviewImage.src = '#';
  }
}

// === Initial Setup ===
document.addEventListener('DOMContentLoaded', () => {
  // Load API Key from local storage
  premiumApiKey = localStorage.getItem('premiumApiKey');
  if (premiumApiKey) {
    premiumApiKeyInput.value = premiumApiKey;
  }
  updateApiKeyStatusUI();

  // Initialize all components and pass dependencies
  PoseMirrorSelfie.init({ getApiKey, showPreviewModal });
  
  // Add listeners for preview modal
  modalPreviewCloseButton?.addEventListener('click', hidePreviewModal);
  imagePreviewModal?.addEventListener('click', (e) => {
    if (e.target === imagePreviewModal) {
      hidePreviewModal();
    }
  });

  // Add listeners for API Key Modal
  showApiKeyModalButton?.addEventListener('click', showApiKeyModal);
  apiKeyModalCloseButton?.addEventListener('click', hideApiKeyModal);
  saveApiKeyButton?.addEventListener('click', saveApiKey);
  clearApiKeyButton?.addEventListener('click', clearApiKey);
  apiKeyModal?.addEventListener('click', (e) => {
    if (e.target === apiKeyModal) {
      hideApiKeyModal();
    }
  });
});