'use strict';

const crypto = require('crypto');

function evpBytesToKey(password, salt, keyLength, ivLength) {
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);

  while (derived.length < keyLength + ivLength) {
    const md5 = crypto.createHash('md5');
    md5.update(block);
    md5.update(password);
    md5.update(salt);
    block = md5.digest();
    derived = Buffer.concat([derived, block]);
  }

  return {
    key: derived.subarray(0, keyLength),
    iv: derived.subarray(keyLength, keyLength + ivLength),
  };
}

function decryptUserData(encryptedData) {
  const sharedSecret = process.env.HIGHLEVEL_APP_SHARED_SECRET;
  if (!sharedSecret) {
    throw Object.assign(
      new Error('HIGHLEVEL_APP_SHARED_SECRET is required for embedded HighLevel user context'),
      { status: 500 }
    );
  }

  if (!encryptedData || typeof encryptedData !== 'string') {
    throw Object.assign(new Error('Missing encryptedData payload'), { status: 400 });
  }

  const raw = Buffer.from(encryptedData, 'base64');
  const prefix = raw.subarray(0, 8).toString('utf8');

  if (prefix !== 'Salted__') {
    throw Object.assign(new Error('Unsupported encrypted payload format'), { status: 400 });
  }

  const salt = raw.subarray(8, 16);
  const ciphertext = raw.subarray(16);
  const { key, iv } = evpBytesToKey(Buffer.from(sharedSecret, 'utf8'), salt, 32, 16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

  return JSON.parse(decrypted);
}

module.exports = { decryptUserData };
