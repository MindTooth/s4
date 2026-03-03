/**
 * SSE One-Time Ticket Authentication Utilities
 *
 * Provides client-side utilities for requesting and using one-time tickets
 * for Server-Sent Events (SSE) authentication.
 *
 * Security Improvements over JWT Query Parameters:
 * - Tickets are single-use and short-lived (60 seconds)
 * - Tickets never appear in server logs (removed immediately after validation)
 * - Tickets are scoped to specific resources (jobId or encodedKey)
 * - Prevents JWT token leakage in browser history and proxy logs
 */

import apiClient from './apiClient';
import config from '@app/config';

/**
 * Response from POST /api/auth/sse-ticket
 */
export interface SseTicketResponse {
  ticket: string; // Base64url-encoded random bytes
  sseUrl: string; // Complete SSE URL with ticket parameter
  expiresAt: number; // Unix timestamp (ms) when ticket expires
  expiresIn: number; // Seconds until expiration
}

/**
 * Request a one-time SSE ticket from the backend
 *
 * @param resource - The resource identifier (jobId or encodedKey)
 * @param resourceType - Type of SSE endpoint ('transfer' or 'upload')
 * @returns Promise with ticket data
 *
 * @throws Error if ticket request fails (network error, auth error, etc.)
 *
 * @example
 * const ticketData = await requestSseTicket('transfer-123', 'transfer');
 * console.log(`Ticket: ${ticketData.ticket}, expires in ${ticketData.expiresIn}s`);
 */
export async function requestSseTicket(
  resource: string,
  resourceType: 'transfer' | 'upload',
): Promise<SseTicketResponse> {
  try {
    const response = await apiClient.post<SseTicketResponse>('/auth/sse-ticket', {
      resource,
      resourceType,
    });

    return response.data;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[SSE Tickets] Failed to request ticket:', error);

    // Re-throw with more specific error message
    if (error.response?.status === 401) {
      throw new Error('Authentication required to request SSE ticket');
    } else if (error.response?.status === 429) {
      throw new Error('Too many ticket requests. Please wait and try again.');
    } else if (error.response?.data?.message) {
      throw new Error(`Ticket request failed: ${error.response.data.message}`);
    } else {
      throw new Error('Failed to request SSE ticket. Please try again.');
    }
  }
}

/**
 * Create an EventSource connection with automatic ticket authentication
 *
 * This function:
 * 1. Requests a one-time ticket from the backend
 * 2. Creates an EventSource with the ticket in the URL
 * 3. Returns the EventSource for the caller to attach event handlers
 *
 * @param resource - The resource identifier (jobId or encodedKey)
 * @param resourceType - Type of SSE endpoint ('transfer' or 'upload')
 * @returns Promise with EventSource instance
 *
 * @throws Error if ticket request fails or EventSource creation fails
 *
 * @example
 * const eventSource = await createAuthenticatedEventSource('transfer-123', 'transfer');
 * eventSource.onmessage = (event) => {
 *   const data = JSON.parse(event.data);
 *   console.log('Progress:', data);
 * };
 * eventSource.onerror = () => {
 *   console.error('SSE error');
 *   eventSource.close();
 * };
 */
export async function createAuthenticatedEventSource(
  resource: string,
  resourceType: 'transfer' | 'upload',
): Promise<EventSource> {
  // Request ticket from backend
  const ticketData = await requestSseTicket(resource, resourceType);

  // Construct full URL (backend_api_url includes /api prefix)
  const fullUrl = `${config.backend_api_url}${ticketData.sseUrl}`;

  console.log(
    `[SSE Tickets] Creating EventSource with ticket (expires in ${ticketData.expiresIn}s): ${fullUrl.split('?')[0]}`,
  );

  // Create and return EventSource
  return new EventSource(fullUrl);
}
