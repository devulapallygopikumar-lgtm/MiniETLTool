import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./landing.css";

const display = Fraunces({
  subsets: ["latin"],
  weight: "variable",
  style: ["normal"],
  variable: "--landing-font-display",
});

const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--landing-font-body",
});

const data = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--landing-font-data",
});

export const metadata: Metadata = {
  title: "Meridian — rows you can trust",
  description:
    "Meridian parses CSV, Excel and XML exports, validates every row against rules you set, and refuses to load anything that fails them.",
};

const PIPELINE = [
  { name: "Parse", detail: "Read the file. Infer a schema.", gate: false },
  { name: "Validate", detail: "Check every mandatory rule.", gate: true },
  { name: "Transform", detail: "Filter, rename, derive, mask.", gate: false },
  { name: "Load", detail: "Write the clean rows.", gate: false },
  { name: "Report", detail: "Query the loaded tables.", gate: false },
];

const NON_GOALS = [
  {
    title: "A Spark cluster",
    body: "One node runs a file at a time. No shuffle, no executor fleet to keep warm.",
  },
  {
    title: "A streaming pipeline",
    body: "Runs are batch, on demand. Nothing needs exactly-once stream semantics.",
  },
  {
    title: "Arbitrary code in your pipeline",
    body: "Rules and mappings are declared, not scripted. No sandbox to secure.",
  },
  {
    title: "A separate reporting cube",
    body: "Reports query the loaded tables directly. Nothing to keep in sync.",
  },
];

const FORMATS = ["CSV", "Excel", "XML", "Tally ledgers", "Tally vouchers", "Tally masters"];
const OPERATORS = [
  "Sort",
  "Distinct / dedupe",
  "Group by / aggregate",
  "Window function",
  "Pivot",
  "Unpivot",
  "Join",
];

export default function LandingPage() {
  return (
    <div className={`landing ${display.variable} ${body.variable} ${data.variable}`}>
      <header className="landing__header">
        <Link href="/landing" className="landing__wordmark">
          <span className="landing__wordmark-dot" aria-hidden="true" />
          Meridian
        </Link>
        <Link href="/upload" className="landing__nav-cta">
          Start a run
        </Link>
      </header>

      <section className="landing__hero">
        <div>
          <p className="landing__eyebrow-line">a small, sharp ETL tool</p>
          <h1 className="landing__headline">
            Turn a folder of exports into rows you can trust.
          </h1>
          <p className="landing__dek">
            Meridian reads <code>.csv</code>, <code>.xlsx</code> and <code>.xml</code> —
            including raw Tally exports — checks every row against rules you set, and
            won&rsquo;t load anything until they pass.
          </p>
          <div className="landing__cta-row">
            <Link href="/upload" className="landing__cta-primary">
              Start a run
            </Link>
            <Link href="/" className="landing__cta-secondary">
              See the datasets
            </Link>
          </div>
        </div>

        <div className="landing__demo" aria-hidden="true">
          <p className="landing__demo-label">VOUCHER.xml, line 118,304</p>
          <pre className="landing__demo-raw">{`<VOUCHER><DATE>20260912</DATE>
<AMOUNT>21642445.49</AMOUNT>
<LEDGERNAME>Profit &amp; Loss A/c</LEDGERNAME>
</VOUCHER>`}</pre>
          <div className="landing__demo-arrow">
            <span className="landing__demo-arrow-glyph">↓</span> parsed, typed, validated
          </div>
          <table className="landing__demo-table">
            <tbody>
              <tr>
                <td>date</td>
                <td>2026-09-12</td>
              </tr>
              <tr>
                <td>amount</td>
                <td>21642445.49</td>
              </tr>
              <tr>
                <td>ledger_name</td>
                <td>Profit &amp; Loss A/c</td>
              </tr>
            </tbody>
          </table>
          <div className="landing__demo-stamp">
            <span className="landing__demo-stamp-dot" />
            gate open — loaded
          </div>
        </div>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">One straight line, one gate.</h2>
        <p className="landing__section-lede">
          Every dataset moves through the same five stages, in the same order. Validate
          is the one that can stop the line: while a mandatory rule is failing, nothing
          past it runs.
        </p>
        <div className="landing__pipeline">
          {PIPELINE.map((stage) => (
            <div
              key={stage.name}
              className={`landing__pipeline-stage ${stage.gate ? "landing__pipeline-stage--gate" : ""}`}
            >
              <span className="landing__pipeline-name">{stage.name}</span>
              <span className="landing__pipeline-detail">{stage.detail}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">Reads what your other systems export.</h2>
        <p className="landing__section-lede">
          Including the exports nobody wants to touch by hand — Tally&rsquo;s XML dumps
          are parsed into ledgers, vouchers and bill allocations as their own datasets,
          not one tangled sheet.
        </p>
        <div className="landing__chips">
          {FORMATS.map((f) => (
            <span key={f} className="landing__chip">{f}</span>
          ))}
        </div>
        <p className="landing__section-lede" style={{ marginTop: "1.75rem", marginBottom: "0.75rem" }}>
          Once a dataset is loaded, reshape it into a new one — sort, join, group, pivot —
          without leaving a spreadsheet mindset behind.
        </p>
        <div className="landing__chips">
          {OPERATORS.map((o) => (
            <span key={o} className="landing__chip">{o}</span>
          ))}
        </div>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">What Meridian doesn&rsquo;t do.</h2>
        <p className="landing__section-lede">
          Every one of these is a deliberate cut, not a missing feature. They&rsquo;re
          what keeps a run predictable instead of needing an on-call rotation.
        </p>
        <div className="landing__non-goals">
          {NON_GOALS.map((g) => (
            <div key={g.title} className="landing__non-goal">
              <span className="landing__non-goal-mark" aria-hidden="true">✕</span>
              <div className="landing__non-goal-body">
                <h3>{g.title}</h3>
                <p>{g.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">From one export, this morning.</h2>
        <p className="landing__proof">
          <strong>39,697</strong> ledger entries, <strong>19,486</strong> vouchers and{" "}
          <strong>16,827</strong> bill allocations parsed from a single Tally export.
          <strong> 0</strong> rejected. Every parse, rule check and load is written to
          the audit log — who ran it, what it read, what it rejected.
        </p>
      </section>

      <footer className="landing__footer">
        <span>Meridian — a self-service ETL tool, sized for one team&rsquo;s exports, not a data lake.</span>
        <nav className="landing__footer-links">
          <Link href="/">Datasets</Link>
          <Link href="/process">Process data</Link>
          <Link href="/target">Target dataset</Link>
          <Link href="/audit">Audit</Link>
        </nav>
      </footer>
    </div>
  );
}
