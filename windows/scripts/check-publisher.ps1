param([Parameter(Mandatory)][string[]] $Files, [Parameter(Mandatory)][string] $Publisher)
$ErrorActionPreference = 'Stop'
foreach ($file in $Files) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate) {
        throw "Missing valid timestamped Authenticode signature on $file ($($signature.Status))"
    }
    if ($signature.SignerCertificate.GetNameInfo('SimpleName', $false) -cne $Publisher) {
        throw "Unexpected publisher for $file"
    }
    Write-Output "Verified publisher and timestamp on $file"
}
