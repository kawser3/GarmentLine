import { Card, Empty, ErrorAlert, Loading, TableWrap } from "@/components/ui";
import { PageHead } from "@/components/layout";
import { buyers, linesCrud, stylesCrud } from "@/features/data/garment-schemas";
import { useI18nStore, useT } from "@/features/i18n/i18n";
import { formatDate } from "@/lib/format";

/**
 * The factory's reference tables: buyers, styles, lines.
 *
 * One page per table, linked straight from the sidebar — the configuration group
 * is the order of the app: production first, the records it links to after. Each
 * page is a full-width card; the grid wrapper owns the spacing between blocks.
 */
export function BuyersPage() {
  const t = useT();
  const q = buyers.useAll();
  if (q.error) return <ErrorAlert error={q.error} />;
  if (q.isPending) return <Loading label="Loading buyers…" />;
  const rows = q.data ?? [];
  return (
    <>
      <PageHead
        title={t("nav.buyers")}
        description={t("page.buyers.desc")}
      />
      <div className="grid one">
        <Card title={t("page.buyers.card")} sub={t("page.buyers.cardSub")}>
          {rows.length === 0 ? <Empty title="No buyers" /> : (
            <TableWrap>
              <thead><tr><th>{t("col.name")}</th><th>{t("col.country")}</th><th>{t("col.contact")}</th><th>{t("col.reportLanguage")}</th></tr></thead>
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
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}

export function StylesPage() {
  const locale = useI18nStore((s) => s.locale);
  const t = useT();
  const q = stylesCrud.useAll();
  const b = buyers.useAll();
  if (q.error) return <ErrorAlert error={q.error} />;
  if (q.isPending) return <Loading label="Loading styles…" />;
  const buyerName = new Map((b.data ?? []).map((x) => [x.ItemId, x.Name]));
  const rows = q.data ?? [];
  return (
    <>
      <PageHead
        title={t("nav.styles")}
        description={t("page.styles.desc")}
      />
      <div className="grid one">
        <Card title={t("page.styles.card")} sub={t("page.styles.cardSub")}>
          {rows.length === 0 ? <Empty title="No styles" /> : (
            <TableWrap>
              <thead>
                <tr><th>{t("col.code")}</th><th>{t("col.name")}</th><th>{t("col.buyer")}</th><th>{t("col.season")}</th><th>{t("col.orderQty")}</th><th>{t("col.shipDate")}</th></tr>
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
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}

export function LinesPage() {
  const t = useT();
  const q = linesCrud.useAll();
  if (q.error) return <ErrorAlert error={q.error} />;
  if (q.isPending) return <Loading label="Loading lines…" />;
  const rows = q.data ?? [];
  return (
    <>
      <PageHead
        title={t("nav.lines")}
        description={t("page.lines.desc")}
      />
      <div className="grid one">
        <Card title={t("page.lines.card")} sub={t("page.lines.cardSub")}>
          {rows.length === 0 ? <Empty title="No lines" /> : (
            <TableWrap>
              <thead><tr><th>{t("col.line")}</th><th>{t("col.plant")}</th><th>{t("col.workers")}</th></tr></thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.ItemId}>
                    <td><strong>{l.Name}</strong></td>
                    <td>{l.PlantId}</td>
                    <td>{l.WorkerCount?.toLocaleString() ?? "—"}</td>
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
