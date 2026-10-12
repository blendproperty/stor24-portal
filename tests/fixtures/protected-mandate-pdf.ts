// Synthetic structure-only encrypted PDF fixture; contains no bank or ID data.
export function protectedMandatePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
    "<< /Filter /Standard /V 1 /R 2 /O <"+"00".repeat(32)+"> /U <"+"00".repeat(32)+"> /P -4 >>",
  ];
  let source="%PDF-1.4\n";const offsets=[0];
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(source));source+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(source);
  source+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(x=>String(x).padStart(10,"0")+" 00000 n \n").join("")}trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${"00".repeat(16)}> <${"00".repeat(16)}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}
