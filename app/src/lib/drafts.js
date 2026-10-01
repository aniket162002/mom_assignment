import { inr } from './engine.js'

export function vendorQueryDraft(po, row, invoice) {
  const exQty = invoice.qty - po.grn_qty
  const net = po.grn_qty * invoice.rate
  const gst = (net * invoice.gst_pct) / 100
  return {
    subject: `Query on Bill ${invoice.invoice_no} (${po.po_no}) - billed qty exceeds goods received`,
    body: `Dear ${po.vendor} accounts team,

Bill ${invoice.invoice_no} dated ${invoice.invoice_date} is for ${invoice.qty.toLocaleString('en-IN')} ${po.unit} ${po.item} against ${po.po_no} (${inr(invoice.total)} incl. GST). Our goods receipt (GRN) shows ${po.grn_qty.toLocaleString('en-IN')} ${po.unit} received, a shortfall of ${exQty.toLocaleString('en-IN')} ${po.unit}. The rate (Rs ${invoice.rate}/${po.unit}) matches the PO.

We cannot release payment for material not received. Please either:
 (a) send a revised invoice / credit note for ${po.grn_qty.toLocaleString('en-IN')} ${po.unit} - ${inr(net)} + GST ${invoice.gst_pct}% ${inr(gst)} = ${inr(net + gst)}; or
 (b) confirm the delivery date and challan/LR number for the balance ${exQty.toLocaleString('en-IN')} ${po.unit}, and we will pay on receipt.

Payment will be processed in the normal cycle once we receive the corrected document.

Regards,
Accounts Payable, MOM`,
  }
}

export function controllerNote(rows, t) {
  const bank = rows.find((r) => r.dup && r.bank)
  const rate = rows.find((r) => r.status === 'EXCEPTION - RATE MISMATCH')
  const qty = rows.find((r) => r.status === 'EXCEPTION - QTY EXCEEDS GRN')
  const lines = []
  if (bank) lines.push(`1. HIGH RISK - suspected bank-detail fraud. A "payment pending" email for ${bank.invoice} (${inr(bank.total)}) asks us to pay a NEW bank account by email. The invoice itself matches the PO and GRN, but the email duplicates it, adds payment pressure and changes bank details - a classic business-email-compromise pattern. Recommend: pay the original once, only to the account already on the vendor master; do NOT update the master from this email; verify by call-back to the number on file (not the one in the email); check sender domain/headers; any approved change needs a second approver and a cooling-off period before first payment.`)
  if (bank) lines.push(`2. Duplicate control: ${bank.invoice} arrived twice. Confirm our system blocks a second payment of the same vendor + invoice number.`)
  if (rate) lines.push(`${lines.length + 1}. Rate mismatch - ${rate.invoice} (${rate.vendor}): ${rate.reason.split(';')[0]}. Is there an approved rate revision we are unaware of? If not, a credit note is needed; check whether other invoices from this vendor carry the same rate.`)
  if (qty) lines.push(`${lines.length + 1}. Over-billing - ${qty.invoice} (${qty.vendor}): ${qty.reason.split(';')[0]}. Query drafted. Procurement's stock sheet shows no open peanut PO - is the balance still due or was the PO closed short? The same vendor also announced a +4% peanut price rise from 1 Nov - make sure new rates are not applied to existing POs.`)
  lines.push(`${lines.length + 1}. Four invoices dated 24-26 Sep arrived together; confirm none were paid outside this cycle.`)
  return {
    subject: 'Payment-fraud risk on a vendor invoice + 2 exceptions - action needed before today\'s payment run',
    body: `${lines.join('\n\n')}\n\nAmounts: safe to release ${inr(t.safe)}; on hold ${inr(t.hold)}; duplicate ${inr(t.dup)} blocked.`,
  }
}
