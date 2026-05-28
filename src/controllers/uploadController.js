const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadToCloudinary = (fileBuffer, originalName) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'auto',
        folder: 'leadflow_attachments',
        public_id: originalName.split('.')[0] + '_' + Date.now()
      },
      (error, result) => {
        if (result) {
          resolve({
            url: result.secure_url,
            name: originalName,
            type: result.resource_type || result.format
          });
        } else {
          reject(error);
        }
      }
    );
    stream.end(fileBuffer);
  });
};

const uploadFiles = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const uploadPromises = req.files.map(file => 
      uploadToCloudinary(file.buffer, file.originalname)
    );

    const uploadedFiles = await Promise.all(uploadPromises);
    
    res.status(200).json({ 
      message: 'Files uploaded successfully', 
      files: uploadedFiles 
    });
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    
    let errorMessage = err.message || 'Failed to upload files to Cloudinary';
    if (err.http_code === 403) {
      errorMessage = `Cloudinary Upload Forbidden (403): The API Key 'payanaleaddashboard' lacks the 'create' permission required to write files. Action Required: Please go to your Cloudinary Console (Settings > API Keys), click the actions menu next to 'payanaleaddashboard', edit its permissions, and change its access level to allow uploads (Full Access or Create permission).`;
    }

    res.status(500).json({ 
      message: errorMessage, 
      error: err.message 
    });
  }
};

module.exports = { uploadFiles };
