import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

const accountId = process.env.R2_ACCOUNT_ID || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const bucketName = process.env.R2_BUCKET_NAME || '';

export const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

export const uploadFile = async (fileBuffer: Buffer, mimetype: string, originalName: string, folder: string) => {
  const extension = originalName.split('.').pop();
  const fileName = `${folder}/${uuidv4()}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: fileBuffer,
    ContentType: mimetype,
  });

  await s3Client.send(command);

  return fileName;
};

export const getFileUrl = async (key: string, expiresIn = 3600) => {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  // return presigned URL for private access
  return await getSignedUrl(s3Client, command, { expiresIn });
};

export const deleteFile = async (key: string) => {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  await s3Client.send(command);
};
