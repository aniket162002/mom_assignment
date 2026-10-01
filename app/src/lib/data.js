// Inputs exactly as given in the assignment PDF.
export const STOCK = [
  { item: 'Roasted Peanuts', unit: 'kg', stock: 3600, usage: 600, lead_time: 5, safety: 1200, open_po_qty: 0, open_po_ref: '', open_po_eta_days: null },
  { item: 'Almonds', unit: 'kg', stock: 900, usage: 150, lead_time: 10, safety: 450, open_po_qty: 1500, open_po_ref: 'PO-2291', open_po_eta_days: 5 },
  { item: 'Rolled Oats', unit: 'kg', stock: 3000, usage: 250, lead_time: 7, safety: 500, open_po_qty: 0, open_po_ref: '', open_po_eta_days: null },
  { item: 'PET Jars 500g', unit: 'units', stock: 13000, usage: 2000, lead_time: 6, safety: 3000, open_po_qty: 0, open_po_ref: '', open_po_eta_days: null },
  { item: 'Labels (MOM PB)', unit: 'units', stock: 9000, usage: 1800, lead_time: 4, safety: 1800, open_po_qty: 0, open_po_ref: '', open_po_eta_days: null },
]

export const EMAILS = [
  { id: 'A', text: 'EMAIL A\nFrom: Sunil, Kaveri Nuts Pvt Ltd | Subject: PO 2291 - shipment update\nHi team, hope you are well. Our almond consignment for PO 2291 (1500 kg) got held at the port for customs inspection. Revised delivery will be 6 days later than the date we had committed earlier. Apologies for the inconvenience. Regards, Sunil' },
  { id: 'B', text: 'EMAIL B\nFrom: Sai Agro Traders | Subject: Price update\nDear sir, please note peanut rates will go up by 4% from 1st Nov. Deliveries and lead times remain as usual. Regards, Sai Agro Traders' },
]

export const PO_GRN = [
  { po_no: 'PO-2285', vendor: 'Shree Packaging Pvt Ltd', item: 'PET Jar 500g', po_qty: 20000, unit: 'nos', po_rate: 11.5, grn_qty: 20000 },
  { po_no: 'PO-2286', vendor: 'Om Print Labels', item: 'Labels (MOM PB)', po_qty: 30000, unit: 'nos', po_rate: 1.2, grn_qty: 30000 },
  { po_no: 'PO-2287', vendor: 'Sai Agro Traders', item: 'Roasted Peanuts', po_qty: 5000, unit: 'kg', po_rate: 95, grn_qty: 4800 },
  { po_no: 'PO-2289', vendor: 'Ganga Oats Mills', item: 'Rolled Oats', po_qty: 3000, unit: 'kg', po_rate: 58, grn_qty: 3000 },
]

export const DOCS = [
  { label: 'Doc 1', text: 'DOCUMENT 1\nShree Packaging Pvt Ltd | Tax Invoice No: SP/2026/0871 | Date 24-Sep-2026 | PO Ref: PO-2285 | Item: PET Jar 500g x 20,000 nos @ Rs 11.50 | Taxable value: Rs 230,000 | GST 18%: Rs 41,400 | Total: Rs 271,400' },
  { label: 'Doc 2', text: 'DOCUMENT 2\nOm Print Labels - INV OPL-4410 dt 25/09/2026. Against PO-2286. Labels (MOM PB) qty 30000 rate 1.35/pc. Taxable 40,500. GST @18% 7,290. Invoice total 47,790' },
  { label: 'Doc 3', text: 'DOCUMENT 3\nSAI AGRO TRADERS - Bill no. SAT/889 - 26 Sep 26 - PO 2287 - Roasted Peanuts 5000 kg x Rs 95/kg = 475,000. GST 5% = 23,750. Net payable Rs 498,750' },
  { label: 'Doc 4', text: 'DOCUMENT 4\nGanga Oats Mills, Invoice GOM/1207, 26-09-2026, PO-2289, Rolled Oats 3000 kg @ 58 per kg, taxable Rs 174,000, GST 5% Rs 8,700, total Rs 182,700' },
  { label: 'Doc 5 (email)', text: 'DOCUMENT 5 (email)\nSubject: REMINDER - payment pending, Invoice GOM/1207\nDear Accounts, attaching invoice GOM/1207 dated 26-09-2026 for Rs 182,700 (PO-2289, Rolled Oats 3000 kg) again as payment is pending. Also please note our bank account has changed - kindly release payment to our new account ending 4821. Regards, Ganga Oats Mills accounts' },
]
