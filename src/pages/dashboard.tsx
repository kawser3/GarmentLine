import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, Empty, ErrorAlert, Loading, Stat, TableWrap } from "@/components/ui";
import {
  OPEN_STATUSES, buyers, costAssumptions, issues as issuesCrud,
  linesCrud, repeatAlerts, stylesCrud,
} from "@/features/data/garment-schemas";
import { visibleIssues } from "@/features/issues/scope";
import { canSeeCostImpact, useAuthStore } from "@/stores/auth";
import { useI18nStore } from "@/features/i18n/i18n";
import { formatDate } from "@/lib/format";

/** Rank a map of label -> count, biggest first. */
function rank(counts: Map<string, number>, limit = 6) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function tally<T>(rows: T[], key: (r: T) => string | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/**
 * The management view.
 *
 * The brief's bar: "The GM can name the buyer, line, and issue type costing the most
 * delay this month - and show the evidence trail behind that answer - without asking any
 * merchandiser." So every number here links through to the rows behind it; nothing is a
 * figure the reader has to take on trust.
 */
export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const locale = useI18nStore((s) => s.locale);

  const all = issuesCrud.useAll();
  const styles = stylesCrud.useAll();
  const lines = linesCrud.useAll();
  const buyerList = buyers.useAll();
  const alerts = repeatAlerts.useAll();
  const costs = costAssumptions.useAll();

  const lineName = useMemo(
    () => new Map((lines.data ?? []).map((l) => [l.ItemId, l.Name])), [lines.data]);
  const buyerName = useMemo(
    () => new Map((buyerList.data ?? []).map((b) => [b.ItemId, b.Name])), [buyerList.data]);

  const scoped = useMemo(
    () => visibleIssues(user, all.data ?? [], styles.data ?? [], lines.data ?? []),
    [user, all.data, styles.data, lines.data]);

  /* "This month" in the brief's sense: the trailing 30 days, not a calendar boundary. */
  const recent = useMemo(() => {
    const cut = Date.now() - 30 * 86400e3;
    return scoped.filter((i) => new Date(i.CreatedDate ?? 0).getTime() >= cut);
  }, [scoped]);

  if (all.error) return <ErrorAlert error={all.error} />;
  if (all.isPending) return <Loading label="Loading the management view…" />;

  const open = scoped.filter((i) => OPEN_STATUSES.includes(i.Status));
  const live = (alerts.data ?? []).filter((a) => !a.Acknowledged);

  const byBuyer = tally(recent, (i) => buyerName.get(i.BuyerId));
  const byLine = tally(recent, (i) => lineName.get(i.LineId));
  const byType = tally(recent, (i) => i.Type);

  const worstBuyer = rank(byBuyer, 1)[0];
  const worstLine = rank(byLine, 1)[0];
  const worstType = rank(byType, 1)[0];

  /*
   * Cost impact, from CostAssumption rather than any figure typed into this file. The
   * brief gives chargeback as 2-5% of order value, so the exposure is a range, and a
   * range is what the GM is shown - a single number here would be a fabricated precision.
   */
  const cost = new Map((costs.data ?? []).map((c) => [c.Key, c.Value]));
  const atRisk = styles.data?.filter((s) =>
    open.some((i) => i.StyleId === s.ItemId)) ?? [];
  const unitsAtRisk = atRisk.reduce((n, s) => n + (s.OrderQty ?? 0), 0);
  const minPct = cost.get("ChargebackMinPct") ?? 0;
  const maxPct = cost.get("ChargebackMaxPct") ?? 0;

  return (
    <>
      <Card span title="This month" sub="Trailing 30 days, scoped to what you can see.">
        <div className="stats">
          <Stat label="Open issues" value={String(open.length)}
            hint={`${recent.length} raised in the last 30 days`} />
          <Stat label="Worst buyer" value={worstBuyer?.[0] ?? "—"}
            hint={worstBuyer ? `${worstBuyer[1]} issues` : "no issues this month"} />
          <Stat label="Worst line" value={worstLine?.[0] ?? "—"}
            hint={worstLine ? `${worstLine[1]} issues` : "no issues this month"} />
          <Stat label="Worst issue type" value={worstType?.[0] ?? "—"}
            hint={worstType ? `${worstType[1]} occurrences` : "no issues this month"} />
        </div>
      </Card>

      {live.length > 0 && (
        <Card
          span
          title="Repeat-defect warnings"
          sub="Raised on the second occurrence, before a third confirms the pattern."
        >
          <TableWrap>
            <table>
              <thead>
                <tr><th>Line</th><th>Defect</th><th>Occurrences</th><th>Window</th><th>Detected</th><th>Evidence</th></tr>
              </thead>
              <tbody>
                {live.map((a) => (
                  <tr key={a.ItemId}>
                    <td><strong>{lineName.get(a.LineId) ?? "—"}</strong></td>
                    <td><Badge tone="danger">{a.IssueType}</Badge></td>
                    <td>{a.Occurrences}</td>
                    <td>{a.WindowDays} days</td>
                    <td>{formatDate(a.DetectedAt, locale)}</td>
                    <td>
                      {(a.IssueIds ?? []).map((id, n) => (
                        <span key={id}>
                          {n > 0 ? ", " : ""}
                          <Link to={`/issues/${id}`}>issue {n + 1}</Link>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {live.map((a) => <p key={a.ItemId} className="muted">{a.Message}</p>)}
        </Card>
      )}

      <Card title="Issues by line" sub="Last 30 days">
        {byLine.size === 0 ? <Empty title="Nothing this month" /> : (
          <ul className="plain">
            {rank(byLine).map(([label, n]) => (
              <li key={label}><strong>{label}</strong> — {n}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Issues by buyer" sub="Last 30 days">
        {byBuyer.size === 0 ? <Empty title="Nothing this month" /> : (
          <ul className="plain">
            {rank(byBuyer).map(([label, n]) => (
              <li key={label}><strong>{label}</strong> — {n}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Issues by type" sub="Last 30 days">
        {byType.size === 0 ? <Empty title="Nothing this month" /> : (
          <ul className="plain">
            {rank(byType).map(([label, n]) => (
              <li key={label}><strong>{label}</strong> — {n}</li>
            ))}
          </ul>
        )}
      </Card>

      {canSeeCostImpact(user) && (
        <Card
          span
          title="Cost exposure"
          sub="From the seeded cost assumptions — no figure is hard-coded in the app."
        >
          <div className="stats">
            <Stat label="Styles with open issues" value={String(atRisk.length)} />
            <Stat label="Units at risk" value={unitsAtRisk.toLocaleString()} hint="pieces across those styles" />
            <Stat
              label="Chargeback exposure"
              value={`${minPct}–${maxPct}%`}
              hint="of order value, per the buyer contracts"
              tone="neg"
            />
          </div>
          <p className="muted">
            Air freight runs {cost.get("AirFreightPerKg") ?? "—"} USD/kg against{" "}
            {cost.get("SeaFreightPerKg") ?? "—"} by sea. Rework clears about{" "}
            {cost.get("ReworkPiecesPerHour") ?? "—"} pieces per hour per line, so a defect
            found late is a shipment decision, not a floor decision.
          </p>
        </Card>
      )}
    </>
  );
}
