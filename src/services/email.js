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
      from: `"LeadFlow CRM" <${process.env.SMTP_EMAIL}>`,
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

module.exports = {
  sendEmail
};
