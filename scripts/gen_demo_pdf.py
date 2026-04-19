"""Generate the Q3 2023 Portfolio Risk Review demo PDF.

One-time tool. fpdf2 is NOT a runtime dep; this script exists only to
produce `frontend/public/demo-docs/q3-2023-portfolio-risk-review.pdf`.
Re-run after editing the copy below:

    python scripts/gen_demo_pdf.py

Content is synthesized from the 15-row demo CSV so the RAG chat retrieves
real project names and numbers.
"""
from __future__ import annotations

from pathlib import Path

from fpdf import FPDF


OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "demo-docs" / "q3-2023-portfolio-risk-review.pdf"


SECTIONS: list[tuple[str, list[str]]] = [
    (
        "Executive summary",
        [
            "This review covers five construction projects from the current portfolio, selected because each carries material schedule, cost, or safety exposure above the review thresholds. Combined contract value under review is approximately $372M. Three of the five have closed out; two remain in progress.",
            "Headline findings: Airport Terminal Expansion (PRJ009) closed 201 days behind the original schedule with a 34.1% cost overrun and 12 payment disputes outstanding. Wastewater Treatment Plant (PRJ007) closed 134 days behind with 26.7% overrun and eight disputes. Two active projects, Coastal Highway Rehab (PRJ003) and Rail Yard Modernization (PRJ013), carry elevated safety exposure relative to their construction stage.",
            "No projects in this review are recommended for termination. All five remain within recoverable operating envelopes. Recommendations at the end of this document focus on change-order discipline and safety stand-downs on the two active projects.",
        ],
    ),
    (
        "Schedule performance",
        [
            "Airport Terminal Expansion (PRJ009, Northeast region, Infrastructure): contract start December 2019, original completion June 2022. Actual completion June 30, 2023, representing a 201-day slip against baseline. Root causes documented in the CM log: (a) facade subcontractor default in Q2 2021 forcing a 90-day re-procurement, (b) structural steel price renegotiation in Q3 2021 adding 42 days, and (c) a sequence of change orders related to TSA screening-line reconfiguration adding an additional 60 days cumulatively.",
            "Wastewater Treatment Plant (PRJ007, Southeast region, Infrastructure): contract start June 2020, original completion July 2023, actual completion November 30, 2023. The 134-day slip is attributed primarily to unforeseen subsurface conditions on the influent pump station pad, discovered in Q1 2021, which required a redesign of the mat foundation.",
            "University Science Building (PRJ005, Northeast region, Commercial): 89 days late. Cleanroom MEP coordination issues drove the bulk of the delay; a pre-fabricated skid arrived with an incompatible control panel and had to be returned to the vendor.",
            "Harbor Bridge Expansion (PRJ001, Northeast region, Infrastructure): 47 days late, within tolerance. Weather accounted for roughly half the slippage.",
            "Coastal Highway Rehab (PRJ003, Southwest region, Infrastructure): in progress. Current projection is a 60 to 90 day slip against baseline, driven by a disputed environmental review on the third section.",
        ],
    ),
    (
        "Cost performance",
        [
            "Airport Terminal Expansion (PRJ009) closed 34.1% over the original contract value of $120M, a roughly $41M overrun. The drivers were, in order of magnitude: (1) facade re-procurement including mobilization and expedited material premium, (2) structural steel escalation, (3) TSA-driven scope changes not covered by change orders that were ultimately paid via a negotiated settlement in Q2 2023.",
            "Wastewater Treatment Plant (PRJ007) closed 26.7% over the original $88M contract. The foundation redesign consumed approximately 70% of the overrun; the balance was owner-directed scope additions on the sludge handling building.",
            "University Science Building (PRJ005) closed 18.4% over the original $52M contract. Cleanroom scope changes account for the entire overrun.",
            "Harbor Bridge Expansion (PRJ001) closed 8.2% over, within acceptable owner tolerance for infrastructure of that complexity.",
            "Coastal Highway Rehab (PRJ003) is tracking at an unconfirmed overrun. Cost reporting for the active project is pending the closeout of three outstanding change orders.",
        ],
    ),
    (
        "Safety and disputes",
        [
            "Safety exposure on the portfolio is concentrated in two projects. Airport Terminal Expansion (PRJ009) logged 9 recordable incidents during its construction window, with two serious injuries in Q4 2021 tied to work-at-height operations on the south concourse. A targeted stand-down and subcontractor re-qualification followed each; no incidents were logged in the final six months of the project.",
            "Wastewater Treatment Plant (PRJ007) logged 6 incidents, predominantly confined-space related. The owner and GC jointly commissioned an independent safety audit in Q2 2022; audit findings were closed out by project completion.",
            "Coastal Highway Rehab (PRJ003) has logged 3 recordable incidents to date. Rate-per-200k-hours is above the portfolio median for active infrastructure. A stand-down is scheduled for the start of Q4 2023.",
            "Payment disputes follow a similar distribution. PRJ009 has 12 outstanding disputes at closeout, most tied to the TSA scope changes and the facade re-procurement claim. PRJ007 carries 8 disputes, of which 5 are subcontractor change-order disputes pending arbitration. PRJ003 has 5 active disputes at the time of this review.",
        ],
    ),
    (
        "Forward-looking risks (next 90 days)",
        [
            "Coastal Highway Rehab (PRJ003): highest exposure in the active set. Schedule slip is likely to widen beyond the current 60-90 day projection if the environmental review on the third section is not resolved by mid-Q4 2023. Recommend an early negotiation posture rather than litigation.",
            "Rail Yard Modernization (PRJ013): second-highest exposure. Current cost overrun is reported as 11.4% with additional claims pending. Safety incident count is unreported at the time of this review - recommend an urgent audit.",
            "Retail Shopping Center (PRJ008): low-to-moderate exposure; 15-day slip and 3.4% overrun are within tolerance. No action recommended beyond normal monitoring.",
            "Bridge Deck Replacement (PRJ015): monitor. 22-day slip with incomplete cost data. Owner has not yet approved the substantial completion punchlist as of this report date.",
        ],
    ),
    (
        "Recommendations",
        [
            "1. Tighten change-order discipline on all active infrastructure projects. Any scope change exceeding $500k should require executive sponsor sign-off before work proceeds.",
            "2. Execute the scheduled Q4 2023 safety stand-down on Coastal Highway Rehab (PRJ003). Pair with a subcontractor re-qualification cycle for work-at-height trades.",
            "3. Close out the 12 outstanding payment disputes on Airport Terminal Expansion (PRJ009) within 60 days. The longer these sit, the harder they are to settle without litigation.",
            "4. Commission an independent safety audit of Rail Yard Modernization (PRJ013) before year end.",
            "5. Update portfolio anomaly thresholds to capture in-progress projects earlier - the current thresholds only fire at closeout for several of the metrics under review.",
        ],
    ),
    (
        "Appendix: notable change orders",
        [
            "PRJ009 CO-027: facade re-procurement premium and mobilization, $8.4M, approved Q2 2021.",
            "PRJ009 CO-041: TSA screening-line reconfiguration bundle, $6.1M across three related change orders, negotiated settlement Q2 2023.",
            "PRJ007 CO-012: mat foundation redesign on influent pump station, $14.2M, approved Q2 2021.",
            "PRJ007 CO-033: sludge handling building scope additions, $4.8M, approved Q4 2022.",
            "PRJ005 CO-019: cleanroom control panel replacement and sequence recovery, $2.1M, approved Q1 2023.",
            "PRJ003 CO-009: environmental review response, third section, $0.9M, pending.",
        ],
    ),
]


def build() -> None:
    pdf = FPDF(unit="pt", format="Letter")
    pdf.set_margin(56)  # ~0.78in
    pdf.set_auto_page_break(auto=True, margin=56)
    pdf.add_page()

    # Title block
    pdf.set_font("Helvetica", style="B", size=20)
    pdf.cell(0, 28, "Q3 2023 Portfolio Risk Review", new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", size=10)
    pdf.set_text_color(110, 110, 110)
    pdf.cell(
        0,
        14,
        "Prepared by the Enlaye Demo risk office  ·  Distribution: executive sponsors, CM leads",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.cell(
        0,
        14,
        "Report date: October 9, 2023  ·  Projects covered: PRJ001, PRJ003, PRJ005, PRJ007, PRJ009, PRJ013",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.set_text_color(0, 0, 0)
    pdf.ln(12)

    # Divider
    pdf.set_draw_color(220, 220, 220)
    pdf.set_line_width(0.5)
    y = pdf.get_y()
    pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
    pdf.ln(16)

    for heading, paragraphs in SECTIONS:
        pdf.set_font("Helvetica", style="B", size=13)
        pdf.cell(0, 20, heading, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(4)

        pdf.set_font("Helvetica", size=10.5)
        for p in paragraphs:
            pdf.multi_cell(0, 15, p)
            pdf.ln(6)
        pdf.ln(4)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    build()
