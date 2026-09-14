import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, Empty, ErrorAlert, Loading, TableWrap } from "@/components/ui";
import { PageHead } from "@/components/layout";
import { buyers, sampleVersions, stylesCrud } from "@/features/data/garment-schemas";
import { visibleStyles } from "@/features/issues/scope";
import { useAuthStore } from "@/stores/auth";
import { useI18nStore, useT } from "@/features/i18n/i18n";
import { formatDate } from "@/lib/format";

/**
 * One row per style, answering the brief's first question at a glance: which sample
 * version is approved. The approved version is the LATEST APPROVED one, not the latest
 * one - a style whose newest sample was rejected is still approved at the previous
 * version, and bulk cut against the newest would be the exact mistake this prevents.
 */
export function SamplesPage() {
  const user = useAuthStore((s) => s.user);
  const locale = useI18nStore((s) => s.locale);
  const t = useT();
  const styles = stylesCrud.useAll();
  const versions = sampleVersions.useAll();
  const buyerList = buyers.useAll();

  const buyerName = useMemo(
    () => new Map((buyerList.data ?? []).map((b) => [b.ItemId, b.Name])), [buyerList.data]);

  const scoped = useMemo(
    () => visibleStyles(user, styles.data ?? []), [user, styles.data]);

  if (styles.error) return <ErrorAlert error={styles.error} />;
  if (styles.isPending || versions.isPending) return <Loading label="Loading samples…" />;

  const rows = scoped.map((s) => {
    const mine = (versions.data ?? []).filter((v) => v.StyleId === s.ItemId);
    const bySubmitted = [...mine].sort(
      (a, b) => new Date(b.SubmittedAt).getTime() - new Date(a.SubmittedAt).getTime());
    const approved = bySubmitted.find((v) => v.Status === "Approved");
    const latest = bySubmitted[0];
    return { style: s, approved, latest, count: mine.length };
  });

  return (
    <>
      <PageHead
        title={t("nav.samples")}
        description={t("page.samples.desc")}
      />
      <div className="grid one">
        <Card title={t("page.samples.card")} sub={t("page.samples.cardSub")}>
          {rows.length === 0 ? (
            <Empty title="No styles in your scope" />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>{t("col.style")}</th><th>{t("col.buyer")}</th><th>{t("col.shipDate")}</th>
                  <th>{t("col.approvedVersion")}</th><th>{t("col.latest")}</th><th>{t("col.versions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ style, approved, latest, count }) => (
                  <tr key={style.ItemId}>
                    <td>
                      <Link to={`/samples/${style.ItemId}`}>{style.StyleCode}</Link>
                      <div className="muted">{style.Name}</div>
                    </td>
                    <td>{buyerName.get(style.BuyerId) ?? "—"}</td>
                    <td>{style.ShipDate ? formatDate(style.ShipDate, locale) : "—"}</td>
                    <td>
                      {approved
                        ? <Badge tone="success">{approved.Type} v{approved.VersionNo}</Badge>
                        : <Badge tone="danger">None approved</Badge>}
                    </td>
                    <td>
                      {latest
                        ? <Badge tone={latest.Status === "Approved" ? "success"
                            : latest.Status === "Rejected" ? "danger" : "warning"}>
                            {latest.Type} v{latest.VersionNo} · {latest.Status}
                          </Badge>
                        : "—"}
                    </td>
                    <td>{count}</td>
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
