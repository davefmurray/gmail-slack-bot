import { App, LogLevel } from '@slack/bolt';
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

// Initialize Slack Bolt app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  logLevel: LogLevel.INFO,
});

// ===================
// SLASH COMMANDS
// ===================

// /gmail - List recent emails
app.command('/gmail', async ({ command, ack, respond }) => {
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
*📧 Gmail Slack Bot Commands*

\`/gmail [count]\` - List recent emails (default: 5, max: 10)
\`/gmail-unread [count]\` - List unread emails
\`/gmail-search <query>\` - Search emails (uses Gmail search syntax)
\`/gmail-read <id>\` - Read a specific email by ID
\`/gmail-send to@email | Subject | Body\` - Send an email
\`/gmail-mark-read <id>\` - Mark email as read
\`/gmail-trash <id>\` - Move email to trash
\`/gmail-help\` - Show this help message

*Search Examples:*
• \`/gmail-search from:boss@company.com\`
• \`/gmail-search subject:urgent\`
• \`/gmail-search is:starred\`
• \`/gmail-search after:2024/01/01\`
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
