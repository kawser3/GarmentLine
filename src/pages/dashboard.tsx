import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, ErrorAlert, Loading, Stat, TableWrap } from "@/components/ui";
import { CategoryBars, CategoryPie, type CatPoint } from "@/components/charts";
import { PageHead } from "@/components/layout";
import {
  OPEN_STATUSES, buyers, costAssumptions, issues as issuesCrud,
  linesCrud, repeatAlerts, stylesCrud,
} from "@/features/data/garment-schemas";
import { visibleIssues } from "@/features/issues/scope";
import { canSeeCostImpact, useAuthStore } from "@/stores/auth";
import { useI18nStore, useT } from "@/features/i18n/i18n";
import { formatDate } from "@/lib/format";

/** Rank a map of label -> count, biggest first. */
function rank(counts: Map<string, number>, limit = 6) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** A tally as the chart components want it, biggest first. */
function toPoints(counts: Map<string, number>, limit = 6): CatPoint[] {
  return rank(counts, limit).map(([label, value]) => ({ key: label, label, value }));
}

/** Counts, not money — the chart default writes francs. */
const countOf = (v: number) => String(v);

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
  const t = useT();

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

  /* "This month" in the brief's sense: the trailing 30 days, not a calendar
     boundary — and measured from RaisedAt, when it happened on the floor, not
     from CreatedDate, which is when the row reached the gateway. */
  const recent = useMemo(() => {
    const cut = Date.now() - 30 * 86400e3;
    return scoped.filter((i) => new Date(i.RaisedAt ?? i.CreatedDate ?? 0).getTime() >= cut);
  }, [scoped]);

  if (all.error) return <ErrorAlert error={all.error} />;
  if (all.isPending) return <Loading label={t("detail.loading")} />;

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
      <PageHead
        title={t("nav.dashboard")}
        description={t("page.dashboard.desc")}
      />
      <div className="grid">
        <Card span title={t("page.dashboard.card")} sub={t("page.dashboard.cardSub")}>
          <div className="grid stats">
            <Stat label={t("stat.openIssues")} value={String(open.length)}
              hint={t("stat.raisedLast30", { n: recent.length })} />
            <Stat label={t("stat.worstBuyer")} value={worstBuyer?.[0] ?? "—"}
              hint={worstBuyer ? t("stat.nIssues", { n: worstBuyer[1] }) : t("stat.noneThisMonth")} />
            <Stat label={t("stat.worstLine")} value={worstLine?.[0] ?? "—"}
              hint={worstLine ? t("stat.nIssues", { n: worstLine[1] }) : t("stat.noneThisMonth")} />
            <Stat label={t("stat.worstType")} value={worstType?.[0] ?? "—"}
              hint={worstType ? t("stat.nOccurrences", { n: worstType[1] }) : t("stat.noneThisMonth")} />
          </div>
        </Card>

        {live.length > 0 && (
          <Card
            span
            title={t("page.dashboard.repeat")}
            sub={t("page.dashboard.repeatSub")}
          >
            <TableWrap>
              <thead>
                <tr><th>{t("col.line")}</th><th>{t("col.defect")}</th><th>{t("col.occurrences")}</th><th>{t("col.window")}</th><th>{t("col.detected")}</th><th>{t("col.evidence")}</th></tr>
              </thead>
              <tbody>
                {live.map((a) => (
                  <tr key={a.ItemId}>
                    <td><strong>{lineName.get(a.LineId) ?? "—"}</strong></td>
                    <td><Badge tone="danger">{a.IssueType}</Badge></td>
                    <td>{a.Occurrences}</td>
                    <td>{t("stat.nDays", { n: a.WindowDays })}</td>
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
            </TableWrap>
            {live.map((a) => <p key={a.ItemId} className="muted">{a.Message}</p>)}
          </Card>
        )}

        {/*
          Side by side, equal height. A row of peers has to stretch — `.grid`
          defaults to `align-items: start`, and left alone the three cards ended
          at three different heights and read as three unrelated blocks of
          differing importance.

          Five entries each, not six: a bar row needs ~300px to keep its label
          off its track, so in a third of the page the list has to be short
          enough that every bar still has room to be compared. The grid drops to
          two columns at 1180px and one at 760px, before that floor is hit.

          Bars for line and buyer because the question is "which is worst" and
          length answers that in one look. A donut for type because that question
          is "what is the mix" — a share of a whole, the one thing a donut does
          better than a bar. Counts, so formatValue is passed: the default is money.
        */}
        <div className="grid equal three">
          <Card title={t("page.dashboard.byLine")} sub={t("page.dashboard.last30")}>
            <CategoryBars
              data={toPoints(byLine, 5)}
              formatValue={countOf}
              emptyLabel={t("empty.nothingThisMonth")}
            />
          </Card>

          <Card title={t("page.dashboard.byBuyer")} sub={t("page.dashboard.last30")}>
            <CategoryBars
              data={toPoints(byBuyer, 5)}
              formatValue={countOf}
              emptyLabel={t("empty.nothingThisMonth")}
            />
          </Card>

          <Card title={t("page.dashboard.byType")} sub={t("page.dashboard.last30")}>
            <CategoryPie
              data={toPoints(byType, 5)}
              centerLabel={String(recent.length)}
              emptyLabel={t("empty.nothingThisMonth")}
            />
          </Card>
        </div>

        {canSeeCostImpact(user) && (
          <Card
            span
            title={t("page.dashboard.cost")}
            sub={t("page.dashboard.costSub")}
          >
            <div className="grid stats">
              <Stat label={t("stat.stylesAtRisk")} value={String(atRisk.length)} />
              <Stat label={t("stat.unitsAtRisk")} value={unitsAtRisk.toLocaleString()} hint={t("stat.unitsHint")} />
              <Stat
                label={t("stat.chargeback")}
                value={`${minPct}–${maxPct}%`}
                hint={t("stat.chargebackHint")}
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
      </div>
    </>
  );
}
