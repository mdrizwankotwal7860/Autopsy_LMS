import { PDFDocument, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

export const generateCertificatePDF = async (data: {
  studentName: string;
  courseName: string;
  completionDate: string;
  certificateId: string;
  institution: string;
}): Promise<Buffer> => {
  // Load the supplied template
  const templatePath = path.join(process.cwd(), 'docs', 'certificate', 'certificate-template.pdf');
  const templateBytes = fs.readFileSync(templatePath);
  
  const pdfDoc = await PDFDocument.load(templateBytes);
  const page = pdfDoc.getPage(0);
  
  // Mask 1: Student Name
  // PyMuPDF coords: y=253 to 283 -> pdf-lib (bottom-left) y=329 to 359
  page.drawRectangle({
    x: 100,
    y: 325,
    width: 592,
    height: 40,
    color: rgb(1, 1, 1),
  });

  // Mask 2: Course, Date, Institution
  // PyMuPDF coords: y=321 to 402 -> pdf-lib (bottom-left) y=210 to 291
  page.drawRectangle({
    x: 100,
    y: 195,
    width: 592,
    height: 100,
    color: rgb(1, 1, 1),
  });

  // Mask 3: Certificate ID (if there is one in the template footer we need to mask, but the template probably doesn't have one, or we can just draw it at the bottom left)
  // We'll draw the certificate ID at the bottom left safely.

  // Embed standard fonts
  // We'll use standard fonts for simplicity and safety, similar to Helvetica or Times
  const helveticaFont = await pdfDoc.embedFont('Helvetica-Bold');
  const helveticaRegular = await pdfDoc.embedFont('Helvetica');

  // Draw Student Name
  const studentNameWidth = helveticaFont.widthOfTextAtSize(data.studentName, 28);
  page.drawText(data.studentName, {
    x: (page.getWidth() - studentNameWidth) / 2,
    y: 335,
    size: 28,
    font: helveticaFont,
    color: rgb(0, 0, 0),
  });

  // Draw Course Name
  const courseText = `User Training of the ${data.courseName}`;
  const courseWidth = helveticaFont.widthOfTextAtSize(courseText, 18);
  page.drawText(courseText, {
    x: (page.getWidth() - courseWidth) / 2,
    y: 275,
    size: 18,
    font: helveticaFont,
    color: rgb(0, 0, 0),
  });

  // Draw Date
  const dateText = `on ${data.completionDate}`;
  const dateWidth = helveticaRegular.widthOfTextAtSize(dateText, 14);
  page.drawText(dateText, {
    x: (page.getWidth() - dateWidth) / 2,
    y: 245,
    size: 14,
    font: helveticaRegular,
    color: rgb(0, 0, 0),
  });

  // Draw Institution
  if (data.institution) {
    const instWidth = helveticaRegular.widthOfTextAtSize(data.institution, 14);
    page.drawText(data.institution, {
      x: (page.getWidth() - instWidth) / 2,
      y: 215,
      size: 14,
      font: helveticaRegular,
      color: rgb(0, 0, 0),
    });
  }

  // Draw Certificate ID at bottom
  page.drawText(`Certificate ID: ${data.certificateId}`, {
    x: 50,
    y: 30,
    size: 10,
    font: helveticaRegular,
    color: rgb(0.5, 0.5, 0.5),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
};
