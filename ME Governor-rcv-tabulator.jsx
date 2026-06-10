import { useState, useMemo } from "react";

// ---- palette -------------------------------------------------------------
const INK = "#17171B";
const MUTED = "#6B6760";
const PAPER = "#FBFAF6";
const CARD = "#FFFFFF";
const HAIR = "#E6E2D8";
const EXH = "#CFCBC0";

const CANDS = [
  { name: "Shah",     full: "Nirav D. Shah",      color: "#C8146C" },
  { name: "Pingree",  full: "Hannah M. Pingree",  color: "#1593A8" },
  { name: "Jackson",  full: "Troy Dale Jackson",  color: "#2E9E5B" },
  { name: "Bellows",  full: "Shenna Bellows",     color: "#B08A3E" },
  { name: "King III", full: "Angus King III",     color: "#5A6B7B" },
];
const COLOR = Object.fromEntries(CANDS.map((c) => [c.name, c.color]));
const NAMES = CANDS.map((c) => c.name);

const INITIAL_VOTES = {
  "Shah": 54305, "Pingree": 46816, "Jackson": 42481, "Bellows": 41693, "King III": 16655,
};

// transfers[eliminated][target | "Exhausted"] = weight (0–100, interpreted relatively)
const PRESETS = {
  alliance: {
    label: "Alliance · higher exhaust",
    note: "Pingree/Jackson/Bellows cross-endorse; exhaustion climbs each round.",
    t: {
      "King III": { "Shah": 31, "Pingree": 25, "Jackson": 11, "Bellows": 13, "Exhausted": 20 },
      "Bellows":  { "Shah": 6,  "Pingree": 36, "Jackson": 38, "King III": 0, "Exhausted": 20 },
      "Jackson":  { "Shah": 16, "Pingree": 56, "Bellows": 0,  "King III": 0, "Exhausted": 28 },
      "Pingree":  { "Shah": 20, "Jackson": 38, "Bellows": 22, "King III": 0, "Exhausted": 20 },
      "Shah":     { "Pingree": 26, "Jackson": 18, "Bellows": 16, "King III": 0, "Exhausted": 40 },
    },
  },
  tight: {
    label: "Tight alliance · low exhaust",
    note: "Voters follow the rank-all-three instruction; few ballots drop out.",
    t: {
      "King III": { "Shah": 35, "Pingree": 28, "Jackson": 12, "Bellows": 13, "Exhausted": 12 },
      "Bellows":  { "Shah": 8,  "Pingree": 42, "Jackson": 42, "King III": 0, "Exhausted": 8 },
      "Jackson":  { "Shah": 17, "Pingree": 65, "Bellows": 0,  "King III": 0, "Exhausted": 18 },
      "Pingree":  { "Shah": 22, "Jackson": 45, "Bellows": 25, "King III": 0, "Exhausted": 8 },
      "Shah":     { "Pingree": 30, "Jackson": 20, "Bellows": 18, "King III": 0, "Exhausted": 32 },
    },
  },
  even: {
    label: "Even splits",
    note: "No coordination — transfers spread evenly with steady exhaustion.",
    t: Object.fromEntries(
      NAMES.map((e) => [
        e,
        Object.fromEntries([...NAMES.filter((n) => n !== e).map((n) => [n, 28]), ["Exhausted", 16]]),
      ])
    ),
  },
};

const fmt = (n) => Math.round(n).toLocaleString();

// ---- tabulation engine ----------------------------------------------------
function tabulate(votes, transfers) {
  const totals = { ...votes };
  let active = NAMES.filter((n) => totals[n] > 0 || true); // all five start active
  active = [...NAMES];
  const total = NAMES.reduce((s, n) => s + (votes[n] || 0), 0);
  let exhaustedCum = 0;
  const rounds = [];
  let winner = null;
  let guard = 0;

  while (active.length > 1 && guard++ < 20) {
    const continuing = active.reduce((s, n) => s + totals[n], 0);
    const leader = active.reduce((a, b) => (totals[a] >= totals[b] ? a : b));
    if (totals[leader] > continuing / 2) { winner = leader; break; }

    // lowest active; tie-break by lower first-round vote, then name
    const E = active.reduce((lo, n) => {
      if (totals[n] < totals[lo]) return n;
      if (totals[n] === totals[lo] && (votes[n] || 0) < (votes[lo] || 0)) return n;
      return lo;
    });
    const targets = active.filter((n) => n !== E);
    const pile = totals[E];
    const tw = transfers[E] || {};
    let wsum = 0;
    const w = {};
    targets.forEach((t) => { const v = Math.max(0, tw[t] ?? 0); w[t] = v; wsum += v; });
    const exW = Math.max(0, tw["Exhausted"] ?? 0); wsum += exW;

    const dist = {};
    let exhaustAmt = 0;
    const effPct = {};
    if (wsum === 0) {
      targets.forEach((t) => { dist[t] = pile / targets.length; effPct[t] = 100 / targets.length; });
      effPct["Exhausted"] = 0;
    } else {
      targets.forEach((t) => { dist[t] = pile * (w[t] / wsum); effPct[t] = (w[t] / wsum) * 100; });
      exhaustAmt = pile * (exW / wsum);
      effPct["Exhausted"] = (exW / wsum) * 100;
    }

    const before = { ...totals };
    targets.forEach((t) => { totals[t] += dist[t]; });
    exhaustedCum += exhaustAmt;
    totals[E] = 0;
    active = active.filter((n) => n !== E);
    const after = { ...totals };
    const contAfter = active.reduce((s, n) => s + totals[n], 0);

    // margin that decided this elimination (2nd-lowest survivor vs eliminated)
    const survSorted = [...targets].sort((a, b) => before[a] - before[b]);
    const margin = survSorted.length ? before[survSorted[0]] - pile : 0;
    const barelySurvived = survSorted[0];

    rounds.push({
      eliminated: E, targets, pile, dist, exhaustAmt, effPct,
      before, after, active: [...active], continuing: contAfter, exhaustedCum,
      margin, barelySurvived,
    });
  }
  if (!winner) winner = active.reduce((a, b) => (totals[a] >= totals[b] ? a : b));
  const finalContinuing = active.reduce((s, n) => s + totals[n], 0);
  return { rounds, winner, totals, finalContinuing, exhaustedCum, total };
}

// ---- share bar (the signature: a 50% line that slides as ballots exhaust) --
function ShareBar({ totals, active, exhausted, total }) {
  const ordered = [...active].sort((a, b) => totals[b] - totals[a]);
  const continuing = active.reduce((s, n) => s + totals[n], 0);
  const threshPct = (continuing / 2 / total) * 100;
  let acc = 0;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ position: "relative", height: 26, borderRadius: 5, overflow: "hidden", background: "#F1EEE6" }}>
        {ordered.map((n) => {
          const wpct = (totals[n] / total) * 100;
          const seg = (
            <div key={n} title={`${n}: ${fmt(totals[n])}`} className="seg"
              style={{ position: "absolute", left: `${acc}%`, top: 0, height: "100%", width: `${wpct}%`, background: COLOR[n] }} />
          );
          acc += wpct;
          return seg;
        })}
        {exhausted > 0 && (
          <div title={`Exhausted: ${fmt(exhausted)}`} className="seg"
            style={{ position: "absolute", left: `${acc}%`, top: 0, height: "100%", width: `${(exhausted / total) * 100}%`,
              background: `repeating-linear-gradient(45deg, ${EXH}, ${EXH} 5px, #DEDAD0 5px, #DEDAD0 10px)` }} />
        )}
        <div className="thresh" style={{ position: "absolute", left: `${threshPct}%`, top: -3, bottom: -3, width: 2, background: INK }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 11, color: MUTED }}>
        <span>majority line: {fmt(continuing / 2)} (50% of active)</span>
        <span>{fmt(continuing)} active · {fmt(exhausted)} exhausted</span>
      </div>
    </div>
  );
}

// ---- per-round transfer controls ------------------------------------------
function RoundControls({ E, round, transfers, setWeight }) {
  const rows = [...round.targets, "Exhausted"];
  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${HAIR}`, paddingTop: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: MUTED, marginBottom: 8 }}>
        Where {E}'s {fmt(round.pile)} ballots go
      </div>
      {rows.map((t) => {
        const isEx = t === "Exhausted";
        const w = transfers[E]?.[t] ?? 0;
        const pct = round.effPct[t] ?? 0;
        const amt = isEx ? round.exhaustAmt : (round.dist[t] ?? 0);
        const dot = isEx ? EXH : COLOR[t];
        return (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ display: "inline-block", width: 11, height: 11, borderRadius: 3, background: dot, flexShrink: 0,
              border: isEx ? `1px solid #C2BDB0` : "none" }} />
            <span style={{ width: 78, fontSize: 13, color: isEx ? MUTED : INK, fontStyle: isEx ? "italic" : "normal", flexShrink: 0 }}>{t}</span>
            <input type="range" min="0" max="100" value={w}
              onChange={(e) => setWeight(E, t, Number(e.target.value))}
              style={{ flex: 1, accentColor: isEx ? "#9C988C" : COLOR[t], minWidth: 60 }} />
            <span style={{ width: 96, textAlign: "right", fontSize: 12, color: MUTED, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
              {pct.toFixed(0)}% · +{fmt(amt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---- main ------------------------------------------------------------------
export default function RCVTabulator() {
  const [votes, setVotes] = useState({ ...INITIAL_VOTES });
  const [transfers, setTransfers] = useState(structuredClone(PRESETS.alliance.t));
  const [activePreset, setActivePreset] = useState("alliance");

  const setWeight = (E, target, val) => {
    setTransfers((prev) => ({ ...prev, [E]: { ...prev[E], [target]: val } }));
    setActivePreset(null);
  };
  const applyPreset = (key) => { setTransfers(structuredClone(PRESETS[key].t)); setActivePreset(key); };
  const setVote = (n, v) => setVotes((p) => ({ ...p, [n]: Math.max(0, Math.round(Number(v) || 0)) }));

  const { rounds, winner, totals, finalContinuing, exhaustedCum, total } = useMemo(
    () => tabulate(votes, transfers), [votes, transfers]
  );

  const round1Total = NAMES.reduce((s, n) => s + (votes[n] || 0), 0);
  const firstMajority = Math.floor(round1Total / 2) + 1;
  const winPct = (totals[winner] / finalContinuing) * 100;
  const runnerUp = NAMES.filter((n) => n !== winner).reduce((a, b) => (totals[a] >= totals[b] ? a : b));
  const runnerPct = (totals[runnerUp] / finalContinuing) * 100;
  const lastElim = rounds[rounds.length - 1];

  const r1ordered = [...NAMES].sort((a, b) => votes[b] - votes[a]);

  return (
    <div style={{ background: PAPER, color: INK, padding: "26px 22px", borderRadius: 12,
      fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif", fontVariantNumeric: "tabular-nums" }}>
      <style>{`
        .seg { transition: left .35s ease, width .35s ease; }
        .thresh { transition: left .35s ease; }
        .preset { transition: background .15s ease, border-color .15s ease; }
        @media (prefers-reduced-motion: reduce){ .seg,.thresh{ transition: none; } }
        input[type=range]{ height: 4px; cursor: pointer; }
      `}</style>

      {/* header */}
      <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: MUTED }}>
        Instant-runoff tabulator
      </div>
      <div style={{ fontSize: 25, fontWeight: 700, lineHeight: 1.15, marginTop: 4 }}>
        Maine Democratic primary · Governor
      </div>
      <div style={{ fontSize: 13, color: MUTED, marginTop: 6, maxWidth: 620 }}>
        Drag any round's transfers. The board re-runs the count — last place is eliminated automatically,
        and the black majority line slides left as ballots exhaust. Speculative; you set every assumption.
      </div>

      {/* presets + totals */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 16 }}>
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} onClick={() => applyPreset(k)} className="preset"
            style={{ fontSize: 12, padding: "6px 11px", borderRadius: 7, cursor: "pointer",
              border: `1px solid ${activePreset === k ? INK : HAIR}`,
              background: activePreset === k ? INK : CARD, color: activePreset === k ? PAPER : INK }}>
            {p.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 12, color: MUTED, textAlign: "right" }}>
          {fmt(round1Total)} counted · first-round majority {fmt(firstMajority)}
        </div>
      </div>
      {activePreset && (
        <div style={{ fontSize: 12, color: MUTED, marginTop: 8, fontStyle: "italic" }}>{PRESETS[activePreset].note}</div>
      )}

      {/* winner banner */}
      <div style={{ marginTop: 18, padding: "16px 18px", borderRadius: 10, background: CARD,
        border: `1px solid ${HAIR}`, borderLeft: `5px solid ${COLOR[winner]}` }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: MUTED }}>
          Projected winner · round {rounds.length + 1}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: COLOR[winner] }}>{winner}</span>
          <span style={{ fontSize: 28, fontWeight: 700 }}>{winPct.toFixed(1)}%</span>
          <span style={{ fontSize: 14, color: MUTED }}>vs {runnerUp} {runnerPct.toFixed(1)}%</span>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>
          {fmt(exhaustedCum)} ballots exhausted ({((exhaustedCum / total) * 100).toFixed(1)}% of all cast) ·
          {" "}majority needs {fmt(finalContinuing / 2)} of {fmt(finalContinuing)} active
        </div>
        {lastElim && (
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>
            Closest call: <b style={{ color: INK }}>{lastElim.barelySurvived}</b> edged{" "}
            <b style={{ color: INK }}>{lastElim.eliminated}</b> by {fmt(lastElim.margin)} for the final-two spot.
          </div>
        )}
      </div>

      {/* round 1 */}
      <div style={{ marginTop: 18, padding: "16px 18px", borderRadius: 10, background: CARD, border: `1px solid ${HAIR}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Round 1 — first choices</div>
          <div style={{ fontSize: 11, color: MUTED }}>editable · 91% counted</div>
        </div>
        <div style={{ marginTop: 10 }}>
          {r1ordered.map((n) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: COLOR[n], flexShrink: 0 }} />
              <span style={{ width: 78, fontSize: 13, flexShrink: 0 }}>{n}</span>
              <input type="number" value={votes[n]} onChange={(e) => setVote(n, e.target.value)}
                style={{ width: 90, fontSize: 13, padding: "4px 6px", borderRadius: 6, border: `1px solid ${HAIR}`,
                  background: PAPER, color: INK, fontVariantNumeric: "tabular-nums" }} />
              <span style={{ fontSize: 12, color: MUTED }}>
                {((votes[n] / round1Total) * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
        <ShareBar totals={votes} active={NAMES} exhausted={0} total={round1Total} />
      </div>

      {/* elimination rounds */}
      {rounds.map((r, i) => {
        const E = r.eliminated;
        const decided = i === rounds.length - 1;
        const ordered = [...r.active].sort((a, b) => r.after[b] - r.after[a]);
        return (
          <div key={i} style={{ marginTop: 16, padding: "16px 18px", borderRadius: 10, background: CARD, border: `1px solid ${HAIR}` }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              Round {i + 2} — <span style={{ color: COLOR[E] }}>{E}</span> eliminated,{" "}
              {fmt(r.pile)} redistributed
            </div>

            <RoundControls E={E} round={r} transfers={transfers} setWeight={setWeight} />

            <div style={{ marginTop: 14 }}>
              {ordered.map((n, idx) => {
                const isLast = idx === ordered.length - 1 && !decided;
                const crossed = decided && n === winner;
                return (
                  <div key={n} style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, fontSize: 13.5 }}>
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: COLOR[n], alignSelf: "center", flexShrink: 0 }} />
                    <span style={{ width: 70, flexShrink: 0 }}>{n}</span>
                    <span style={{ color: MUTED }}>
                      {fmt(r.before[n])} {r.dist[n] ? `+ ${fmt(r.dist[n])}` : "+ 0"} =
                    </span>
                    <b style={{ color: crossed ? COLOR[n] : INK }}>{fmt(r.after[n])}</b>
                    {isLast && <span style={{ color: MUTED, fontSize: 12 }}>← now last</span>}
                    {crossed && <span style={{ color: COLOR[n], fontSize: 12, fontWeight: 700 }}>← majority</span>}
                  </div>
                );
              })}
            </div>

            <ShareBar totals={r.after} active={r.active} exhausted={r.exhaustedCum} total={total} />
          </div>
        );
      })}

      <div style={{ fontSize: 11, color: MUTED, marginTop: 16, lineHeight: 1.5 }}>
        Transfer shares are interpreted relatively, so a round needn't sum to exactly 100 — the effective
        percentage shown beside each slider is what actually gets applied. Changing an early round can
        change who finishes last later, reshuffling every round below it.
      </div>
    </div>
  );
}
