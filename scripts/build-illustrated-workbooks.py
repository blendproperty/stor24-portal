from pathlib import Path
import textwrap
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader

ROOT=Path(__file__).resolve().parents[1]
pdfmetrics.registerFont(TTFont('A','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('AB','C:/Windows/Fonts/arialbd.ttf'))
W,H=A4; GREEN=HexColor('#173d31'); ORANGE=HexColor('#ed681b'); CREAM=HexColor('#f5f7ef'); PALE=HexColor('#e7f0e5'); MUTED=HexColor('#546a60'); DARK=HexColor('#172f27')

def text(c,x,y,s,size=10,font='A',colour=DARK):
 c.setFont(font,size); c.setFillColor(colour); c.drawString(x,y,s)
def wrap(c,s,x,y,width=470,size=10,leading=15,font='A',colour=DARK):
 words=s.split(); line=''
 for w in words:
  t=(line+' '+w).strip()
  if pdfmetrics.stringWidth(t,font,size)>width and line:
   text(c,x,y,line,size,font,colour); y-=leading; line=w
  else: line=t
 if line: text(c,x,y,line,size,font,colour); y-=leading
 return y

def header(c,section,n):
 c.setFillColor(GREEN);c.rect(0,H-41,W,41,fill=1,stroke=0)
 text(c,36,H-26,'STOR24  /  '+section.upper(),9,'AB',white)
 c.setFillColor(ORANGE);c.rect(36,29,W-72,2,fill=1,stroke=0)
 text(c,36,17,'STAFF REVIEW COPY  |  26 NOV 2026',7,'A',MUTED); c.setFont('AB',8);c.setFillColor(MUTED);c.drawRightString(W-36,17,str(n))
def title(c,k,heading,sub):
 text(c,36,H-69,k.upper(),9,'AB',ORANGE)
 text(c,36,H-96,heading,20,'AB',GREEN)
 wrap(c,sub,36,H-116,510,9.5,13,colour=MUTED)
def box(c,x,y,w,h,label,body,colour=PALE):
 c.setFillColor(colour);c.roundRect(x,y,w,h,8,fill=1,stroke=0)
 text(c,x+12,y+h-19,label.upper(),9,'AB',GREEN)
 wrap(c,body,x+12,y+h-36,w-24,9,12)
def steps(c,items,y):
 for i,s in enumerate(items,1):
  c.setFillColor(ORANGE);c.circle(48,y+2,10,fill=1,stroke=0);c.setFillColor(white);c.setFont('AB',9);c.drawCentredString(48,y-1,str(i))
  y=wrap(c,s,66,y-1,480,10,14)-10
 return y
def strip(c,labels,y):
 w=510/len(labels)
 for i,l in enumerate(labels):
  c.setFillColor(PALE if i%2==0 else CREAM);c.roundRect(36+i*w,y,w-4,44,5,fill=1,stroke=0)
  c.setFont('AB',9);c.setFillColor(GREEN);c.drawCentredString(36+i*w+(w-4)/2,y+17,l)
def diagram(c,labels,top):
 # A deliberately schematic map, labelled as such, supports scanning without pretending to be a screenshot.
 text(c,48,top,'YOUR ROUTE  /  ILLUSTRATED SEQUENCE',8,'AB',MUTED)
 y=top-95; width=116
 for i,label in enumerate(labels):
  x=48+i*125
  c.setFillColor(CREAM); c.roundRect(x,y,width,70,8,fill=1,stroke=0)
  c.setFillColor(ORANGE);c.circle(x+20,y+47,12,fill=1,stroke=0)
  c.setFillColor(white);c.setFont('AB',10);c.drawCentredString(x+20,y+43,str(i+1))
  text(c,x+12,y+18,label,9,'AB',GREEN)
  if i<len(labels)-1:
   c.setStrokeColor(ORANGE);c.setLineWidth(1.4);c.line(x+width+1,y+34,x+width+8,y+34)
 text(c,48,y-15,'Use the numbered instructions above for the actual clicks and checks.',8,'A',MUTED)

def page(c,section,n,heading,sub,labels,items,check,stop,screen=None):
 header(c,section,n);title(c,'STEP-BY-STEP',heading,sub);strip(c,labels,H-192)
 y=H-219; y=steps(c,items,y)
 if screen:
  img=ImageReader(str(ROOT/'docs'/'facility-guide-images'/screen)); iw,ih=img.getSize(); width=480; height=min(235,width*ih/iw); width=height*iw/ih
  if y-height-18<170: raise ValueError(f'content too long for screenshot: {heading} {y}')
  c.drawImage(img,48,y-height,width=width,height=height,mask='auto'); y-=height+12
  text(c,48,y,'Real portal component shown with invented training data.',7,'A',MUTED); y-=18
 if y<170: raise ValueError(f'content overlaps notes: {heading} {y}')
 if not screen and y>310: diagram(c,labels,min(y-12,350))
 box(c,36,100,510,55,'Check yourself',check)
 box(c,36,42,510,52,'Remember',stop,CREAM)
 c.showPage()
def cover(c,section,subtitle,items):
 c.setFillColor(GREEN);c.rect(0,H-260,W,260,fill=1,stroke=0)
 text(c,42,H-66,'STOR24  /  PRACTICAL WORKBOOK',11,'AB',white)
 for i,line in enumerate(section.split('\n')): text(c,42,H-119-35*i,line,29,'AB',white)
 wrap(c,subtitle,42,H-205,475,11,16,colour=white)
 text(c,42,H-304,'WHAT YOU WILL DO',10,'AB',ORANGE)
 y=H-335
 for item in items:
  c.setFillColor(ORANGE);c.circle(49,y+3,4,fill=1,stroke=0);y=wrap(c,item,64,y,475,11,17)-12
 box(c,42,100,510,75,'How to use this guide','Follow one numbered step at a time. Read the CHECK and REMEMBER boxes. Illustrations are learning aids; your permissions and live screen determine what is available.')
 text(c,42,45,'REVIEW COPY  |  26 NOVEMBER 2026',9,'AB',MUTED);c.showPage()

training=[
('Your first five minutes','Start at Operations and make sure you are in the right place.',['SIGN IN','STORE','OPERATIONS','HELP'],['Sign in with your own staff account and authenticator. Check the facility shown in the sidebar.','Open Operations. Find the page tip near the top and the Guide me button in the header.','Select Show me the steps. Read the first instruction, then use Show me on this page to find its orange outline.','To hide help, choose Turn tips off. To restore it, open Guide me and switch Guide mode on.'], 'Can you open the walkthrough and turn help off and back on?','Help progress records reading; it does not perform the work.','page-tip.png'),
('Plan the day','Start with queues, then open the real source record.',['TASKS','ARRIVALS','CHECKS','PRIORITY'],['In Operations review assigned tasks, maintenance and expected arrivals for your permitted store.','Read the owner, due date, location and status. Open the item before deciding what to do.','Agree which items need attention first and who will cover each arrival.','If a count or list is unavailable, report the problem and use the approved fallback.'],'Point out one task and who owns it.','Unavailable does not mean zero. Do not mark physical work complete until it is done.','operations-fixture.png'),
('Opening the facility','A checklist is evidence of work done, not a substitute for the inspection.',['WALK','CHECK','RECORD','REVIEW'],['Open Operations > Checklists and choose the relevant opening checklist and store.','Walk the site and check each item physically. Record what you actually find and include any exception.','Save progress, then submit the completed checklist to the assigned independent reviewer.','Reopen the saved result and follow the site escalation procedure for a failed check.'],'Explain the difference between saved progress and independent review.','Follow the emergency process for immediate danger; a checklist does not alert emergency services.',None),
('Find a unit','Match the system to the real door before a customer arrives.',['STORE','FLOOR','UNIT','INSPECT'],['Open Facility map or Units & rates. Choose the permitted store and floor.','Find the exact unit and compare the displayed number and location with the physical signage.','Inspect the unit. Record defects using the correct unit or facility-level maintenance request.','If map, signage and inventory disagree, stop and report the mismatch for correction.'],'Which unit is being discussed and where will you find it physically?','Do not change availability merely to make a booking fit.',None),
('Record a task','A clear task gives the next person a practical action.',['WHO','WHERE','WHAT','WHEN'],['Open Operations and choose New task when authorised. Select the correct store.','Enter the title, description, priority and agreed due date. The creation form does not offer an assignee; agree ownership with the team.','Create once. Find the saved task in the queue and check its details.','After the real work is done, complete the task if authorised and reload the record.'],'Can you describe the work and owner without opening another screen?','If the save response is uncertain, check the record before trying again.','task-fixture.png'),
('Report maintenance','Use the correct location so unit availability is not affected by mistake.',['FAULT','LOCATION','OWNER','FOLLOW UP'],['Find Maintenance queue in Operations and choose New request when authorised.','Choose the right store. Link a unit only when that specific unit is affected; shared areas use a facility-level request.','Describe the fault and priority. Save once, then reopen the request to check the result.','For Midpoint job cards, Carlo manages the repair and Katlego verifies it on site before closure. Follow the authorised workflow.'],'Is the fault on a particular unit or in a shared area?','Unit-linked maintenance can change live availability. A request does not call a contractor.',None),
('Prepare for an arrival','Arrange the unit, person and time before the customer reaches the store.',['ARRIVALS','BOOKING','COVER','RECHECK'],['Open Operations > Expected arrivals. Select the store and date range; check undated bookings separately.','Open the correct reservation and confirm the customer, facility, unit and agreed arrival date.','Read the current blockers. Agree who will meet the customer and record any practical instructions.','The covering colleague acknowledges their own cover. Recheck the booking on the day.'],'What is the next blocker and who can resolve it?','Cover and a clean unit do not override payment, agreement or identity requirements.',None),
('Katlego example: find Unit 043','Use the Unit 043 rehearsal as a learning scenario, not as a real handover.',['FIND','MATCH','OPEN','READ'],['In an approved practice environment, find the Unit 043 example and open its linked booking.','Match the customer, facility and unit on the booking before opening Move in.','Point to the agreement, payment, identity and photo cards. Read any blocker before taking action.','If the example or details differ from the real person, stop and ask the trainer.'],'Can you identify the exact booking without changing it?','Never use a fictional profile or practice receipt to clear a real customer.', 'move-in-checks.png'),
('Agreement and payment','A signature, mandate and cleared payment are separate checks.',['AGREEMENT','DUE','PAYMENT','EXCEPTION'],['On the correct signed booking choose View signed agreement to inspect the original.','Read the amount required, agreed date, recorded payment and any displayed blockers.','A test payment is practice only. A debit mandate is permission for an arrangement; it is not proof of received funds.','If payment is missing, unclear or disputed, ask finance and leave the handover blocked.'],'Explain which evidence proves the agreement and which proves payment.','Follow current finance holds and approvals. Do not assume a pending transaction is settled.',None),
('Identity and photo','Each step belongs to the authorised person and the correct customer.',['IDENTITY','CONSENT','PHOTO','REVIEW'],['Read the identity card and use Review ID only if your role allows it. Compare the original ID with the person as required.','Read the photo card and its explanation. Where collection is enabled, the customer decides whether to consent and supplies their own photo.','The authorised reviewer checks the submitted photo. If a QR has expired or collection is held, follow the displayed instruction and escalate.','Ask the access operator about provider linking and a supervised reader test.'],'What is the difference between a reviewed photo and a tested reader?','Never borrow another person’s account, ID, photograph or consent.',None),
('The actual handover','Only an authorised real handover should change the record.',['RECHECK','PERSON','KEYS','VERIFY'],['On arrival, confirm the correct customer, facility, unit, agreed date and original identity.','Read all blockers again. Resolve or escalate missing agreement, funds, identity, photo or access checks.','Only an authorised staff member confirms handover when the physical keys really change hands.','Reload the booking and verify the saved result. If uncertain, check the record before repeating an action.'],'Tell the trainer the last check before handing over keys.','In a rehearsal, leave confirmation and attestation untouched.',None),
('Follow-up and shift handover','Leave a clear next action for the colleague who follows you.',['CUSTOMER','TIME','OWNER','COVER'],['Open the correct customer follow-up and record the agreed action and SAST time.','Name the owner and add cover where appropriate. Save once and reopen to verify.','Ask the covering colleague to acknowledge their own cover in the system.','Explain unresolved arrivals, faults and tasks in the shift handover.'],'Who is responsible, what will they do and by when?','Marking an event as read does not send a message to a customer.',None),
('Merchandise and shared devices','Keep physical stock, the order and the device state aligned.',['ORDER','COUNT','ISSUE','VERIFY'],['Open the actual order and check its collection status, item and quantity.','Use the permitted fulfilment workflow only when the goods are physically issued. Check order and stock afterwards.','Keep staff sessions on staff devices. Clear the customer device between visitors and check for a fresh entry screen.','During an outage, use the approved prepared-device procedure and reconcile queued work after reconnection.'],'What would you check after an item is issued?','A stock return is not a refund. Do not practise on a live order.',None),
('Practice: explain the exception','Try this scenario aloud with a trainer.',['READ','STOP','ASK','RECHECK'],['Scenario: the booking has a signed agreement, but payment is shown as a test and the photo is not reviewed.','Point to each issue on the screen. Explain why a signed agreement alone does not clear the booking.','Name the finance and identity/access colleagues who can investigate the respective issues.','Explain why keys must wait, then show where you would recheck the real booking after resolution.'],'Can you name both blockers and the next owner for each?','A reviewed photo alone does not demonstrate working physical access.',None),
('Trainer sign-off','Record what was actually demonstrated; use the result to plan follow-up.',['WATCH','TRY','EXPLAIN','RECORD'],['Learner and trainer: _______________________  Store: _______________________','Date and device: ___________________________  Trainer observes each skill in this workbook.','Mark each as Pass / Needs practice / Not run: navigation ___  tasks ___  arrival ___  blockers ___  escalation ___','Follow-up owner and due date: ______________________________________________'], 'What needs another practice session? Record the exact problem and owner.','A page tick is not proof of competence. Real reader, provider, finance, training and staff acceptance gates remain open.',None)
]
account=[
('The 30-minute walkthrough','A practical agenda for Brett and Carmen before opening.',['0–5 MIN','5–15 MIN','15–25 MIN','25–30 MIN'],['0–5 minutes: explain Midpoint scope, sign-in and permissions; locate Reports.','5–15 minutes: open a sample report, identify the store, date basis and what a row means.','15–25 minutes: compare occupancy, rent roll, ageing and posted billing with source evidence.','25–30 minutes: agree the monthly-pack contents, unresolved data, owners and next steps.'],'What is needed for the first monthly pack, and who supplies it?','Carmen offered Monday availability; a meeting time is not confirmed by the email.',None),
('Finance workspace tour','Connect the operational screens to the month-end questions.',['INVOICING','PAYMENTS','COLLECTIONS','REPORTS'],['Open Invoicing to see where monthly charges, invoices, statements and rent reviews are accessed.','Open Payments to locate receipt reconciliation, payments awaiting review and Netcash operations.','Open Collections to review aged debt, follow-ups and payment promises where the account permits.','Return to Reports to discuss which outputs belong in the Midpoint pack.'],'Can Carmen identify the source screen for a billing or payment question?','Viewing a screen does not approve posting, collections, changes or distribution. Access varies by role.',None),
('Find the report library','The first screen is a catalogue, not an automatically agreed monthly pack.',['REPORTS','LIBRARY','SEARCH','OPEN'],['Sign in with your own authorised account and select Reports in the navigation.','In Report library use Find a report or Category. Read the report description before choosing it.','A legacy report card offers View online and download. Other templates offer View online or Use template.','If a report is missing or access is unavailable, record the required access and ask the administrator.'],'Find the report name and explain its purpose before running it.','Carmen’s access and export permissions have not been verified or granted by this guide.',None),
('Run a sample report','Show the steps on screen using a suitable authorised example.',['CHOOSE','STORE','DATES','PREVIEW'],['Select a report. For an existing report, use its Report parameters to select the report and store.','Choose Store 1 - Midpoint where available and set the appropriate SAST reporting period or as-of date.','Choose View report. Read the title, dates, store, row descriptions and exception messages.','Discuss whether the output answers Carmen’s question and note any data that needs reconciliation.'],'Can Carmen say what the dates and the rows represent?','Current snapshots are not historical period-end snapshots; check the report’s stated basis.','report-parameters-example.png'),
('The four useful starting points','Different reports answer different questions.',['OCCUPANCY','RENT ROLL','AGEING','POSTED'],['Occupancy & revenue: current occupancy and contracted/potential rent snapshot; compare to the agreed period-end source.','Rent roll & tenant ledger: rates, balances and account activity; check individual source records and exceptions.','Receivables ageing: approved-terms ageing at the selected SAST date, with reconciliation exceptions.','Posted recurring-charge history: original posted billing lines and included tax, with review exceptions.'],'For each report, state its date basis and what it does not show.','Posted charges exclude later corrections and are not receipts, outstanding debt or recognised income.',None),
('Build and download','Only export once the scope and permission are appropriate.',['TEMPLATE','FILTER','PREVIEW','EXPORT'],['For a configurable template, select Use template and review its dataset, record source, store and date basis.','Set dates where the chosen basis permits them. Review columns, filters and totals; Preview report.','Choose a supported format and download if authorised. For a legacy report, choose the format and Export.','Record the report name, store, period or snapshot time, source and any exceptions with the pack.'],'Can the same report be explained and repeated for the next period?','Exports are confidential and data-protection controlled; personal-data export requires owner authorisation.',None),
('Reconcile before relying on totals','Build an evidence trail instead of treating a screen as a final ledger.',['REPORT','SOURCE','COMPARE','RESOLVE'],['Choose one sample row. Open the relevant underlying account, invoice or payment evidence when access permits.','Compare the report’s date, facility and transaction basis to the source. Note timing and tax differences for review.','Identify pending, test, disputed, missing or unreconciled items. Assign each exception to an owner.','Confirm the source and cut-off for bank, payment provider and accounting ledger with Carmen and finance.'],'Can the difference be explained and assigned to a person?','A report export or mandate does not prove settled funds, a reconciled bank balance or an approved journal.',None),
('Agree the monthly pack','Use the meeting to establish the actual deliverables, not to assume them.',['OUTPUT','OWNER','CUT-OFF','APPROVAL'],['Agree the pack recipients, delivery channel and format with the authorised team.','List each required output, period or as-of date, source, responsible preparer and reviewer.','Confirm how opening balances, adjustments, VAT treatment and bank/provider reconciliation will be evidenced.','Record gaps, due dates and who approves the final pack before distribution.'],'What will Carmen need from STOR24 and what comes from other sources?','Pack contents, mappings, financial approval and final acceptance are still to be agreed.',None),
('Questions and next actions','Use this page during the meeting.',['QUESTION','ANSWER','OWNER','DATE'],['Which report and date basis are required for each monthly-pack line? __________________','Which accounting system, account mapping and source documents will be used? __________________','Who reviews receipts, exceptions, adjustments and the final pack? __________________','What access, sample data or follow-up is still needed, and by when? __________________'],'List the next action, named owner and agreed date for each gap.','Do not post, send or change finance settings during a demonstration without the proper authority.',None)
]
def make_training():
 path=ROOT/'private/staff-training/STOR24-Facilities-Manager-Training-2026-11-26.pdf'; c=canvas.Canvas(str(path),pagesize=A4);c.setTitle('STOR24 Facilities Manager Training Workbook')
 cover(c,'Facilities manager\ntraining workbook','A visual, practical guide to the daily journey — from opening the store to a safe customer handover.', ['Find your way and control on-screen guidance.','Practise tasks, maintenance, arrivals and Unit 043.','Recognise blockers and explain who can resolve them.','Record trainer feedback and follow-up.'])
 for i,row in enumerate(training,2):page(c,'Facilities training',i,*row)
 c.save();print(path)
def make_account():
 path=ROOT/'output/pdf/STOR24-Accountant-Midpoint-Walkthrough-2026-11-26.pdf';path.parent.mkdir(parents=True,exist_ok=True);c=canvas.Canvas(str(path),pagesize=A4);c.setTitle('STOR24 Midpoint Accountant Walkthrough')
 cover(c,'Midpoint accountant\nwalkthrough','A 30-minute guided tour for Brett and Carmen: reports, sample review and the questions for a reliable monthly pack.', ['Tour the financial workspaces and open a report example.','Understand period reports, as-of dates and snapshots.','Compare totals to source evidence and note exceptions.','Agree the monthly pack, responsibilities and next steps.'])
 for i,row in enumerate(account,2):page(c,'Accountant walkthrough',i,*row)
 c.save();print(path)
if __name__=='__main__':make_training();make_account()
