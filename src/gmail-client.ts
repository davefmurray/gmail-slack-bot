/**
 * Gmail API Client - calls our deployed Gmail HTTP API
 */

const GMAIL_API_URL = process.env.GMAIL_API_URL || 'https://gmail-http-api-production.up.railway.app';
const GMAIL_API_KEY = process.env.GMAIL_API_KEY || '';

interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  body?: string;
  labels: string[];
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  emails?: EmailMessage[];
  email?: EmailMessage;
  count?: number;
}

async function callGmailApi<T>(
  endpoint: string,
  method: string = 'GET',
  body?: Record<string, unknown>
): Promise<ApiResponse<T>> {
  const url = `${GMAIL_API_URL}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (GMAIL_API_KEY) {
    headers['x-api-key'] = GMAIL_API_KEY;
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  return response.json();
}

export async function listEmails(maxResults: number = 5, query?: string): Promise<EmailMessage[]> {
  const params = new URLSearchParams();
  params.set('maxResults', maxResults.toString());
  if (query) {
    params.set('q', query);
  }

  const result = await callGmailApi<EmailMessage[]>(`/api/emails?${params}`);
  return result.emails || [];
}

export async function searchEmails(query: string, maxResults: number = 5): Promise<EmailMessage[]> {
  const result = await callGmailApi<EmailMessage[]>('/api/emails/search', 'POST', {
    query,
    maxResults,
  });
  return result.emails || [];
}

export async function getEmail(messageId: string): Promise<EmailMessage | null> {
  const result = await callGmailApi<EmailMessage>(`/api/emails/${messageId}`);
  return result.email || null;
}

export async function sendEmail(
  to: string[],
  subject: string,
  body: string
): Promise<{ success: boolean; error?: string }> {
  const result = await callGmailApi<{ id: string }>('/api/emails/send', 'POST', {
    to,
    subject,
    body,
  });
  return { success: result.success, error: result.error };
}

export async function markAsRead(messageId: string): Promise<boolean> {
  const result = await callGmailApi(`/api/emails/${messageId}/read`, 'POST');
  return result.success;
}

export async function trashEmail(messageId: string): Promise<boolean> {
  const result = await callGmailApi(`/api/emails/${messageId}`, 'DELETE');
  return result.success;
}

export function formatEmailForSlack(email: EmailMessage, includeBody: boolean = false): string {
  const lines = [
    `*Subject:* ${email.subject}`,
    `*From:* ${email.from}`,
    `*Date:* ${email.date}`,
    `*ID:* \`${email.id}\``,
  ];

  if (includeBody && email.body) {
    const truncatedBody = email.body.length > 500
      ? email.body.substring(0, 500) + '...'
      : email.body;
    lines.push(`\n>>> ${truncatedBody}`);
  } else {
    lines.push(`\n_${email.snippet}_`);
  }

  return lines.join('\n');
}

export function formatEmailListForSlack(emails: EmailMessage[]): string {
  if (emails.length === 0) {
    return 'No emails found.';
  }

  return emails.map((email, i) => {
    return [
      `*${i + 1}. ${email.subject}*`,
      `   From: ${email.from}`,
      `   Date: ${email.date}`,
      `   ID: \`${email.id}\``,
    ].join('\n');
  }).join('\n\n');
}
