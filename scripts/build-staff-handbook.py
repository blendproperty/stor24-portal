"""Render the versioned staff handbook. Requires reportlab; no live system calls."""
from pathlib import Path
import html
import re
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/STAFF_HANDBOOK_2026-10-15.md'
TARGET = ROOT / 'private/staff-training/stor24-staff-handbook-2026-10-15.pdf'
INK, MUTED, ORANGE = colors.HexColor('#163238'), colors.HexColor('#52656B'), colors.HexColor('#F05A00')
WIDTH = A4[0] - 84
styles = {
    'body': ParagraphStyle('body', fontName='Helvetica', fontSize=10, leading=14.4, textColor=INK, spaceAfter=10),
    'title': ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=24, leading=29, textColor=INK, spaceAfter=17),
    'cover': ParagraphStyle('cover', fontName='Helvetica-Bold', fontSize=48, leading=54, textColor=INK, spaceAfter=22),
    'table': ParagraphStyle('table', fontName='Helvetica', fontSize=8.7, leading=12, textColor=INK),
    'caption': ParagraphStyle('caption', fontName='Helvetica-Oblique', fontSize=8, leading=11, textColor=MUTED, spaceAfter=10),
}
def inline(text):
    value = html.escape(text)
    return re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', value)

def chrome(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(INK); canvas.setFont('Helvetica-Bold', 15); canvas.drawString(42, A4[1] - 35, 'STOR24')
    canvas.setFillColor(ORANGE); canvas.rect(42, A4[1] - 45, 31, 3, fill=1, stroke=0)
    canvas.setFillColor(MUTED); canvas.setFont('Helvetica', 8); canvas.drawRightString(A4[0] - 42, A4[1] - 34, 'STORE OPERATIONS  /  STAFF HANDBOOK')
    canvas.setStrokeColor(colors.HexColor('#DAE3E5')); canvas.line(42, 39, A4[0] - 42, 39)
    canvas.setFont('Helvetica', 8); canvas.drawString(42, 26, '15 October 2026  |  Check for an updated edition before training')
    canvas.drawRightString(A4[0] - 42, 26, str(doc.page)); canvas.restoreState()

def table(lines):
    rows = [[Paragraph(inline(cell.strip()), styles['table']) for cell in line.strip('|').split('|')] for line in lines if not re.match(r'^\|[\s|:-]+\|$', line)]
    result = Table(rows, colWidths=[30, WIDTH - 160, 130], repeatRows=1, hAlign='LEFT')
    result.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#EDF3F4')), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LINEBELOW', (0, 0), (-1, 0), .7, ORANGE), ('LINEBELOW', (0, 1), (-1, -1), .4, colors.HexColor('#DBE5E7')), ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 8), ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7)]))
    return result

def main():
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    sections = re.split(r'^## ', SOURCE.read_text(encoding='utf-8'), flags=re.M)
    story = []
    for index, section in enumerate(sections):
        if index: story.append(PageBreak())
        blocks = section.strip().split('\n\n')
        title = blocks.pop(0).strip().removeprefix('# ')
        if not index: story.append(Spacer(1, 72))
        story.append(Paragraph(inline(title), styles['cover' if not index else 'title']))
        for block in blocks:
            if block.startswith('|'):
                story.extend([table(block.splitlines()), Spacer(1, 12)])
            elif block.startswith('!['):
                match = re.match(r'!\[(.*?)\]\((.*?)\)', block)
                if not match: raise ValueError('Invalid handbook image')
                image = Image(str(SOURCE.parent / match.group(2)))
                factor = min(WIDTH / image.imageWidth, 290 / image.imageHeight)
                image.drawWidth = image.imageWidth * factor; image.drawHeight = image.imageHeight * factor
                story.extend([image, Spacer(1, 5), Paragraph(inline(match.group(1)), styles['caption'])])
            else:
                for line in block.splitlines(): story.append(Paragraph(inline(line), styles['body']))
    doc = SimpleDocTemplate(str(TARGET), pagesize=A4, leftMargin=42, rightMargin=42, topMargin=69, bottomMargin=52, title='STOR24 Store Operations Handbook - 15 October 2026', author='STOR24', pageCompression=1)
    doc.build(story, onFirstPage=chrome, onLaterPages=chrome)
    output = ROOT / 'output/pdf'; output.mkdir(parents=True, exist_ok=True)
    (output / TARGET.name).write_bytes(TARGET.read_bytes())
    print(str(TARGET))

if __name__ == '__main__': main()
