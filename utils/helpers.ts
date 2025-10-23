/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(blob);
  });
}

export function downloadFile(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function parseAndFormatErrorMessage(e: any, context: string): string {
    const baseMessage = `${context} failed.`;

    if (typeof e.message !== 'string') {
        return `${baseMessage} An unexpected error occurred.`;
    }

    try {
        // The error from the SDK might have the structured error in e.message
        // and it's a JSON string.
        const errBody = JSON.parse(e.message);
        const err = errBody.error || {};
        const code = err.code;
        const message = err.message || 'An unknown error occurred.';

        if (code === 429) return `${baseMessage} Quota limit reached after multiple retries.`;
        if (code === 400 || code === 403) return `${baseMessage} Invalid API Key.`;
        if (code === 500) return `${baseMessage} A server error occurred. Please try again later.`;
        
        return `${baseMessage} Error: ${message}`;
    } catch (parseErr) {
        // If parsing fails, it's just a plain string message.
        return `${baseMessage} Details: ${e.message}`;
    }
}

/**
 * Wraps an async function with retry logic for 429 errors.
 * @param fn The async function to execute.
 * @param retries The maximum number of retries.
 * @param delayMs The delay between retries in milliseconds.
 * @param onRetry A callback function that gets called on each retry attempt.
 * @returns The result of the async function if successful.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { retries, delayMs, onRetry }: { retries: number; delayMs: number; onRetry: (attempt: number, error: any) => void }
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      let is429 = false;
      // Check if the error message is a JSON string with a 429 code
      if (typeof e.message === 'string') {
        try {
          const errBody = JSON.parse(e.message);
          if (errBody?.error?.code === 429) {
            is429 = true;
          }
        } catch (parseErr) {
          // Not a JSON error message, so not a structured API error we can retry.
        }
      }

      if (is429 && attempt <= retries) {
        onRetry(attempt, e);
        await delay(delayMs);
      } else {
        // Not a 429 error or max retries reached, so re-throw
        throw e;
      }
    }
  }
  // This line is technically unreachable but required for TypeScript
  throw lastError;
}

/**
 * Wraps an async function with a generic retry logic for any error.
 */
export async function withGenericRetry<T>(
  fn: () => Promise<T>,
  { retries, delayMs, onRetry }: { retries: number; delayMs: number; onRetry: (attempt: number, error: any) => void }
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      if (attempt <= retries) {
        onRetry(attempt, e);
        await delay(delayMs);
      } else {
        // Max retries reached, re-throw the last error
        throw e;
      }
    }
  }
  throw lastError; // Should be unreachable
}

/**
 * Sets up drag and drop functionality for a file input.
 * @param dropZone The element that will act as the drop zone.
 * @param fileInput The file input element to associate with the drop zone.
 */
export function setupDragAndDrop(dropZone: HTMLElement | null, fileInput: HTMLInputElement | null): void {
    if (!dropZone || !fileInput) return;

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    // Highlight drop zone when item is dragged over it
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.add('drag-over');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.remove('drag-over');
        }, false);
    });

    // Handle dropped files
    dropZone.addEventListener('drop', (e: DragEvent) => {
        const dt = e.dataTransfer;
        if (dt?.files && dt.files.length > 0) {
            fileInput.files = dt.files;
            // Manually trigger the 'change' event so our existing listener handles the file
            const event = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(event);
        }
    }, false);
}
