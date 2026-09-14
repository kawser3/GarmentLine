import { NavLink, Outlet } from "react-router-dom";
import { Card, Empty, ErrorAlert, Loading, TableWrap } from "@/components/ui";
import { buyers, linesCrud, stylesCrud } from "@/features/data/garment-schemas";
import { useI18nStore } from "@/features/i18n/i18n";
import { formatDate } from "@/lib/format";

const TABS = [
  { to: "/master/buyers", label: "Buyers" },
  { to: "/master/styles", label: "Styles" },
  { to: "/master/lines", label: "Lines" },
];

export function MasterDataLayout() {
  return (
    <>
      <Card span title="Master data" sub="Buyers, styles and lines — the records everything else links to.">
        <nav className="tabs">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? "tab active" : "tab")}>
              {t.label}
            </NavLink>
          ))}
        </nav>
      </Card>
      <Outlet />
    </>
  );
}

export function BuyersPage() {
  const q = buyers.useAll();
  if (q.error) return <ErrorAlert error={q.error} />;
  if (q.isPending) return <Loading label="Loading buyers…" />;
  const rows = q.data ?? [];
  return (
    <Card span title="Buyers">
      {rows.length === 0 ? <Empty title="No buyers" /> : (
        <TableWrap>
          <table>
            <thead><tr><th>Name</th><th>Country</th><th>Contact</th><th>Report language</th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.ItemId}>
                  <td><strong>{b.Name}</strong></td>
                  <td>{b.Country}</td>
                  <td>{b.ContactEmail}</td>
                  <td>{b.PreferredLanguage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

export function StylesPage() {
  const locale = useI18nStore((s) => s.locale);
  const q = stylesCrud.useAll();
  const b = buyers.useAll();
  if (q.error) return <ErrorAlert error={q.error} />;
  if (q.isPending) return <Loading label="Loading styles…" />;
  const buyerName = new Map((b.data ?? []).map((x) => [x.ItemId, x.Name]));
  const rows = q.data ?? [];
  return (
    <Card span title="Styles">
      {rows.length === 0 ? <Empty title="No styles" /> : (
        <TableWrap>
          <table>
            <thead>
              <tr><th>Code</th><th>Name</th><th>Buyer</th><th>Season</th><th>Order qty</th><th>Ship date</th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.ItemId}>
                  <td><strong>{s.StyleCode}</strong></td>
                  <td>{s.Name}</td>
                  <td>{buyerName.get(s.BuyerId) ?? "—"}</td>
                  <td>{s.Season}</td>
                  <td>{s.OrderQty?.toLocaleString() ?? "—"}</td>
                  <td>{s.ShipDate ? formatDate(s.ShipDate, locale) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

export function LinesPage() {
  const q = linesCrud.useAll();
  if (q.error) return <ErrorAlert error={q.error} />;
  if (q.isPending) return <Loading label="Loading lines…" />;
  const rows = q.data ?? [];
  return (
    <Card span title="Production lines">
      {rows.length === 0 ? <Empty title="No lines" /> : (
        <TableWrap>
          <table>
            <thead><tr><th>Line</th><th>Plant</th><th>Workers</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.ItemId}>
                  <td><strong>{l.Name}</strong></td>
                  <td>{l.PlantId}</td>
                  <td>{l.WorkerCount?.toLocaleString() ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
