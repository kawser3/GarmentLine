import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, ErrorAlert, Empty, Loading, TableWrap } from "@/components/ui";
import { FilterToolbar, useRowFilter } from "@/components/table-toolbar";
import {
  ISSUE_TYPES, SEVERITIES, STATUSES, STATUS_LABEL,
  buyers, issues as issuesCrud, linesCrud, stylesCrud,
  type Issue, type Severity, type Status,
} from "@/features/data/garment-schemas";
import { visibleIssues } from "@/features/issues/scope";
import { useAuthStore } from "@/stores/auth";
import { useI18nStore } from "@/features/i18n/i18n";
import { formatDate } from "@/lib/format";

const SEVERITY_TONE: Record<Severity, "danger" | "warning" | "info" | undefined> = {
  Critical: "danger", High: "warning", Medium: "info", Low: undefined,
};

/** Closed and Verified are settled; everything else is still costing someone time. */
const STATUS_TONE: Partial<Record<Status, "success" | "warning" | "danger" | "info">> = {
  Raised: "danger", Reviewed: "warning", CorrectionUnderWay: "warning",
  Corrected: "info", Verified: "success", Closed: "success", Rejected: "danger",
};

export function IssuesPage() {
  const user = useAuthStore((s) => s.user);
  const locale = useI18nStore((s) => s.locale);
  const all = issuesCrud.useAll();
  const styles = stylesCrud.useAll();
  const lines = linesCrud.useAll();
  const buyerList = buyers.useAll();

  const styleName = useMemo(
    () => new Map((styles.data ?? []).map((s) => [s.ItemId, s.StyleCode])), [styles.data]);
  const lineName = useMemo(
    () => new Map((lines.data ?? []).map((l) => [l.ItemId, l.Name])), [lines.data]);
  const buyerName = useMemo(
    () => new Map((buyerList.data ?? []).map((b) => [b.ItemId, b.Name])), [buyerList.data]);

  /* Scope before filtering: a supervisor's "all" is their lines, not the factory's. */
  const scoped = useMemo(
    () => visibleIssues(user, all.data ?? [], styles.data ?? [], lines.data ?? []),
    [user, all.data, styles.data, lines.data]);

  const FILTERS = useMemo(() => [
    { key: "status", label: "Status", options: STATUSES.map((v) => ({ value: v, label: STATUS_LABEL[v] })) },
    { key: "type", label: "Type", options: ISSUE_TYPES.map((v) => ({ value: v, label: v })) },
    { key: "severity", label: "Severity", options: SEVERITIES.map((v) => ({ value: v, label: v })) },
  ], []);

  const filter = useRowFilter<Issue>(scoped, {
    getText: (i) =>
      [i.Title, i.Description, i.OwnerName, styleName.get(i.StyleId), lineName.get(i.LineId)]
        .filter(Boolean).join(" "),
    filters: FILTERS,
    getFilterValue: (i, key) =>
      key === "status" ? i.Status : key === "type" ? i.Type : key === "severity" ? i.Severity : undefined,
  });

  if (all.error) return <ErrorAlert error={all.error} />;
  if (all.isPending) return <Loading label="Loading issues…" />;

  const rows = [...filter.rows].sort(
    (a, b) => new Date(b.CreatedDate ?? 0).getTime() - new Date(a.CreatedDate ?? 0).getTime());

  return (
    <Card
      span
      title="Issues"
      sub="Sample comments and production defects, in the order they were raised."
    >
      <FilterToolbar filter={filter} filters={FILTERS} />
      {rows.length === 0 ? (
        <Empty title="No issues match">Clear the filters to see the whole register.</Empty>
      ) : (
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>Issue</th><th>Style</th><th>Buyer</th><th>Line</th>
                <th>Type</th><th>Severity</th><th>Status</th><th>Owner</th><th>Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.ItemId}>
                  <td><Link to={`/issues/${i.ItemId}`}>{i.Title}</Link></td>
                  <td>{styleName.get(i.StyleId) ?? "—"}</td>
                  <td>{buyerName.get(i.BuyerId) ?? "—"}</td>
                  <td>{lineName.get(i.LineId) ?? "—"}</td>
                  <td>{i.Type}</td>
                  <td><Badge tone={SEVERITY_TONE[i.Severity]}>{i.Severity}</Badge></td>
                  <td><Badge tone={STATUS_TONE[i.Status]}>{STATUS_LABEL[i.Status]}</Badge></td>
                  <td>{i.OwnerName || "—"}</td>
                  <td>{i.DueDate ? formatDate(i.DueDate, locale) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
