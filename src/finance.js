import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function numericAmount(row){
  const number=Number(String(row.rawAmount??row.amount??'0').replace(/[^0-9.]/g,''))||0;
  return row.icon==='out'||row.kind==='disbursement'||row.type==='Distribution'?-number:number;
}
function money(value,currency='AUD'){return new Intl.NumberFormat('en-AU',{style:'currency',currency,maximumFractionDigits:2}).format(value||0)}

export function generateStatementPdf(rows,{community='New Horizons',period='Current period',currency='AUD',requestedBy='Community admin'}={}){
  const doc=new jsPDF({unit:'pt',format:'a4'}); const pageWidth=doc.internal.pageSize.getWidth();
  doc.setFillColor(20,57,42);doc.rect(0,0,pageWidth,112,'F');
  doc.setTextColor(221,240,194);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('KINDRED  ·  COMMUNITY FINANCIALS',42,36);
  doc.setTextColor(255,255,255);doc.setFontSize(22);doc.text('Transparent activity statement',42,67);
  doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(`${community}   ·   ${period}`,42,91);
  const totals=rows.reduce((sum,row)=>{const value=numericAmount(row);if(value>=0)sum.inflows+=value;else sum.outflows+=Math.abs(value);return sum},{inflows:0,outflows:0});
  doc.setTextColor(35,55,43);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('PERIOD SUMMARY',42,143);
  const net=totals.inflows-totals.outflows;
  doc.setDrawColor(224,231,224);doc.roundedRect(42,155,pageWidth-84,63,7,7,'S');
  const cols=[['Collections',money(totals.inflows,currency)],['Disbursements',money(totals.outflows,currency)],['Net activity',money(net,currency)]];
  cols.forEach((c,i)=>{const x=58+i*(pageWidth-116)/3;doc.setTextColor(124,137,126);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text(c[0].toUpperCase(),x,177);doc.setTextColor(40,67,49);doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text(c[1],x,200)});
  doc.setTextColor(47,63,51);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('Voucher-level transaction detail',42,245);
  autoTable(doc,{startY:258,margin:{left:42,right:42},head:[['DATE','VOUCHER','DESCRIPTION','PROGRAM','TYPE','AMOUNT']],body:rows.map(r=>[r.date||'',r.voucher||r.detail||'',r.description||'',r.program||'',r.type||'',`${numericAmount(r)<0?'−':'+'} ${money(Math.abs(numericAmount(r)),currency)}`]),styles:{font:'helvetica',fontSize:7.5,cellPadding:6,textColor:[68,82,71],lineColor:[232,236,231],lineWidth:.35},headStyles:{fillColor:[240,245,238],textColor:[88,111,89],fontStyle:'bold',fontSize:7},columnStyles:{5:{halign:'right'}},alternateRowStyles:{fillColor:[251,252,250]},didDrawPage:()=>{const h=doc.internal.pageSize.getHeight();doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(137,148,139);doc.text(`Generated ${new Date().toLocaleString('en-AU')} · Requested by ${requestedBy}`,42,h-28);doc.text('Public ledger extract · Personal identities and private case notes are excluded',42,h-16)}});
  doc.save(`${community.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${period.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-statement.pdf`);
}

export function generateVoucherPdf(row,{community='New Horizons',currency='AUD'}={}){
  const doc=new jsPDF({unit:'pt',format:'a4'});const width=doc.internal.pageSize.getWidth();
  doc.setFillColor(20,57,42);doc.rect(0,0,width,108,'F');doc.setTextColor(224,241,197);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('KINDRED  ·  VERIFIED LEDGER VOUCHER',42,37);doc.setTextColor(255,255,255);doc.setFontSize(21);doc.text(row.type==='Inflow'?'Collection receipt':'Distribution voucher',42,72);
  doc.setTextColor(40,58,46);doc.setFontSize(10);doc.text(community,42,145);doc.setDrawColor(224,231,224);doc.roundedRect(42,165,width-84,205,9,9,'S');
  const items=[['Voucher number',row.voucher||row.detail||'Not assigned'],['Voucher title',row.description||'Financial transaction'],['Program',row.program||'Community fund'],['Transaction date',row.date||new Date().toLocaleDateString('en-AU')],['Entry type',row.type||'Ledger entry']];
  items.forEach((item,i)=>{const y=198+i*32;doc.setTextColor(132,143,134);doc.setFontSize(8);doc.setFont('helvetica','normal');doc.text(item[0].toUpperCase(),60,y);doc.setTextColor(55,73,59);doc.setFontSize(10);doc.setFont('helvetica','bold');doc.text(String(item[1]),195,y)});
  doc.setFillColor(243,247,240);doc.roundedRect(42,394,width-84,75,8,8,'F');doc.setTextColor(116,133,117);doc.setFontSize(8);doc.text('VOUCHER AMOUNT',60,423);doc.setTextColor(36,76,48);doc.setFontSize(20);doc.text(`${numericAmount(row)<0?'−':'+'} ${money(Math.abs(numericAmount(row)),currency)}`,60,451);
  doc.setTextColor(125,137,127);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text('This voucher supports the matching entry in the community transparency ledger.',42,510);doc.text(`Generated ${new Date().toLocaleString('en-AU')}`,42,530);
  doc.save(`${String(row.voucher||row.date||'voucher').replace(/[^a-z0-9-]+/gi,'-')}.pdf`);
}
