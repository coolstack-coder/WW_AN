import { useEffect, useState } from "react";
import { api } from "./api";
import { Status, useAsync } from "./components/ui";
import AccuracyLab from "./pages/AccuracyLab";
import DecisionDesk from "./pages/DecisionDesk";
import Explorer from "./pages/Explorer";
import Method from "./pages/Method";

const TABS = [
  { id: "desk", label: "Decision Desk" },
  { id: "explorer", label: "Forecast Explorer" },
  { id: "accuracy", label: "Accuracy Lab" },
  { id: "method", label: "Method" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const fromHash = (): TabId => {
  const h = window.location.hash.replace("#", "");
  return (TABS.find((t) => t.id === h)?.id ?? "desk") as TabId;
};

export default function App() {
  const [tab, setTab] = useState<TabId>(fromHash);
  const meta = useAsync(api.meta, []);

  useEffect(() => {
    const onHash = () => setTab(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/favicon.svg" alt="" />
          <div>
            <h1>Wind Watch</h1>
            <p>GB day-ahead wind forecast intelligence · January 2026 pilot</p>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => { window.location.hash = t.id; }}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <Status loading={meta.loading} error={meta.error} />
      {meta.data && (
        <main>
          {tab === "desk" && <DecisionDesk meta={meta.data} />}
          {tab === "explorer" && <Explorer meta={meta.data} />}
          {tab === "accuracy" && <AccuracyLab />}
          {tab === "method" && <Method meta={meta.data} />}
        </main>
      )}

      <footer>
        Data: Elexon Insights – FUELHH (wind outturn) and WINDFOR (wind forecast). Times shown in UK local time.
      </footer>
    </div>
  );
}
