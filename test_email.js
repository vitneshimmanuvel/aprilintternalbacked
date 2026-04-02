const nodemailer = require('nodemailer');

const test = async () => {
  try {
    const t = nodemailer.createTransport({ 
      service: 'gmail', 
      auth: { user: 'vitneshsettlo@gmail.com', pass: 'gnid rdqi tipn rggi' } 
    });
    
    console.log('Sending...');
    const result = await t.sendMail({ 
      from: 'vitneshsettlo@gmail.com', 
      to: 'vitneshimmanuvel@gmail.com', 
      subject: 'Test Email', 
      text: 'Testing nodemaile from local' 
    });
    console.log('Success:', result);
  } catch (err) {
    console.error('Failure:', err);
  }
};
test();
