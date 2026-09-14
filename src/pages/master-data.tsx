import { useMemo } from "react";
import { PageHead } from "@/components/layout";
import { MasterTable, type FieldSpec } from "@/features/admin/master-table";
import {
  buyers, linesCrud, stylesCrud,
  type Buyer, type Line, type Style,
} from "@/features/data/garment-schemas";
import { useT } from "@/features/i18n/i18n";

/**
 * The factory's reference tables: buyers, styles, lines.
 *
 * One page per table, linked straight from the sidebar, each running the shared
 * config-driven register: search, inline edit, add form, deactivate, delete with
 * confirmation. The rows here are EDITABLE on purpose — master data describes the
 * organisation and changes with it. The registers of record (issues, approvals)
 * are append-only and live elsewhere.
 */
export function BuyersPage() {
  const t = useT();
  const fields: FieldSpec<Buyer>[] = [
    { key: "Name", label: t("col.name"), type: "text", required: true, unique: true },
    { key: "Country", label: t("col.country"), type: "text", required: true },
    { key: "ContactEmail", label: t("col.contact"), type: "text", required: true },
    { key: "PreferredLanguage", label: t("col.reportLanguage"), type: "text" },
    { key: "IsActive", label: t("col.status"), type: "boolean" },
  ];
  return (
    <>
      <PageHead title={t("nav.buyers")} description={t("page.buyers.desc")} />
      <MasterTable
        crud={buyers} fields={fields}
        entity="buyer" entityPlural="buyers"
        sortBy={(a, b) => a.Name.localeCompare(b.Name)}
      />
    </>
  );
}

export function StylesPage() {
  const t = useT();
  const buyerList = buyers.useAll();
  const buyerOptions = useMemo(
    () => (buyerList.data ?? []).map((b) => ({ id: b.ItemId, label: b.Name })),
    [buyerList.data],
  );
  const fields: FieldSpec<Style>[] = [
    /* The code is how every other register names this style; changing it after
     * issues exist detaches them in the reader's mind, so it locks on edit. */
    { key: "StyleCode", label: t("col.code"), type: "text", required: true, unique: true, lockedOnEdit: true },
    { key: "Name", label: t("col.name"), type: "text", required: true },
    { key: "BuyerId", label: t("col.buyer"), type: "ref", required: true, options: buyerOptions },
    { key: "Season", label: t("col.season"), type: "text" },
    { key: "OrderQty", label: t("col.orderQty"), type: "number" },
    { key: "ShipDate", label: t("col.shipDate"), type: "text", placeholder: "2026-11-01" },
    { key: "IsActive", label: t("col.status"), type: "boolean" },
  ];
  return (
    <>
      <PageHead title={t("nav.styles")} description={t("page.styles.desc")} />
      <MasterTable
        crud={stylesCrud} fields={fields}
        entity="style" entityPlural="styles"
        sortBy={(a, b) => a.StyleCode.localeCompare(b.StyleCode)}
      />
    </>
  );
}

export function LinesPage() {
  const t = useT();
  const fields: FieldSpec<Line>[] = [
    { key: "Name", label: t("col.line"), type: "text", required: true, unique: true },
    { key: "PlantId", label: t("col.plant"), type: "text", required: true },
    { key: "SupervisorId", label: t("col.owner"), type: "text" },
    { key: "WorkerCount", label: t("col.workers"), type: "number" },
    { key: "IsActive", label: t("col.status"), type: "boolean" },
  ];
  return (
    <>
      <PageHead title={t("nav.lines")} description={t("page.lines.desc")} />
      <MasterTable
        crud={linesCrud} fields={fields}
        entity="line" entityPlural="lines"
        sortBy={(a, b) => a.Name.localeCompare(b.Name)}
      />
    </>
  );
}
