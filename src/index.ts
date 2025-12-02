import pkg from '@slack/bolt';
const { App, LogLevel } = pkg;
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
import { processNaturalLanguageRequest, clearConversation } from './gmail-assistant.js';

// Initialize Slack Bolt app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  logLevel: LogLevel.INFO,
});

// ===================
// SLASH COMMANDS
// ===================

// Simple request logging (no sensitive content)
function logRequest(userId: string, command: string, status: 'start' | 'success' | 'error', error?: string) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    userId,
    command: command.substring(0, 50) + (command.length > 50 ? '...' : ''), // Truncate for privacy
    status,
    ...(error && { error }),
  };
  console.log(JSON.stringify(logEntry));
}

// /gmail - Natural language Gmail assistant powered by Claude (main command)
// Now with conversation memory per user!
app.command('/gmail', async ({ command, ack, respond }) => {
  await ack();

  const userId = command.user_id;
  const request = command.text.trim();

  // Check for clear/reset commands
  if (request.toLowerCase() === 'clear' || request.toLowerCase() === 'reset' || request.toLowerCase() === 'start over') {
    clearConversation(userId);
    await respond({
      response_type: 'ephemeral',
      text: `🔄 Conversation cleared! Starting fresh.`,
    });
    return;
  }

  if (!request) {
    await respond({
      response_type: 'ephemeral',
      text: `📧 *Gmail Assistant* (with conversation memory!)\n\nJust type what you need in plain English!\n\n*Examples:*\n• \`/gmail show me unread emails\`\n• \`/gmail emails from last week\`\n• \`/gmail find emails with attachments from John\`\n• \`/gmail send an email to bob@example.com about the meeting\`\n• \`/gmail star all emails from my boss\`\n\n*Conversation Commands:*\n• \`/gmail clear\` - Reset conversation memory\n\nType \`/gmail-help\` for all available commands.`,
    });
    return;
  }

  // Send a "thinking" message since Claude may take a moment
  await respond({
    response_type: 'ephemeral',
    text: '🤔 Processing your request...',
  });

  logRequest(userId, request, 'start');

  try {
    const result = await processNaturalLanguageRequest(request, userId);
    logRequest(userId, request, 'success');
    await respond({
      response_type: 'ephemeral',
      text: `> _${request}_\n\n🤖 *Gmail Assistant*\n\n${result}`,
      replace_original: true,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logRequest(userId, request, 'error', errorMsg);
    await respond({
      response_type: 'ephemeral',
      text: `> _${request}_\n\n❌ Error: ${errorMsg}`,
      replace_original: true,
    });
  }
});

// /gmail-list - List recent emails
app.command('/gmail-list', async ({ command, ack, respond }) => {
  await ack();

  try {
    const args = command.text.trim();
    const maxResults = args ? parseInt(args) : 5;

    const emails = await listEmails(Math.min(maxResults, 10));
    await respond({
      response_type: 'ephemeral',
      text: `📬 *Recent Emails (${emails.length})*\n\n${formatEmailListForSlack(emails)}`,
    });
  } catch (error) {
    console.error('Error listing emails:', error);
    await respond({
      response_type: 'ephemeral',
      text: `❌ Error listing emails: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
});

// /gmail-search - Search emails
app.command('/gmail-search', async ({ command, ack, respond }) => {
  await ack();

  try {
    const query = command.text.trim();
    if (!query) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Please provide a search query. Example: `/gmail-search from:someone@example.com`',
      });
      return;
    }

    const emails = await searchEmails(query, 5);
    await respond({
      response_type: 'ephemeral',
      text: `🔍 *Search Results for "${query}" (${emails.length})*\n\n${formatEmailListForSlack(emails)}`,
    });
  } catch (error) {
    console.error('Error searching emails:', error);
    await respond({
      response_type: 'ephemeral',
      text: `❌ Error searching emails: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
});

// /gmail-read - Read a specific email
app.command('/gmail-read', async ({ command, ack, respond }) => {
  await ack();

  try {
    const messageId = command.text.trim();
    if (!messageId) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Please provide an email ID. Example: `/gmail-read 19abc123def456`',
      });
      return;
    }

    const email = await getEmail(messageId);
    if (!email) {
      await respond({
        response_type: 'ephemeral',
        text: `❌ Email not found with ID: ${messageId}`,
      });
      return;
    }

    await respond({
      response_type: 'ephemeral',
      text: `📧 *Email Details*\n\n${formatEmailForSlack(email, true)}`,
    });
  } catch (error) {
    console.error('Error reading email:', error);
    await respond({
      response_type: 'ephemeral',
      text: `❌ Error reading email: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
});

// /gmail-send - Send an email
app.command('/gmail-send', async ({ command, ack, respond }) => {
  await ack();

  try {
    // Parse: to@email.com | Subject | Body
    const parts = command.text.split('|').map(p => p.trim());

    if (parts.length < 3) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Invalid format. Use: `/gmail-send to@email.com | Subject | Body text`',
      });
      return;
    }

    const [to, subject, ...bodyParts] = parts;
    const body = bodyParts.join('|'); // In case body contains |

    const result = await sendEmail([to], subject, body);

    if (result.success) {
      await respond({
        response_type: 'ephemeral',
        text: `✅ Email sent successfully!\n*To:* ${to}\n*Subject:* ${subject}`,
      });
    } else {
      await respond({
        response_type: 'ephemeral',
        text: `❌ Failed to send email: ${result.error || 'Unknown error'}`,
      });
    }
  } catch (error) {
    console.error('Error sending email:', error);
    await respond({
      response_type: 'ephemeral',
      text: `❌ Error sending email: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
});

// /gmail-unread - List unread emails
app.command('/gmail-unread', async ({ command, ack, respond }) => {
  await ack();

  try {
    const maxResults = command.text.trim() ? parseInt(command.text.trim()) : 5;
    const emails = await searchEmails('is:unread', Math.min(maxResults, 10));

    await respond({
      response_type: 'ephemeral',
      text: `📬 *Unread Emails (${emails.length})*\n\n${formatEmailListForSlack(emails)}`,
    });
  } catch (error) {
    console.error('Error listing unread emails:', error);
    await respond({
      response_type: 'ephemeral',
      text: `❌ Error listing unread emails: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
});

// /gmail-mark-read - Mark email as read
app.command('/gmail-mark-read', async ({ command, ack, respond }) => {
  await ack();

  try {
    const messageId = command.text.trim();
    if (!messageId) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Please provide an email ID. Example: `/gmail-mark-read 19abc123def456`',
      });
      return;
    }

    const success = await markAsRead(messageId);
    if (success) {
      await respond({
        response_type: 'ephemeral',
        text: `✅ Email marked as read: ${messageId}`,
      });
    } else {
      await respond({
        response_type: 'ephemeral',
        text: `❌ Failed to mark email as read`,
      });
    }
  } catch (error) {
    console.error('Error marking email as read:', error);
    await respond({
      response_type: 'ephemeral',
      text: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
});

// /gmail-trash - Move email to trash
app.command('/gmail-trash', async ({ command, ack, respond }) => {
  await ack();

  try {
    const messageId = command.text.trim();
    if (!messageId) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Please provide an email ID. Example: `/gmail-trash 19abc123def456`',
      });
      return;
    }

    const success = await trashEmail(messageId);
    if (success) {
      await respond({
        response_type: 'ephemeral',
        text: `🗑️ Email moved to trash: ${messageId}`,
      });
    } else {
      await respond({
        response_type: 'ephemeral',
        text: `❌ Failed to trash email`,
      });
    }
  } catch (error) {
    console.error('Error trashing email:', error);
    await respond({
      response_type: 'ephemeral',
      text: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
});

// /gmail-help - Show available commands
app.command('/gmail-help', async ({ ack, respond }) => {
  await ack();

  const helpText = `
*📧 Gmail Slack Bot - Full Feature List*

*🤖 Main Command:* \`/gmail <anything>\` - Ask in plain English!
💬 *NEW: Conversation memory!* I remember our chat for 30 mins.

*🧠 CONVERSATION FEATURES:*
• Multi-turn conversations - refer to previous results
• Say "unsubscribe from 1, 3, 5" after seeing a list
• \`/gmail clear\` - Reset conversation memory

*📬 EMAIL OPERATIONS (17):*
• List/search emails • Read email content
• Send new emails • Reply to emails (+ reply all)
• Forward emails • Mark as read/unread
• Star/unstar emails • Archive emails
• Trash emails • Restore from trash
• Permanently delete • Get unread count
• Batch modify labels • Batch star emails
• Get email by ID • Search with any Gmail operator

*🧵 THREADS (1):*
• Get full email conversation thread

*📎 ATTACHMENTS (2):*
• List email attachments • Download attachments

*🏷️ LABELS (4):*
• List all labels • Create labels
• Update/rename labels • Delete labels

*✉️ DRAFTS (6):*
• List drafts • Get draft content
• Create new draft • Update draft
• Delete draft • Send draft

*⚙️ SETTINGS (2):*
• Get vacation responder • Set vacation auto-reply

*🔗 MARKETING (2):*
• Find marketing emails • Get unsubscribe links

*📋 Direct Commands:*
\`/gmail-list\` \`/gmail-unread\` \`/gmail-search\`
\`/gmail-read\` \`/gmail-send\` \`/gmail-mark-read\`
\`/gmail-trash\` \`/gmail-help\`
`;

  await respond({
    response_type: 'ephemeral',
    text: helpText,
  });
});

// Start the app
(async () => {
  const port = parseInt(process.env.PORT || '3000');
  await app.start(port);
  console.log(`⚡️ Gmail Slack Bot is running on port ${port}`);
})();
