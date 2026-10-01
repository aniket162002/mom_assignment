"""Run both automations and write everything to ./outputs"""
import sys, io, contextlib
sys.path.insert(0, "src")
import issue1_reorder, issue2_invoice_match
for m in (issue1_reorder, issue2_invoice_match):
    with contextlib.redirect_stdout(io.StringIO()):
        m.main()
print("Done. See outputs/issue1_report.md and outputs/issue2_report.md")
