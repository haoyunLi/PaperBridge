const { createVerifier } = require('sigstore');

if (process.versions.electron) {
  // Electron's BoringSSL reports NO_DEFAULT_DIGEST for P-256. Rekor and
  // Sigstore's ephemeral P-256 keys use ECDSA/SHA-256. Supply only that
  // missing digest to the SDK; explicit algorithms and other keys pass through.
  const { crypto } = require('@sigstore/core');
  const verify = crypto.verify;
  crypto.verify = (data, key, signature, algorithm) => {
    const p256 = key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
    return verify(data, key, signature, algorithm ?? (p256 ? 'sha256' : algorithm));
  };
}

module.exports = { createVerifier };
