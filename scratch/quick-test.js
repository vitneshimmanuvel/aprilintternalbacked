require('dotenv').config();
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

(async () => {
  try {
    console.log('--- Verifying Cloudinary Upload with New Key Roles ---');
    const testBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          folder: 'leadflow_test',
          public_id: 'verified_key_test'
        },
        (error, result) => {
          if (result) resolve(result);
          else reject(error);
        }
      ).end(testBuffer);
    });

    console.log('SUCCESS! Upload completed successfully!');
    console.log('Uploaded File URL:', result.secure_url);
  } catch (error) {
    console.error('Upload Failed:', error);
  }
})();
