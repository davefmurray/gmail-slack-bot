/**
 * Claude-powered Gmail Assistant
 * Handles natural language requests for email operations
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  listEmails,
  searchEmails,
  getEmail,
  sendEmail,
  markAsRead,
  trashEmail,
  formatEmailForSlack,
  formatEmailListForSlack,
} from './gmail-client.js';

const anthropic = new Anthropic();

// Tool definitions for Claude
const tools: Anthropic.Tool[] = [
  {
    name: 'search_emails',
    description: `Search for emails using Gmail search syntax. Common operators:
- from:sender@email.com - emails from specific sender
- to:recipient@email.com - emails to specific recipient
- subject:word - emails with word in subject
- is:unread - unread emails
- is:starred - starred emails
- has:attachment - emails with attachments
- after:YYYY/MM/DD - emails after date
- before:YYYY/MM/DD - emails before date
- label:labelname - emails with specific label
- in:inbox, in:sent, in:trash - emails in specific folder
- newer_than:7d - emails from last 7 days (use d for days, m for months, y for years)
- older_than:1m - emails older than 1 month
Combine multiple operators: "from:boss@company.com is:unread after:2024/01/01"`,
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results (default: 5, max: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_recent_emails',
    description: 'List the most recent emails from the inbox',
    input_schema: {
      type: 'object' as const,
      properties: {
        count: {
          type: 'number',
          description: 'Number of emails to retrieve (default: 5, max: 10)',
        },
      },
    },
  },
  {
    name: 'get_email_details',
    description: 'Get the full content of a specific email by its ID',
    input_schema: {
      type: 'object' as const,
      properties: {
        messageId: {
          type: 'string',
          description: 'The email message ID',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'send_email',
    description: 'Compose and send an email. Use this when the user wants to send, compose, or draft an email.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address',
        },
        subject: {
          type: 'string',
          description: 'Email subject line',
        },
        body: {
          type: 'string',
          description: 'Email body content',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'mark_as_read',
    description: 'Mark an email as read',
    input_schema: {
      type: 'object' as const,
      properties: {
        messageId: {
          type: 'string',
          description: 'The email message ID to mark as read',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'trash_email',
    description: 'Move an email to trash',
    input_schema: {
      type: 'object' as const,
      properties: {
        messageId: {
          type: 'string',
          description: 'The email message ID to trash',
        },
      },
      required: ['messageId'],
    },
  },
];

// Execute a tool call
async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case 'search_emails': {
      const query = input.query as string;
      const maxResults = Math.min((input.maxResults as number) || 5, 10);
      const emails = await searchEmails(query, maxResults);
      if (emails.length === 0) {
        return 'No emails found matching your search.';
      }
      return formatEmailListForSlack(emails);
    }

    case 'list_recent_emails': {
      const count = Math.min((input.count as number) || 5, 10);
      const emails = await listEmails(count);
      if (emails.length === 0) {
        return 'No emails found.';
      }
      return formatEmailListForSlack(emails);
    }

    case 'get_email_details': {
      const email = await getEmail(input.messageId as string);
      if (!email) {
        return `Email not found with ID: ${input.messageId}`;
      }
      return formatEmailForSlack(email, true);
    }

    case 'send_email': {
      const result = await sendEmail(
        [input.to as string],
        input.subject as string,
        input.body as string
      );
      if (result.success) {
        return `✅ Email sent successfully to ${input.to}`;
      }
      return `❌ Failed to send email: ${result.error || 'Unknown error'}`;
    }

    case 'mark_as_read': {
      const success = await markAsRead(input.messageId as string);
      if (success) {
        return `✅ Email marked as read: ${input.messageId}`;
      }
      return `❌ Failed to mark email as read`;
    }

    case 'trash_email': {
      const success = await trashEmail(input.messageId as string);
      if (success) {
        return `🗑️ Email moved to trash: ${input.messageId}`;
      }
      return `❌ Failed to trash email`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// Get current date info for context
function getDateContext(): string {
  const now = new Date();
  const today = now.toISOString().split('T')[0].replace(/-/g, '/');

  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastWeekStr = lastWeek.toISOString().split('T')[0].replace(/-/g, '/');

  const lastMonth = new Date(now);
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const lastMonthStr = lastMonth.toISOString().split('T')[0].replace(/-/g, '/');

  return `Today is ${today}. Last week started ${lastWeekStr}. Last month started ${lastMonthStr}.`;
}

// Main function to process natural language requests
export async function processNaturalLanguageRequest(
  userRequest: string
): Promise<string> {
  const systemPrompt = `You are a helpful Gmail assistant integrated with Slack. You help users manage their email through natural language.

${getDateContext()}

Your capabilities:
- Search emails using Gmail's powerful search syntax
- List recent emails
- Read specific email content
- Send emails (compose professional messages when asked)
- Mark emails as read
- Move emails to trash

Guidelines:
- When users ask about "recent" or "latest" emails, use list_recent_emails
- When users want emails from a time period (last week, yesterday, etc.), convert to Gmail date syntax (after:YYYY/MM/DD or newer_than:Xd)
- When users ask to compose/draft/send an email, help them write it professionally
- When searching, be smart about converting natural language to Gmail search operators
- Always be concise in your responses - this is Slack, not email
- If you need more information to complete a request (like an email address to send to), ask for it

Examples of query conversions:
- "emails from last week" → search with "newer_than:7d"
- "unread emails from John" → search with "from:john is:unread"
- "emails with attachments" → search with "has:attachment"
- "important emails" → search with "is:important" or "label:important"
- "starred emails" → search with "is:starred"`;

  // Initial message to Claude
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userRequest },
  ];

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    tools,
    messages,
  });

  // Agentic loop - keep processing until we get a final response
  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ContentBlockParam & { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        block.type === 'tool_use'
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const result = await executeTool(toolUse.name, toolUse.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Add assistant response and tool results to messages
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    // Continue the conversation
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    });
  }

  // Extract text response
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  );

  return textBlocks.map((block) => block.text).join('\n') || 'I processed your request but have no response to show.';
}
