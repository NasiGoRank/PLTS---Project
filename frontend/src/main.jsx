import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const TABS = ["Overview", "Energy", "Revenue"];

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value));
}

function money(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "Tidak tersedia";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function compactMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (Math.abs(number) >= 1_000_000_000) return `${formatNumber(number / 1_000_000_000, 2)}B`;
  if (Math.abs(number) >= 1_000_000) return `${formatNumber(number / 1_000_000, 2)}M`;
  if (Math.abs(number) >= 1_000) return `${formatNumber(number / 1_000, 1)}K`;
  return formatNumber(number, 0);
}

function toMwh(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number / 1000 : null;
}

function useMonitoringData() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const configuredApiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
    const apiBase = configuredApiBase || (import.meta.env.DEV ? "http://localhost:8000" : "");
    const pollInterval = Math.max(15_000, Number(import.meta.env.VITE_POLL_INTERVAL_MS || 60_000));

    if (!apiBase) {
      setError("VITE_API_URL is not configured for this deployment");
      return undefined;
    }

    const endpoint = `${apiBase}/api/current`;

    const load = async () => {
      try {
        const response = await fetch(`${endpoint}?ts=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Monitoring API returned ${response.status}`);
        const json = await response.json();
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };

    load();
    const timer = window.setInterval(load, pollInterval);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return { data, error };
}

function App() {
  const { data, error } = useMonitoringData();
  const [activeTab, setActiveTab] = useState("Overview");
  const [selectedId, setSelectedId] = useState(null);
  const [sitesOpen, setSitesOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const sites = useMemo(() => {
    if (!data?.by_site) return [];
    return Object.entries(data.by_site).map(([key, site]) => ({ key, ...site }));
  }, [data]);

  const locations = useMemo(() => {
    return sites.flatMap((site) => (site.stations || []).map((station) => ({
      ...station,
      source: site.platform,
      site,
      uid: `${site.platform}-${station.station_id}`,
    })));
  }, [sites]);

  useEffect(() => {
    if (!selectedId && locations.length) setSelectedId(locations[0].uid);
  }, [locations, selectedId]);

  const selected = locations.find((location) => location.uid === selectedId) || locations[0];
  const fleet = useMemo(() => buildFleet(sites, locations), [sites, locations]);
  const selectSite = (uid) => {
    setSelectedId(uid);
    setSitesOpen(false);
    setMobileMenuOpen(false);
  };
  const selectTab = (tab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  if (error && !data) return <Shell><StateCard title="Unable to load data" message={error} /></Shell>;
  if (!data) return <Shell><StateCard title="Loading monitor" message="Reading latest normalized PLTS snapshot..." /></Shell>;

  return (
    <Shell>
      <TopNav
        activeTab={activeTab}
        onSelectTab={selectTab}
        updatedAt={data.updated_at}
        sitesOpen={sitesOpen}
        setSitesOpen={setSitesOpen}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
      />
      <SitesPanel open={sitesOpen} locations={locations} selectedId={selected?.uid} onClose={() => setSitesOpen(false)} onSelect={selectSite} />
      <MobileNavPanel open={mobileMenuOpen} activeTab={activeTab} onClose={() => setMobileMenuOpen(false)} onSelectTab={selectTab} />
      <main className="workspace">
        <HeroPanel fleet={fleet} selected={selected} />
        {activeTab === "Overview" && <OverviewTab fleet={fleet} selected={selected} />}
        {activeTab === "Energy" && <EnergyTab location={selected} fleet={fleet} />}
        {activeTab === "Revenue" && <RevenueTab location={selected} fleet={fleet} />}
      </main>
    </Shell>
  );
}

function buildFleet(sites, locations) {
  const overview = sites.map((site) => site.overview || {});
  return {
    stations: locations.length,
    platforms: sites.length,
    offline: locations.filter((item) => item.status === "offline").length,
    capacity: overview.reduce((sum, item) => sum + (Number(item.capacity_kwp) || 0), 0),
    current: overview.reduce((sum, item) => sum + (Number(item.current_power_kw) || 0), 0),
    daily: overview.reduce((sum, item) => sum + (Number(item.daily_energy_kwh) || 0), 0),
    monthly: overview.reduce((sum, item) => sum + (Number(item.monthly_energy_kwh) || 0), 0),
    yearly: overview.reduce((sum, item) => sum + (Number(item.yearly_energy_kwh) || 0), 0),
    total: overview.reduce((sum, item) => sum + (Number(item.cumulative_energy_kwh) || 0), 0),
    monthlyIncome: overview.reduce((sum, item) => sum + (Number(item.monthly_income) || 0), 0),
    yearlyIncome: overview.reduce((sum, item) => sum + (Number(item.yearly_income) || 0), 0),
    totalIncome: overview.reduce((sum, item) => sum + (Number(item.cumulative_income) || 0), 0),
  };
}

function Shell({ children }) {
  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <div className="ambient ambient-c" />
      <div className="noise-layer" />
      <div className="grid-layer" />
      <div className="app-frame">{children}</div>
    </div>
  );
}

function TopNav({ activeTab, onSelectTab, updatedAt, sitesOpen, setSitesOpen, mobileMenuOpen, setMobileMenuOpen }) {
  const updated = updatedAt ? new Date(updatedAt).toLocaleString("en-GB", { hour12: false }) : "-";
  return (
    <nav className="top-nav surface">
      <button
        type="button"
        className="site-trigger"
        aria-label="Open PLTS sites panel"
        aria-expanded={sitesOpen}
        onClick={() => setSitesOpen(!sitesOpen)}
      >
        <SolarIcon />
        <span>Sites</span>
      </button>
      <div className="brand">
        <span className="status-dot" />
        <div>
          <strong>PLTS Monitor</strong>
          <span>Huawei + Kehua</span>
        </div>
      </div>
      <div className="nav-tabs" role="tablist" aria-label="Monitoring sections">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "active" : ""}
            onClick={() => onSelectTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="sync-pill">
        <span>Last sync</span>
        <strong>{updated}</strong>
      </div>
      <button
        type="button"
        className="mobile-menu-trigger"
        aria-label="Open navigation menu"
        aria-expanded={mobileMenuOpen}
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
      >
        <span />
        <span />
      </button>
    </nav>
  );
}

function SolarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 10.5h14" />
      <path d="M6.5 6.5h11l1.5 9h-14z" />
      <path d="M8.5 6.5l-.8 9" />
      <path d="M15.5 6.5l.8 9" />
      <path d="M12 6.5v9" />
      <path d="M4 18.5h16" />
    </svg>
  );
}

function SitesPanel({ open, locations, selectedId, onClose, onSelect }) {
  return (
    <>
      <button type="button" className={`panel-backdrop ${open ? "open" : ""}`} aria-label="Close sites panel" tabIndex={open ? 0 : -1} onClick={onClose} />
      <aside className={`sites-panel surface ${open ? "open" : ""}`} aria-hidden={!open} inert={open ? undefined : true}>
        <div className="slide-panel-head">
          <div>
            <span className="eyebrow">PLTS selector</span>
            <h2>Sites</h2>
          </div>
          <button type="button" className="panel-close" onClick={onClose}>Close</button>
        </div>
        <SitePanelList locations={locations} selectedId={selectedId} onSelect={onSelect} />
      </aside>
    </>
  );
}

function MobileNavPanel({ open, activeTab, onClose, onSelectTab }) {
  return (
    <>
      <button type="button" className={`panel-backdrop ${open ? "open" : ""}`} aria-label="Close navigation menu" tabIndex={open ? 0 : -1} onClick={onClose} />
      <aside className={`mobile-nav-panel surface ${open ? "open" : ""}`} aria-hidden={!open} inert={open ? undefined : true}>
        <div className="slide-panel-head">
          <div>
            <span className="eyebrow">Menu</span>
            <h2>Navigation</h2>
          </div>
          <button type="button" className="panel-close" onClick={onClose}>Close</button>
        </div>
        <div className="mobile-nav-actions">
          {TABS.map((tab) => (
            <button key={tab} type="button" className={activeTab === tab ? "active" : ""} onClick={() => onSelectTab(tab)}>{tab}</button>
          ))}
        </div>
      </aside>
    </>
  );
}

function SitePanelList({ locations, selectedId, onSelect }) {
  return (
    <div className="site-panel-list">
      {locations.map((location) => (
        <button key={location.uid} type="button" className={`site-panel-card ${selectedId === location.uid ? "active" : ""}`} onClick={() => onSelect(location.uid)}>
          <div className="site-panel-card-head">
            <span className={`status-dot ${location.status !== "normal" ? "muted" : ""}`} />
            <div>
              <strong>{location.name}</strong>
              <em>{location.source} · {location.station_id}</em>
            </div>
            <span className={`status-badge ${location.status === "normal" ? "online" : "offline"}`}>{location.status === "normal" ? "Online" : "Offline"}</span>
          </div>
          <div className="site-panel-metrics">
            <span><b>{formatNumber(location.capacity_kwp)}</b> kWp</span>
            <span><b>{formatNumber(location.current_power_kw)}</b> kW</span>
            <span><b>{formatNumber(location.monthly_energy_kwh, 0)}</b> kWh/bln</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function HeroPanel({ fleet, selected }) {
  return (
    <header className="hero-grid">
      <section className="hero-copy surface spotlight-card">
        <p className="eyebrow">Unified production console</p>
        <h1>
          Monitoring PLTS
        </h1>
        <p className="hero-text">
          Dashboard ringkas untuk memantau kWh, MWh, akumulasi rupiah, dan status lokasi dari Huawei FusionSolar dan Kehua.
        </p>
      </section>
      <section className="hero-terminal surface">
        <div className="terminal-head">
          <span>Selected site</span>
          <strong>{selected?.source || "-"}</strong>
        </div>
        <h2>{selected?.name || "No station selected"}</h2>
        <div className="terminal-stats">
          <TerminalStat label="Power" value={formatNumber(selected?.current_power_kw)} unit="kW" />
          <TerminalStat label="Month" value={formatNumber(selected?.monthly_energy_kwh, 0)} unit="kWh" />
          <TerminalStat label="Total" value={formatNumber(selected?.cumulative_energy_kwh, 0)} unit="kWh" />
          <TerminalStat label="Revenue" value={compactMoney(selected?.cumulative_income)} unit="IDR" />
        </div>
      </section>
      <div className="fleet-strip surface">
        <MiniMetric label="Sites" value={fleet.stations} />
        <MiniMetric label="Capacity" value={formatNumber(fleet.capacity)} unit="kWp" />
        <MiniMetric label="Now" value={formatNumber(fleet.current)} unit="kW" />
        <MiniMetric label="Month" value={formatNumber(fleet.monthly, 0)} unit="kWh" />
        <MiniMetric label="Revenue" value={compactMoney(fleet.totalIncome)} unit="IDR" accent />
      </div>
    </header>
  );
}

function OverviewTab({ fleet, selected }) {
  return (
    <Panel title="Overview" subtitle="Fleet performance snapshot">
      <div className="metric-grid four">
        <MetricCard label="Daily energy" value={formatNumber(fleet.daily)} unit="kWh" />
        <MetricCard label="Monthly energy" value={formatNumber(fleet.monthly, 0)} unit="kWh" />
        <MetricCard label="Yearly energy" value={formatNumber(fleet.yearly, 0)} unit="kWh" />
        <MetricCard label="Total revenue" value={money(fleet.totalIncome)} unit="IDR" accent />
      </div>
      <ChartCard large title="Fleet energy visualization" caption="Daily, monthly, yearly, and lifetime generation plotted on a normalized scale." points={[
        ["Daily", fleet.daily],
        ["Monthly", fleet.monthly],
        ["Yearly", fleet.yearly],
        ["Total", fleet.total],
      ]} />
      <div className="content-split">
        <InfoCard title="Selected location">
          <LocationFacts location={selected} />
        </InfoCard>
        <InfoCard title="Fleet register">
          <div className="facts-grid">
            <DataLine label="Total sites" value={fleet.stations} />
            <DataLine label="Platforms" value={fleet.platforms} />
            <DataLine label="Offline" value={fleet.offline} />
            <DataLine label="Current power" value={`${formatNumber(fleet.current)} kW`} />
          </div>
        </InfoCard>
      </div>
    </Panel>
  );
}

function SitesTab({ locations, selectedId, onSelect }) {
  return (
    <Panel title="Sites" subtitle="Available PLTS locations and live status">
      <div className="site-status-list surface-inset">
        {locations.map((location) => (
          <button key={location.uid} type="button" onClick={() => onSelect(location.uid)} className={`site-status-row ${selectedId === location.uid ? "active" : ""}`}>
            <div className="site-status-name">
              <span className={`status-dot ${location.status !== "normal" ? "muted" : ""}`} />
              <div>
                <strong>{location.name}</strong>
                <em>{location.source} · {location.station_id}</em>
              </div>
            </div>
            <span className={`status-badge ${location.status === "normal" ? "online" : "offline"}`}>{location.status === "normal" ? "Online" : "Offline"}</span>
            <span>{formatNumber(location.capacity_kwp)} kWp</span>
            <span>{formatNumber(location.monthly_energy_kwh, 0)} kWh/bln</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function EnergyTab({ location, fleet }) {
  const energy = energyMetrics(location);
  return (
    <Panel title="Energy" subtitle="kWh and MWh by selected location">
      <div className="metric-grid four">
        <MetricCard label="Daily" value={formatNumber(energy.daily)} unit="kWh" sub={`${formatNumber(toMwh(energy.daily), 3)} MWh`} />
        <MetricCard label="Monthly" value={formatNumber(energy.monthly)} unit="kWh" sub={`${formatNumber(toMwh(energy.monthly), 3)} MWh`} />
        <MetricCard label="Yearly" value={formatNumber(energy.yearly)} unit="kWh" sub={`${formatNumber(toMwh(energy.yearly), 3)} MWh`} />
        <MetricCard label="Total" value={formatNumber(energy.total)} unit="kWh" sub={`${formatNumber(toMwh(energy.total), 3)} MWh`} accent />
      </div>
      <ChartCard large title="Selected site energy curve" caption={location?.name || "Selected PLTS location"} points={[
        ["Daily", energy.daily],
        ["Monthly", energy.monthly],
        ["Yearly", energy.yearly],
        ["Total", energy.total],
      ]} />
      <div className="content-split">
        <ChartCard title="Fleet energy reference" points={[
          ["Daily", fleet.daily],
          ["Monthly", fleet.monthly],
          ["Yearly", fleet.yearly],
          ["Total", fleet.total],
        ]} />
        <InfoCard title="Unit conversion">
          <div className="facts-grid">
            <DataLine label="Daily MWh" value={`${formatNumber(toMwh(energy.daily), 3)} MWh`} />
            <DataLine label="Monthly MWh" value={`${formatNumber(toMwh(energy.monthly), 3)} MWh`} />
            <DataLine label="Yearly MWh" value={`${formatNumber(toMwh(energy.yearly), 3)} MWh`} />
            <DataLine label="Total MWh" value={`${formatNumber(toMwh(energy.total), 3)} MWh`} />
          </div>
        </InfoCard>
      </div>
    </Panel>
  );
}

function RevenueTab({ location, fleet }) {
  const revenue = revenueMetrics(location);
  return (
    <Panel title="Revenue" subtitle="Rupiah accumulation from platform feed">
      <div className="metric-grid four">
        <MetricCard label="Daily" value={money(revenue.daily)} unit="IDR" />
        <MetricCard label="Monthly" value={money(revenue.monthly)} unit="IDR" />
        <MetricCard label="Yearly" value={money(revenue.yearly)} unit="IDR" />
        <MetricCard label="Total" value={money(revenue.total)} unit="IDR" accent />
      </div>
      {revenue.hasAny ? <ChartCard large moneyMode title="Selected site revenue visualization" caption={location?.name || "Selected PLTS location"} points={[
        ["Daily", revenue.daily],
        ["Monthly", revenue.monthly],
        ["Yearly", revenue.yearly],
        ["Total", revenue.total],
      ]} /> : <InfoCard title="Selected revenue"><EmptyState message="Data rupiah belum tersedia untuk lokasi ini." /></InfoCard>}
      <div className="content-split">
        <ChartCard moneyMode title="Fleet revenue" points={[
          ["Monthly", fleet.monthlyIncome],
          ["Yearly", fleet.yearlyIncome],
          ["Total", fleet.totalIncome],
        ]} />
        <InfoCard title="Revenue register">
          <div className="facts-grid">
            <DataLine label="Fleet month" value={money(fleet.monthlyIncome)} />
            <DataLine label="Fleet year" value={money(fleet.yearlyIncome)} />
            <DataLine label="Fleet total" value={money(fleet.totalIncome)} />
            <DataLine label="Selected total" value={money(revenue.total)} />
          </div>
        </InfoCard>
      </div>
    </Panel>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <article className="panel surface spotlight-card">
      <div className="panel-title">
        <p className="eyebrow">{subtitle}</p>
        <h2>{title}</h2>
      </div>
      {children}
    </article>
  );
}

function MetricCard({ label, value, unit, sub, accent }) {
  return (
    <section className={`metric-card ${accent ? "accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{unit}</em>
      {sub && <small>{sub}</small>}
    </section>
  );
}

function MiniMetric({ label, value, unit, accent }) {
  return (
    <div className={`mini-metric ${accent ? "accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {unit && <em>{unit}</em>}
    </div>
  );
}

function TerminalStat({ label, value, unit }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{unit}</em>
    </div>
  );
}

function InfoCard({ title, children }) {
  return (
    <section className="info-card surface-inset">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function ChartCard({ title, caption, points, moneyMode, large }) {
  return (
    <section className={`chart-card surface-inset ${large ? "chart-card-large" : ""}`}>
      <div className="chart-card-head">
        <div>
          <h3>{title}</h3>
          {caption && <p>{caption}</p>}
        </div>
        <span>{moneyMode ? "IDR" : "kWh"}</span>
      </div>
      <LineChart points={points} moneyMode={moneyMode} large={large} />
    </section>
  );
}

function LineChart({ points, moneyMode, large }) {
  const gradientId = React.useId();
  const areaId = React.useId();
  const valid = points.map(([, value]) => Number(value)).filter((value) => Number.isFinite(value));
  const max = Math.max(...valid, 1);
  const min = Math.min(...valid, 0);
  const range = Math.max(max - min, 1);
  const coords = points.map(([, value], index) => {
    const x = 1 + (index / Math.max(points.length - 1, 1)) * 96;
    const numeric = Number(value);
    const safe = Number.isFinite(numeric) ? numeric : min;
    const y = 82 - ((safe - min) / range) * 68;
    return { x, y };
  });
  const axisValue = (value) => moneyMode ? compactMoney(value) : formatNumber(value, 0);
  const yTicks = Array.from({ length: 5 }, (_, index) => ({
    value: max - (range * index) / 4,
    top: 14 + index * 17,
  }));
  const path = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = `${coords.map((point) => `${point.x},${point.y}`).join(" ")} ${coords.at(-1)?.x || 97},88 ${coords[0]?.x || 1},88`;
  return (
    <div>
      <div className={`line-chart-wrap ${large ? "large" : ""}`}>
        <svg viewBox="0 0 100 100" className={`line-chart ${large ? "large" : ""}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
              <stop stopColor="#8b94ff" />
              <stop offset="1" stopColor="#5E6AD2" />
            </linearGradient>
            <linearGradient id={areaId} x1="0" x2="0" y1="0" y2="1">
              <stop stopColor="rgba(94,106,210,.32)" />
              <stop offset="1" stopColor="rgba(94,106,210,0)" />
            </linearGradient>
          </defs>
          {yTicks.map((tick) => <line key={tick.top} x1="1" x2="100" y1={tick.top} y2={tick.top} className="chart-grid-line" />)}
          <line x1="1" x2="100" y1="88" y2="88" className="chart-axis-line" />
          <line x1="1" x2="1" y1="10" y2="88" className="chart-axis-line" />
          <polygon points={areaPath} fill={`url(#${areaId})`} />
          <polyline points={path} fill="none" stroke={`url(#${gradientId})`} strokeWidth={large ? "4.5" : "3.5"} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="axis-y" aria-hidden="true">
          {yTicks.map((tick) => <span key={tick.top} style={{ top: `${tick.top}%` }}>{axisValue(tick.value)}</span>)}
        </div>
        <div className="axis-x" aria-hidden="true">
          {coords.map((point, index) => <span key={index} style={{ left: `${point.x}%` }}>{String(index + 1).padStart(2, "0")}</span>)}
        </div>
      </div>
      <div className="chart-legend">
        {points.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{moneyMode ? money(value) : formatNumber(value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function LocationFacts({ location }) {
  if (!location) return <EmptyState message="Belum ada lokasi di data monitoring." />;
  return (
    <div className="facts-grid">
      <DataLine label="Station" value={location.name} />
      <DataLine label="Platform" value={location.source} />
      <DataLine label="Status" value={location.status || "unknown"} />
      <DataLine label="Capacity" value={`${formatNumber(location.capacity_kwp)} kWp`} />
      <DataLine label="Power" value={`${formatNumber(location.current_power_kw)} kW`} />
      <DataLine label="Station ID" value={location.station_id} />
      <DataLine label="Address" value={location.address || "Alamat belum tersedia"} wide />
    </div>
  );
}

function SiteTable({ locations }) {
  return (
    <div className="site-table surface-inset">
      {locations.map((location) => (
        <div key={location.uid}>
          <span>{location.name}</span>
          <span>{location.source}</span>
          <span>{formatNumber(location.monthly_energy_kwh, 0)} kWh</span>
          <span>{money(location.cumulative_income)}</span>
        </div>
      ))}
    </div>
  );
}

function DataLine({ label, value, wide }) {
  return (
    <div className={wide ? "wide" : ""}>
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function EmptyState({ message }) {
  return <div className="empty-state">{message}</div>;
}

function StateCard({ title, message }) {
  return (
    <div className="state-card surface">
      <p className="eyebrow">{title}</p>
      <h1>{message}</h1>
    </div>
  );
}

function energyMetrics(location) {
  return {
    daily: location?.daily_energy_kwh,
    monthly: location?.monthly_energy_kwh,
    yearly: location?.yearly_energy_kwh,
    total: location?.cumulative_energy_kwh,
  };
}

function revenueMetrics(location) {
  const values = {
    daily: location?.daily_income,
    monthly: location?.monthly_income,
    yearly: location?.yearly_income,
    total: location?.cumulative_income,
  };
  return {
    ...values,
    hasAny: Object.values(values).some((value) => value !== null && value !== undefined && !Number.isNaN(Number(value))),
  };
}

createRoot(document.getElementById("root")).render(<App />);
