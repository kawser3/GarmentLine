import { useEffect, useState } from "react";
import { Badge, Card, Empty, ErrorAlert, Loading, TableWrap } from "@/components/ui";
import { PageHead } from "@/components/layout";
import { ROLE_LABELS } from "@/stores/auth";
import { useT } from "@/features/i18n/i18n";
import { api } from "@/lib/blocks-api";

interface IamUser {
  itemId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  active?: boolean;
  roles?: string[] | Record<string, string[]>;
}

function rolesOfRow(u: IamUser): string[] {
  const raw = u.roles as unknown;
  if (Array.isArray(raw)) return raw.filter((r): r is string => typeof r === "string");
  if (raw && typeof raw === "object") {
    return Object.values(raw as Record<string, unknown>)
      .flatMap((v) => (Array.isArray(v) ? v : []))
      .filter((r): r is string => typeof r === "string");
  }
  return [];
}

/**
 * Read-only for now. Inviting a user is an IAM write that creates an INACTIVE account
 * needing an emailed activation link, so it belongs with the provisioning scripts rather
 * than behind a button that looks instant and is not.
 */
export function UsersPage() {
  const t = useT();
  const [rows, setRows] = useState<IamUser[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    api<{ data?: IamUser[] }>("/iam/v4/iam/users", {
      method: "POST",
      body: JSON.stringify({ page: 0, pageSize: 100, filter: {} }),
    })
      .then((r) => { if (live) setRows(r.data ?? []); })
      .catch((e) => { if (live) setError(e); });
    return () => { live = false; };
  }, []);

  if (error) return <ErrorAlert error={error} />;
  if (!rows) return <Loading label="Loading people…" />;

  return (
    <>
      <PageHead
        title={t("nav.people")}
        description={t("page.people.desc")}
      />
      <div className="grid one">
        <Card title={t("page.people.card")} sub={t("page.people.cardSub")}>
          {rows.length === 0 ? <Empty title="No users yet" /> : (
            <TableWrap>
              <thead><tr><th>{t("col.name")}</th><th>{t("col.email")}</th><th>{t("col.roles")}</th><th>{t("col.status")}</th></tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.itemId}>
                    <td><strong>{[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}</strong></td>
                    <td>{u.email}</td>
                    <td>
                      {rolesOfRow(u).map((r) => (
                        <Badge key={r}>{ROLE_LABELS[r] ?? r}</Badge>
                      ))}
                    </td>
                    <td>
                      {u.active === false
                        ? <Badge tone="warning">Inactive</Badge>
                        : <Badge tone="success">Active</Badge>}
                    </td>
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
