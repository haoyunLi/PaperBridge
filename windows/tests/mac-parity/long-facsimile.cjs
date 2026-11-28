const fs = require('node:fs');

// Generate a small, deterministic, selectable PDF for both platform readers.
function longFacsimile() {
  const count = 125;
  const pages = Array.from({ length: count }, (_, index) => (4 + index * 2) + ' 0 R');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count ' + count + ' /Kids [' + pages.join(' ') + '] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  for (let number = 1; number <= count; number++) {
    const text = 'Observation ' + number + ' in the printed notebook.';
    const stream = 'BT /F1 12 Tf 38 480 Td (' + text + ') Tj ET';
    const contents = objects.length + 2;
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 560] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + contents + ' 0 R >>');
    objects.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
  }
  let file = '%PDF-1.4\n';
  const offsets = ['0000000000 65535 f '];
  objects.forEach((object, index) => {
    offsets.push(String(file.length).padStart(10, '0') + ' 00000 n ');
    file += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  });
  const start = file.length;
  file += 'xref\n0 ' + offsets.length + '\n' + offsets.join('\n') + '\ntrailer\n<< /Root 1 0 R /Size ' + offsets.length + ' >>\nstartxref\n' + start + '\n%%EOF\n';
  return Buffer.from(file, 'ascii');
}

if (require.main === module) fs.writeFileSync(process.argv[2], longFacsimile());
module.exports = { longFacsimile };
