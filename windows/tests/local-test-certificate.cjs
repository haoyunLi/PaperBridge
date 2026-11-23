const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

// CertificateRequest generates an ephemeral identity entirely in memory.
async function localTestCertificate() {
  const script = `$ErrorActionPreference='Stop'
    $rsa=[Security.Cryptography.RSA]::Create(2048)
    $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=papers.localhost',$rsa,'SHA256',[Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $san=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddDnsName('papers.localhost')
    $request.CertificateExtensions.Add($san.Build())
    $cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddHours(2))
    try {
      [pscustomobject]@{pem=$cert.ExportCertificatePem();pfx=[Convert]::ToBase64String($cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,'test-only'))} | ConvertTo-Json -Compress
    } finally { $cert.Dispose(); $rsa.Dispose() }`;
  const { stdout } = await exec('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  const cert = JSON.parse(stdout);
  return { pem: cert.pem, server: { pfx: Buffer.from(cert.pfx, 'base64'), passphrase: 'test-only' } };
}
module.exports = { localTestCertificate };
