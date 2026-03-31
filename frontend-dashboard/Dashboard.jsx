import { useState, useEffect, useCallback } from "react";

// ─── MOCK DATA (replace with real contract reads via viem) ────
const MOCK_DATA = {
  wallet: "0x7a3B...f91E",
  tier: 1,
  tierName: "Basic ZK",
  tierLimit: "$500/day",
  tierExpiry: "2026-06-15",
  mUSD: 2847.5,
  mnt: 12.34,
  dailySpent: 175.0,
  dailyLimit: 500,
  gasReserve: 8.92,
  gasPerTx: 0.002,
  stakingDiscount: false,
  schedules: [
    { id: 1, name: "Netflix", to: "0xNetf...lix", amount: 15.99, freq: "Monthly", next: "Apr 1", status: "active" },
    { id: 2, name: "Rent", to: "0xLand...lord", amount: 800, freq: "Monthly", next: "Apr 1", status: "active" },
    { id: 3, name: "Savings", to: "0xSave...vault", amount: 200, freq: "Weekly", next: "Apr 3", status: "active" },
    { id: 4, name: "Gym", to: "0xGym...club", amount: 29.99, freq: "Monthly", next: "Apr 15", status: "paused" },
  ],
  history: [
    { id: 101, type: "transfer", to: "alice.eth", amount: 50, time: "2h ago", status: "confirmed", hash: "0xab3f...c91d" },
    { id: 100, type: "schedule", to: "Netflix", amount: 15.99, time: "1d ago", status: "confirmed", hash: "0x82cf...12ae" },
    { id: 99, type: "transfer", to: "bob.mnt", amount: 200, time: "3d ago", status: "confirmed", hash: "0x4e1a...8b3c" },
    { id: 98, type: "schedule", to: "Savings", amount: 200, time: "4d ago", status: "confirmed", hash: "0x91fd...a47e" },
    { id: 97, type: "transfer", to: "carol.eth", amount: 75, time: "5d ago", status: "confirmed", hash: "0xc3e8...5f12" },
    { id: 96, type: "upgrade", to: "Tier 1", amount: 0, time: "7d ago", status: "confirmed", hash: "0x7b2a...de90" },
  ],
};

// ─── TIER BADGE ───────────────────────────────────────────────
function TierBadge({ tier }) {
  const colors = {
    0: { bg: "#2D1B1B", border: "#8B3A3A", text: "#FF8A8A", label: "Tier 0 · No Proof" },
    1: { bg: "#1B2D20", border: "#3A8B50", text: "#8AFF9F", label: "Tier 1 · Basic ZK" },
    2: { bg: "#1B1F2D", border: "#3A5E8B", text: "#8AC4FF", label: "Tier 2 · Advanced" },
  };
  const c = colors[tier] || colors[0];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 12px", borderRadius: 20,
      background: c.bg, border: `1px solid ${c.border}`,
      color: c.text, fontSize: 12, fontWeight: 600, letterSpacing: 0.5,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.text }} />
      {c.label}
    </span>
  );
}

// ─── STAT CARD ────────────────────────────────────────────────
function StatCard({ label, value, sub, accent, icon }) {
  return (
    <div style={{
      background: "#0F1520", border: "1px solid #1A2435", borderRadius: 14,
      padding: "20px 22px", flex: 1, minWidth: 200,
      transition: "border-color 0.2s",
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = accent || "#65D9A5"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#1A2435"}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "#6B7A8D", fontSize: 12, fontWeight: 500, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
          <div style={{ color: "#E8ECF1", fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: -0.5 }}>{value}</div>
          {sub && <div style={{ color: "#4A5568", fontSize: 12, marginTop: 4 }}>{sub}</div>}
        </div>
        <div style={{ fontSize: 24, opacity: 0.3 }}>{icon}</div>
      </div>
    </div>
  );
}

// ─── PROGRESS BAR ─────────────────────────────────────────────
function ProgressBar({ value, max, color = "#65D9A5", height = 6 }) {
  const pct = Math.min((value / max) * 100, 100);
  const warn = pct > 80;
  return (
    <div style={{ width: "100%", background: "#0A0E17", borderRadius: height, height, overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`, height: "100%", borderRadius: height,
        background: warn ? "#FF6B6B" : color,
        transition: "width 0.6s ease",
      }} />
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────
export default function ChatPayAIDashboard() {
  const [data] = useState(MOCK_DATA);
  const [activeTab, setActiveTab] = useState("overview");
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnimateIn(true), 100);
    return () => clearTimeout(t);
  }, []);

  const remainingTxs = Math.floor(data.gasReserve / data.gasPerTx);

  return (
    <div style={{
      minHeight: "100vh", background: "#080C14",
      fontFamily: "'Inter', -apple-system, sans-serif",
      color: "#E8ECF1",
      opacity: animateIn ? 1 : 0, transition: "opacity 0.5s ease",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1A2435; border-radius: 3px; }
      `}</style>

      {/* ─── HEADER ──────────────────────────────── */}
      <header style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "16px 28px", borderBottom: "1px solid #111827",
        background: "linear-gradient(180deg, #0D1219 0%, #080C14 100%)",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: "linear-gradient(135deg, #65D9A5, #4ECDC4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 700, color: "#080C14",
          }}>C</div>
          <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: -0.3 }}>ChatPayAI</span>
          <span style={{ color: "#3A4A5C", fontSize: 12, marginLeft: 4 }}>Dashboard v1.0</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <TierBadge tier={data.tier} />
          <div style={{
            padding: "6px 14px", borderRadius: 8,
            background: "#0F1520", border: "1px solid #1A2435",
            fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: "#8892A4",
          }}>
            {data.wallet}
          </div>
        </div>
      </header>

      {/* ─── TABS ────────────────────────────────── */}
      <nav style={{
        display: "flex", gap: 2, padding: "0 28px",
        borderBottom: "1px solid #111827", background: "#0A0E17",
      }}>
        {["overview", "schedules", "history", "gas", "identity"].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: "12px 20px", fontSize: 13, fontWeight: 600,
            background: "transparent", border: "none", cursor: "pointer",
            color: activeTab === tab ? "#65D9A5" : "#4A5568",
            borderBottom: activeTab === tab ? "2px solid #65D9A5" : "2px solid transparent",
            textTransform: "capitalize", transition: "all 0.2s",
            letterSpacing: 0.3,
          }}>{tab}</button>
        ))}
      </nav>

      {/* ─── CONTENT ─────────────────────────────── */}
      <main style={{ padding: "24px 28px", maxWidth: 1200 }}>
        {activeTab === "overview" && <OverviewTab data={data} remainingTxs={remainingTxs} />}
        {activeTab === "schedules" && <SchedulesTab data={data} />}
        {activeTab === "history" && <HistoryTab data={data} />}
        {activeTab === "gas" && <GasTab data={data} remainingTxs={remainingTxs} />}
        {activeTab === "identity" && <IdentityTab data={data} />}
      </main>
    </div>
  );
}

// ─── OVERVIEW TAB ─────────────────────────────────────────────
function OverviewTab({ data, remainingTxs }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Stats row */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <StatCard label="mUSD Balance" value={`$${data.mUSD.toLocaleString()}`} sub="Stablecoin" accent="#65D9A5" icon="💵" />
        <StatCard label="MNT Balance" value={`${data.mnt} MNT`} sub="Native token" accent="#4ECDC4" icon="⛽" />
        <StatCard label="Gas Reserve" value={`${data.gasReserve} MNT`} sub={`~${remainingTxs.toLocaleString()} TXs left`} accent="#FFE66D" icon="🔋" />
        <StatCard label="Active Schedules" value={data.schedules.filter(s => s.status === "active").length} sub="Recurring payments" accent="#A78BFA" icon="📅" />
      </div>

      {/* Daily spending */}
      <div style={{
        background: "#0F1520", border: "1px solid #1A2435", borderRadius: 14, padding: "20px 22px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ color: "#6B7A8D", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Daily Spending</span>
          <span style={{ color: "#8892A4", fontSize: 13 }}>
            ${data.dailySpent} / ${data.dailyLimit} ({data.tierName} limit)
          </span>
        </div>
        <ProgressBar value={data.dailySpent} max={data.dailyLimit} />
      </div>

      {/* Quick actions */}
      <div style={{
        background: "#0F1520", border: "1px solid #1A2435", borderRadius: 14, padding: "20px 22px",
      }}>
        <div style={{ color: "#6B7A8D", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Telegram Commands</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
          {[
            { cmd: 'Send $50 to alice.eth', desc: 'One-time transfer' },
            { cmd: 'Pay Netflix $15 monthly', desc: 'Create schedule' },
            { cmd: '/balance', desc: 'Check balances' },
            { cmd: '/upgrade', desc: 'Upgrade ZK tier' },
            { cmd: '/gas', desc: 'Gas reserve status' },
            { cmd: '/history', desc: 'Recent transactions' },
          ].map(({ cmd, desc }) => (
            <div key={cmd} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 14px", background: "#0A0E17", borderRadius: 8, border: "1px solid #141D2B",
            }}>
              <code style={{ color: "#65D9A5", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{cmd}</code>
              <span style={{ color: "#4A5568", fontSize: 11 }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── SCHEDULES TAB ────────────────────────────────────────────
function SchedulesTab({ data }) {
  return (
    <div style={{ background: "#0F1520", border: "1px solid #1A2435", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "18px 22px", borderBottom: "1px solid #1A2435", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Scheduled Payments</span>
        <span style={{ color: "#4A5568", fontSize: 12 }}>
          {data.schedules.filter(s => s.status === "active").length} active · Monthly total: $
          {data.schedules.filter(s => s.status === "active").reduce((a, s) => a + s.amount, 0).toFixed(2)}
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #141D2B" }}>
            {["Name", "Recipient", "Amount", "Frequency", "Next", "Status"].map(h => (
              <th key={h} style={{ padding: "10px 16px", textAlign: "left", color: "#4A5568", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.schedules.map(s => (
            <tr key={s.id} style={{ borderBottom: "1px solid #0D1219" }}>
              <td style={{ padding: "12px 16px", fontWeight: 600, fontSize: 13 }}>{s.name}</td>
              <td style={{ padding: "12px 16px", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#8892A4" }}>{s.to}</td>
              <td style={{ padding: "12px 16px", fontWeight: 600, color: "#65D9A5", fontSize: 13 }}>${s.amount}</td>
              <td style={{ padding: "12px 16px", color: "#8892A4", fontSize: 12 }}>{s.freq}</td>
              <td style={{ padding: "12px 16px", color: "#8892A4", fontSize: 12 }}>{s.next}</td>
              <td style={{ padding: "12px 16px" }}>
                <span style={{
                  padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                  background: s.status === "active" ? "#0D2818" : "#2D1B1B",
                  color: s.status === "active" ? "#65D9A5" : "#FF8A8A",
                  border: `1px solid ${s.status === "active" ? "#1A4D2E" : "#4D1A1A"}`,
                }}>{s.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── HISTORY TAB ──────────────────────────────────────────────
function HistoryTab({ data }) {
  const icons = { transfer: "📤", schedule: "📅", upgrade: "🛡️" };
  return (
    <div style={{ background: "#0F1520", border: "1px solid #1A2435", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "18px 22px", borderBottom: "1px solid #1A2435" }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Transaction History</span>
      </div>
      {data.history.map(tx => (
        <div key={tx.id} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 22px", borderBottom: "1px solid #0D1219",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 20 }}>{icons[tx.type] || "📋"}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {tx.type === "transfer" ? `Sent to ${tx.to}` : tx.type === "schedule" ? `Scheduled: ${tx.to}` : `${tx.to}`}
              </div>
              <div style={{ fontSize: 11, color: "#4A5568", fontFamily: "'JetBrains Mono', monospace" }}>{tx.hash}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: tx.amount > 0 ? "#FF8A8A" : "#65D9A5" }}>
              {tx.amount > 0 ? `-$${tx.amount}` : "—"}
            </div>
            <div style={{ fontSize: 11, color: "#4A5568" }}>{tx.time}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── GAS TAB ──────────────────────────────────────────────────
function GasTab({ data, remainingTxs }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <StatCard label="Gas Reserve" value={`${data.gasReserve} MNT`} accent="#FFE66D" icon="⛽" />
        <StatCard label="Fee per TX" value={`${data.gasPerTx} MNT`} sub={data.stakingDiscount ? "20% staking discount" : "No discount (need 10 MNT)"} accent="#4ECDC4" icon="💰" />
        <StatCard label="Remaining TXs" value={remainingTxs.toLocaleString()} accent="#A78BFA" icon="🔢" />
      </div>
      <div style={{ background: "#0F1520", border: "1px solid #1A2435", borderRadius: 14, padding: "20px 22px" }}>
        <div style={{ color: "#6B7A8D", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>MNT Token Usage</div>
        {[
          { role: "Gas Fees", desc: "Pays for on-chain transaction execution", color: "#65D9A5" },
          { role: "Automation Fee", desc: "0.002 MNT per scheduled execution", color: "#4ECDC4" },
          { role: "Staking Bond", desc: "Maintain 10+ MNT for 20% fee discount", color: "#FFE66D" },
          { role: "Premium Unlock", desc: "Advanced features with MNT staking", color: "#A78BFA" },
          { role: "Reliability Incentive", desc: "Operators earn MNT for executing schedules", color: "#FF8A8A" },
        ].map(({ role, desc, color }) => (
          <div key={role} style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "12px 0", borderBottom: "1px solid #141D2B",
          }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{role}</div>
              <div style={{ fontSize: 12, color: "#4A5568" }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── IDENTITY TAB ─────────────────────────────────────────────
function IdentityTab({ data }) {
  const tiers = [
    { level: 0, name: "No Proof", limit: "$50/day", proof: "None required", color: "#FF8A8A", bg: "#2D1B1B" },
    { level: 1, name: "Basic ZK Proof", limit: "$500/day", proof: "Proof of personhood", color: "#65D9A5", bg: "#0D2818" },
    { level: 2, name: "Advanced ZK", limit: "Unlimited", proof: "Government ID attestation", color: "#5B8DEF", bg: "#0D1828" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {tiers.map(t => (
          <div key={t.level} style={{
            background: t.level === data.tier ? t.bg : "#0F1520",
            border: `2px solid ${t.level === data.tier ? t.color : "#1A2435"}`,
            borderRadius: 14, padding: "22px", position: "relative",
          }}>
            {t.level === data.tier && (
              <div style={{
                position: "absolute", top: -1, right: 16,
                background: t.color, color: "#080C14",
                padding: "2px 12px", borderRadius: "0 0 8px 8px",
                fontSize: 10, fontWeight: 700, letterSpacing: 1,
              }}>CURRENT</div>
            )}
            <div style={{ color: t.color, fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>TIER {t.level}</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{t.name}</div>
            <div style={{ color: "#8892A4", fontSize: 13, marginBottom: 12 }}>Daily limit: {t.limit}</div>
            <div style={{ color: "#4A5568", fontSize: 12 }}>Requires: {t.proof}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "#0F1520", border: "1px solid #1A2435", borderRadius: 14, padding: "20px 22px" }}>
        <div style={{ color: "#6B7A8D", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>ZK Proof Details</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            ["Proof Type", "Groth16 ZK-SNARK"],
            ["Verified On-Chain", "IdentityRegistry.sol"],
            ["PII Exposed", "None (zero knowledge)"],
            ["Proof Expiry", data.tierExpiry],
            ["Nullifier", "Prevents proof reuse"],
            ["Upgrade Path", "Submit via /upgrade in Telegram"],
          ].map(([k, v]) => (
            <div key={k} style={{ padding: "10px 14px", background: "#0A0E17", borderRadius: 8, border: "1px solid #141D2B" }}>
              <div style={{ fontSize: 11, color: "#4A5568", marginBottom: 4 }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
