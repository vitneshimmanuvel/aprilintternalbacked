const nodemailer = require('nodemailer');

const createTransporter = () => {
  if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASS) {
    console.warn('⚠️ SMTP variables not set. Emails will not be sent.');
    return null;
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASS
    }
  });
};

const sendEmail = async (to, subject, text, html = '') => {
  const transporter = createTransporter();
  if (!transporter) return false;

  try {
    const mailOptions = {
      from: `"Payana Overseas" <${process.env.SMTP_EMAIL}>`,
      to,
      subject,
      text,
      html: html || text.replace(/\n/g, '<br>')
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email sent to ${to}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending email:', error);
    return false;
  }
};

/**
 * Send a professional notification email with lead details.
 * @param {string} userId - Recipient user ID
 * @param {string} leadId - Lead ID (for reference)
 * @param {string} subject - Email subject
 * @param {string} actionText - What happened (e.g. "A lead has been assigned to you")
 * @param {object} details - { leadTitle, clientName, actionBy, extraInfo }
 */
const sendActionEmail = async (userId, leadId, subject, actionText, details = {}) => {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const recipientResult = await pool.query('SELECT email, name FROM users WHERE id = $1', [userId]);
    const recipient = recipientResult.rows[0];
    if (recipient && recipient.email) {
      const leadTitle = details.leadTitle || '';
      const clientName = details.clientName || '';
      const actionBy = details.actionBy || '';
      const extraInfo = details.extraInfo || '';

      const emailContent = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb;">
          <div style="background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 24px 30px;">
            <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 600;">Payana Overseas</h1>
            <p style="color: #dbeafe; margin: 4px 0 0; font-size: 13px;">Lead Management System</p>
          </div>
          
          <div style="padding: 28px 30px;">
            <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">Hello <strong>${recipient.name}</strong>,</p>
            <p style="font-size: 14px; color: #4b5563; margin: 0 0 20px;">${actionText}</p>
            
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px; margin-bottom: 20px;">
              ${leadTitle ? `<div style="display: flex; margin-bottom: 10px;"><span style="font-size: 12px; color: #6b7280; width: 110px; flex-shrink: 0;">Lead Title</span><span style="font-size: 14px; color: #111827; font-weight: 600;">${leadTitle}</span></div>` : ''}
              ${clientName ? `<div style="display: flex; margin-bottom: 10px;"><span style="font-size: 12px; color: #6b7280; width: 110px; flex-shrink: 0;">Client Name</span><span style="font-size: 14px; color: #111827;">${clientName}</span></div>` : ''}
              ${actionBy ? `<div style="display: flex; margin-bottom: 10px;"><span style="font-size: 12px; color: #6b7280; width: 110px; flex-shrink: 0;">Action By</span><span style="font-size: 14px; color: #111827;">${actionBy}</span></div>` : ''}
              ${extraInfo ? `<div style="display: flex;"><span style="font-size: 12px; color: #6b7280; width: 110px; flex-shrink: 0;">Details</span><span style="font-size: 14px; color: #111827;">${extraInfo}</span></div>` : ''}
            </div>

            <p style="font-size: 13px; color: #6b7280; margin: 0;">Please log in to <strong>LeadFlow</strong> to review the details.</p>
          </div>
          
          <div style="background: #f9fafb; border-top: 1px solid #e5e7eb; padding: 16px 30px;">
            <p style="font-size: 11px; color: #9ca3af; margin: 0; text-align: center;">This is an automated notification from Payana Overseas Lead Management System.</p>
          </div>
        </div>
      `;
      await sendEmail(recipient.email, subject, '', emailContent);
    }
  } catch (err) {
    console.error('Failed to send action email:', err);
  }
};

module.exports = {
  sendEmail,
  sendActionEmail
};
