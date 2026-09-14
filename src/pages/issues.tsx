import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, ErrorAlert, Empty, Loading, TableWrap } from "@/components/ui";
import { PageHead } from "@/components/layout";
import { FilterToolbar, useRowFilter } from "@/components/table-toolbar";
import {
  ISSUE_TYPES, SEVERITIES, STATUSES, STATUS_LABEL,
  buyers, issues as issuesCrud, linesCrud, stylesCrud,
  type Issue, type Severity, type Status,
} from "@/features/data/garment-schemas";
import { visibleIssues } from "@/features/issues/scope";
import { canRaiseIssue, useAuthStore } from "@/stores/auth";
import { useI18nStore, useT } from "@/features/i18n/i18n";
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
  const t = useT();
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
    <>
      <PageHead
        title={t("nav.issues")}
        description={t("page.issues.desc")}
        actions={canRaiseIssue(user) && (
          <Link to="/issues/new">
            <Button variant="primary" size="sm">+ {t("raise.title")}</Button>
          </Link>
        )}
      />
      <div className="grid one">
        <Card title={t("page.issues.card")} sub={t("page.issues.cardSub")}>
          <FilterToolbar filter={filter} filters={FILTERS} />
          {rows.length === 0 ? (
            <Empty title={t("empty.noIssues")}>{t("empty.noIssuesHint")}</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>{t("col.issue")}</th><th>{t("col.style")}</th><th>{t("col.buyer")}</th><th>{t("col.line")}</th>
                  <th>{t("col.type")}</th><th>{t("col.severity")}</th><th>{t("col.status")}</th><th>{t("col.owner")}</th><th>{t("col.due")}</th>
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
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
