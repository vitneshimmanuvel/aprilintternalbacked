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
      from: `"Lead Management" <${process.env.SMTP_EMAIL}>`,
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

const sendActionEmail = async (userId, leadId, subject, title, bodyHtml) => {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const assigneeResult = await pool.query('SELECT email, name FROM users WHERE id = $1', [userId]);
    const assignee = assigneeResult.rows[0];
    if (assignee && assignee.email) {
      const emailContent = `
        <h2>LeadFlow CRM Notification</h2>
        <p>Hello ${assignee.name},</p>
        <p>${title}</p>
        <div style="background:#f4f4f4;padding:10px;margin-bottom:10px;border-radius:5px;">
           ${bodyHtml}
        </div>
      `;
      await sendEmail(assignee.email, subject, '', emailContent);
    }
  } catch (err) {
    console.error('Failed to send action email:', err);
  }
};

module.exports = {
  sendEmail,
  sendActionEmail
};
