/**
 * Claude-powered Gmail Assistant
 * Handles natural language requests for email operations
 * Now with conversation memory per user!
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  listEmails,
  searchEmails,
  getEmail,
  sendEmail,
  markAsRead,
  trashEmail,
  createLabel,
  deleteLabel,
  starEmail,
  unstarEmail,
  archiveEmail,
  batchModifyEmails,
  getLabels,
  getUnsubscribeInfo,
  findMarketingEmails,
  formatEmailForSlack,
  formatEmailListForSlack,
} from './gmail-client.js';

const anthropic = new Anthropic();

// Conversation memory storage
// Key: Slack user ID, Value: { messages, lastActivity, context }
interface ConversationState {
  messages: Anthropic.MessageParam[];
  lastActivity: number;
  context: string; // Summary of what we're working on
}

const conversationMemory = new Map<string, ConversationState>();

// Memory timeout: 30 minutes of inactivity clears conversation
const MEMORY_TIMEOUT_MS = 30 * 60 * 1000;

// Max messages to keep in history (to avoid token limits)
const MAX_HISTORY_MESSAGES = 20;

// Clean up old conversations periodically
function cleanupOldConversations() {
  const now = Date.now();
  for (const [userId, state] of conversationMemory.entries()) {
    if (now - state.lastActivity > MEMORY_TIMEOUT_MS) {
      conversationMemory.delete(userId);
    }
  }
}

// Get or create conversation state for a user
function getConversationState(userId: string): ConversationState {
  cleanupOldConversations();

  if (!conversationMemory.has(userId)) {
    conversationMemory.set(userId, {
      messages: [],
      lastActivity: Date.now(),
      context: '',
    });
  }

  const state = conversationMemory.get(userId)!;
  state.lastActivity = Date.now();
  return state;
}

// Clear conversation for a user
export function clearConversation(userId: string): void {
  conversationMemory.delete(userId);
}

// Tool definitions for Claude
const tools: Anthropic.Tool[] = [
  {
    name: 'search_emails',
    description: `Search for emails using Gmail search syntax. ALL Gmail search operators are supported:

PEOPLE:
- from:sender@email.com - from specific sender
- to:recipient@email.com - to specific recipient
- cc:email - carbon copied
- bcc:email - blind carbon copied
- deliveredto:email - delivered to address

CONTENT:
- subject:word - word in subject
- "exact phrase" - exact phrase match
- word1 OR word2 - either word
- -word - exclude word
- +word - exact word match
- word1 AROUND n word2 - words within n words of each other

STATUS:
- is:unread / is:read - read status
- is:starred - starred emails
- is:important - important emails
- is:snoozed - snoozed emails

ATTACHMENTS:
- has:attachment - has any attachment
- has:drive / has:document / has:spreadsheet / has:presentation - Google Drive files
- has:youtube - YouTube links
- filename:pdf - attachment filename/type
- larger:5M / smaller:1M - size filters (K, M for KB, MB)

LOCATION:
- in:inbox / in:sent / in:drafts / in:trash / in:spam / in:anywhere
- label:labelname - has specific label
- category:primary / category:social / category:promotions / category:updates / category:forums

TIME:
- after:YYYY/MM/DD / before:YYYY/MM/DD - date range
- newer_than:7d / older_than:1m - relative time (d=days, m=months, y=years)

OTHER:
- list:listname@domain.com - mailing list emails

Combine operators: "from:boss@company.com is:unread has:attachment after:2024/01/01"`,
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
  {
    name: 'create_label',
    description: 'Create a new Gmail label for organizing emails',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'The name for the new label',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_label',
    description: 'Delete a Gmail label',
    input_schema: {
      type: 'object' as const,
      properties: {
        labelId: {
          type: 'string',
          description: 'The ID of the label to delete',
        },
      },
      required: ['labelId'],
    },
  },
  {
    name: 'get_labels',
    description: 'Get all Gmail labels. Use this to find label IDs for applying labels to emails.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'star_email',
    description: 'Star an email to mark it as important',
    input_schema: {
      type: 'object' as const,
      properties: {
        messageId: {
          type: 'string',
          description: 'The email message ID to star',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'unstar_email',
    description: 'Remove star from an email',
    input_schema: {
      type: 'object' as const,
      properties: {
        messageId: {
          type: 'string',
          description: 'The email message ID to unstar',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'archive_email',
    description: 'Archive an email (remove from inbox but keep in All Mail)',
    input_schema: {
      type: 'object' as const,
      properties: {
        messageId: {
          type: 'string',
          description: 'The email message ID to archive',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'batch_star_emails',
    description: 'Star multiple emails at once. Use this when the user wants to star all emails from a sender or matching a search.',
    input_schema: {
      type: 'object' as const,
      properties: {
        messageIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of email message IDs to star',
        },
      },
      required: ['messageIds'],
    },
  },
  {
    name: 'batch_apply_label',
    description: 'Apply a label to multiple emails at once',
    input_schema: {
      type: 'object' as const,
      properties: {
        messageIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of email message IDs',
        },
        labelId: {
          type: 'string',
          description: 'The label ID to apply',
        },
      },
      required: ['messageIds', 'labelId'],
    },
  },
  {
    name: 'find_marketing_emails',
    description: 'Find promotional/marketing emails that the user might want to unsubscribe from. Returns emails with unsubscribe links.',
    input_schema: {
      type: 'object' as const,
      properties: {
        maxResults: {
          type: 'number',
          description: 'Maximum number of marketing emails to find (default: 10)',
        },
      },
    },
  },
  {
    name: 'get_unsubscribe_info',
    description: 'Get unsubscribe links for a specific email. Use this to help users unsubscribe from newsletters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        messageId: {
          type: 'string',
          description: 'The email message ID to get unsubscribe info for',
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

    case 'create_label': {
      const label = await createLabel(input.name as string);
      if (label) {
        return `✅ Label created: "${input.name}" (ID: ${label.id})`;
      }
      return `❌ Failed to create label`;
    }

    case 'delete_label': {
      const success = await deleteLabel(input.labelId as string);
      if (success) {
        return `✅ Label deleted`;
      }
      return `❌ Failed to delete label`;
    }

    case 'get_labels': {
      const labels = await getLabels();
      if (labels.length === 0) {
        return 'No labels found.';
      }
      const userLabels = labels.filter(l => l.type === 'user');
      const systemLabels = labels.filter(l => l.type === 'system');

      let result = '*Your Labels:*\n';
      if (userLabels.length > 0) {
        result += userLabels.map(l => `• ${l.name} (ID: \`${l.id}\`)`).join('\n');
      } else {
        result += '_No custom labels_';
      }
      result += '\n\n*System Labels:*\n';
      result += systemLabels.slice(0, 10).map(l => `• ${l.name}`).join('\n');
      return result;
    }

    case 'star_email': {
      const success = await starEmail(input.messageId as string);
      if (success) {
        return `⭐ Email starred: ${input.messageId}`;
      }
      return `❌ Failed to star email`;
    }

    case 'unstar_email': {
      const success = await unstarEmail(input.messageId as string);
      if (success) {
        return `✅ Star removed from email: ${input.messageId}`;
      }
      return `❌ Failed to unstar email`;
    }

    case 'archive_email': {
      const success = await archiveEmail(input.messageId as string);
      if (success) {
        return `📁 Email archived: ${input.messageId}`;
      }
      return `❌ Failed to archive email`;
    }

    case 'batch_star_emails': {
      const messageIds = input.messageIds as string[];
      const success = await batchModifyEmails(messageIds, ['STARRED'], undefined);
      if (success) {
        return `⭐ Starred ${messageIds.length} emails`;
      }
      return `❌ Failed to star emails`;
    }

    case 'batch_apply_label': {
      const messageIds = input.messageIds as string[];
      const labelId = input.labelId as string;
      const success = await batchModifyEmails(messageIds, [labelId], undefined);
      if (success) {
        return `✅ Applied label to ${messageIds.length} emails`;
      }
      return `❌ Failed to apply label`;
    }

    case 'find_marketing_emails': {
      const maxResults = (input.maxResults as number) || 10;
      const emails = await findMarketingEmails(maxResults);
      if (emails.length === 0) {
        return 'No marketing emails found.';
      }

      let result = `*Found ${emails.length} marketing/promotional emails:*\n\n`;
      for (const email of emails) {
        result += `*${email.subject}*\n`;
        result += `From: ${email.from}\n`;
        result += `ID: \`${email.id}\`\n`;
        if (email.hasUnsubscribe) {
          if (email.unsubscribeLinks.length > 0) {
            result += `🔗 Unsubscribe: ${email.unsubscribeLinks[0]}\n`;
          } else if (email.unsubscribeEmail) {
            result += `📧 Unsubscribe email: ${email.unsubscribeEmail}\n`;
          }
        } else {
          result += `⚠️ No unsubscribe link found\n`;
        }
        result += '\n';
      }
      return result;
    }

    case 'get_unsubscribe_info': {
      const info = await getUnsubscribeInfo(input.messageId as string);
      if (!info) {
        return `❌ Could not get unsubscribe info for email: ${input.messageId}`;
      }

      let result = `*Unsubscribe Info for:* ${info.email.subject}\n`;
      result += `*From:* ${info.email.from}\n\n`;

      if (info.hasUnsubscribe) {
        if (info.unsubscribeLinks.length > 0) {
          result += `*Unsubscribe Links:*\n`;
          for (const link of info.unsubscribeLinks) {
            result += `• ${link}\n`;
          }
        }
        if (info.unsubscribeEmail) {
          result += `\n*Unsubscribe Email:* ${info.unsubscribeEmail}`;
        }
      } else {
        result += `⚠️ No unsubscribe option found in this email.`;
      }
      return result;
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
// Now with conversation memory per user!
export async function processNaturalLanguageRequest(
  userRequest: string,
  userId: string = 'default'
): Promise<string> {
  // Get or create conversation state for this user
  const state = getConversationState(userId);

  const systemPrompt = `You are a helpful Gmail assistant integrated with Slack. You help users manage their email through natural language.

${getDateContext()}

Your capabilities:
- Search emails using Gmail's powerful search syntax
- List recent emails
- Read specific email content
- Send emails (compose professional messages when asked)
- Mark emails as read
- Move emails to trash
- Create, delete, and manage labels
- Star/unstar emails
- Archive emails
- Batch operations (star all emails from a sender, apply labels to multiple emails)
- Find marketing/promotional emails and help users unsubscribe
- Get unsubscribe links from emails

CONVERSATION MEMORY:
- You now have conversation memory! You can remember previous messages in this chat.
- Users can refer to previous results like "unsubscribe from 1, 3, and 5" or "trash the second one"
- When users reference numbers or "that email", look at your previous responses to understand context
- If you showed a list of emails, remember those IDs for follow-up actions
- Conversations reset after 30 minutes of inactivity or when the user says "clear", "reset", or "start over"

Guidelines:
- When users ask about "recent" or "latest" emails, use list_recent_emails
- When users want emails from a time period (last week, yesterday, etc.), convert to Gmail date syntax (after:YYYY/MM/DD or newer_than:Xd)
- When users ask to compose/draft/send an email, help them write it professionally
- When searching, be smart about converting natural language to Gmail search operators
- Always be concise in your responses - this is Slack, not email
- If you need more information to complete a request (like an email address to send to), ask for it
- You CAN now ask follow-up questions since conversations persist!

Examples of query conversions:
- "emails from last week" → "newer_than:7d"
- "unread emails from John" → "from:john is:unread"
- "emails with attachments" → "has:attachment"
- "important emails" → "is:important"
- "starred emails" → "is:starred"
- "large emails over 5MB" → "larger:5M"
- "emails with PDF attachments" → "filename:pdf"
- "social media notifications" → "category:social"
- "promotional emails" → "category:promotions"
- "emails CC'd to me" → "cc:me"
- "emails from Amazon or eBay" → "from:amazon OR from:ebay"
- "emails about meeting but not calendar" → "meeting -calendar"
- "Google Doc attachments" → "has:document"
- "emails from mailing lists" → "list:*"
- "snoozed emails" → "is:snoozed"
- "emails mentioning budget near report" → "budget AROUND 5 report"

For unsubscribe requests:
- Use find_marketing_emails to find promotional emails with unsubscribe links
- Use get_unsubscribe_info to get unsubscribe details for a specific email
- Show clickable unsubscribe links so users can click directly
- Format: Show sender name and the actual unsubscribe link
- Example response format:
  "Here are your marketing emails with unsubscribe links:
   1. **Amazon** - <https://unsubscribe.amazon.com/xxx|Unsubscribe>
   2. **Newsletter** - <https://example.com/unsub|Unsubscribe>"

For batch operations:
- First search for the emails to get their IDs
- Then use batch_star_emails or batch_apply_label with the IDs
- Example: "Star all emails from boss@company.com" → search, collect IDs, then batch star`;

  // Add the new user message to conversation history
  state.messages.push({ role: 'user', content: userRequest });

  // Trim history if it gets too long (keep most recent messages)
  while (state.messages.length > MAX_HISTORY_MESSAGES) {
    state.messages.shift();
  }

  // Use the full conversation history
  const messages = [...state.messages];

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

  const finalResponse = textBlocks.map((block) => block.text).join('\n') || 'I processed your request but have no response to show.';

  // Save the final assistant response to conversation history
  // We save only the text response (not tool calls) to keep history clean
  state.messages.push({ role: 'assistant', content: finalResponse });

  // Trim history again if needed after adding the response
  while (state.messages.length > MAX_HISTORY_MESSAGES) {
    state.messages.shift();
  }

  return finalResponse;
}
