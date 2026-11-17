const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_DIMENSION = 3000;
const START_OF_IMAGE = Buffer.from([0xff, 0xd8]);
const END_OF_IMAGE = Buffer.from([0xff, 0xd9]);
const START_OF_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function privacyError(message) {
  const error = new Error(message);
  error.code = "PHOTO_PRIVACY_REJECTED";
  return error;
}

function validateJpeg(photo) {
  const buffer = photo?.buffer;
  if (photo?.mimetype !== "image/jpeg" || !Buffer.isBuffer(buffer) || buffer.length < 16 ||
      buffer.length > MAX_PHOTO_BYTES || !buffer.subarray(0, 2).equals(START_OF_IMAGE) ||
      !buffer.subarray(-2).equals(END_OF_IMAGE)) {
    throw privacyError("The upload must be a valid, locally processed JPEG. Select the photo again; the original was not sent to Gemini.");
  }

  let position = 2;
  let dimensionsFound = false;
  while (position < buffer.length - 2) {
    if (buffer[position] !== 0xff) {
      throw privacyError("The processed photo is invalid. No photo was sent to Gemini.");
    }
    while (buffer[position] === 0xff) position += 1;
    const marker = buffer[position++];
    if (marker === 0xda) break;
    if (marker === 0xd9 || marker === 0x00) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (position + 2 > buffer.length) {
      throw privacyError("The processed photo is incomplete. No photo was sent to Gemini.");
    }
    const segmentLength = buffer.readUInt16BE(position);
    if (segmentLength < 2 || position + segmentLength > buffer.length) {
      throw privacyError("The processed photo is invalid. No photo was sent to Gemini.");
    }
    if ([0xe1, 0xed, 0xfe].includes(marker)) {
      throw privacyError("The processed photo contains identifying metadata. Reprocess it locally before upload.");
    }
    if (START_OF_FRAME_MARKERS.has(marker)) {
      const height = buffer.readUInt16BE(position + 3);
      const width = buffer.readUInt16BE(position + 5);
      if (!width || !height || Math.max(width, height) > MAX_PHOTO_DIMENSION) {
        throw privacyError("The processed photo has unsupported dimensions. No photo was sent to Gemini.");
      }
      dimensionsFound = true;
    }
    position += segmentLength;
  }
  if (!dimensionsFound) {
    throw privacyError("The processed photo has no valid image dimensions. No photo was sent to Gemini.");
  }
  return photo;
}

function validateRedactedPhotos(photos) {
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > 3) {
    throw privacyError("Upload between 1 and 3 locally processed photos.");
  }
  return photos.map(validateJpeg);
}

module.exports = { validateRedactedPhotos };
