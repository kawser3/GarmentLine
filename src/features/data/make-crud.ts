import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql, type ActionResponse, type GqlResult } from "./gateway";

/**
 * Operation names are read from each schema's `querySchema` / `mutationSchemas` — never
 * hand-pluralised. The platform generates `getBillingEntrys`, NOT `getBillingEntries`.
 */
export interface CrudNames {
  query: string; // "getWings"
  insert: string; // "insertWing"
  update: string; // "updateWing"
  remove: string; // "deleteWing"
  filterType: string; // "WingFilterInput"
  insertType: string; // "WingInsertInput"
  updateType: string; // "WingUpdateInput"
}

export interface Paging {
  pageNo: number;
  pageSize: number;
}

/**
 * Guards for the single-row mutations.
 *
 * Every update and delete in this application targets exactly one record by `ItemId`. That
 * is worth enforcing centrally rather than trusting each call site, because of how this
 * gateway behaves when the filter is not what you think:
 *
 *   - **An empty `where` matches every row.** `JSON.stringify` drops `undefined`, so a
 *     `{ ItemId: { eq: undefined } }` filter — one bad id, one renamed field — is serialised
 *     as `{"ItemId":{}}` and the mutation applies to the WHOLE collection. A deactivate
 *     becomes a mass deactivate; a delete becomes a wipe.
 *   - **The gateway silently ignores unknown arguments**, so a typo'd filter does not error;
 *     it just stops narrowing.
 *
 * So: refuse to send a mutation that has no concrete id, and afterwards assert the row count
 * the gateway reports is the one row we aimed at. `totalImpactedData > 1` means the filter
 * leaked — the damage is already done, but it is reported loudly instead of silently.
 */
function singleTargetId(where: unknown): string {
  const id = (where as { ItemId?: { eq?: unknown } } | null | undefined)?.ItemId?.eq;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(
      "Refused to run: this change had no record id to target, and an empty filter matches " +
        "every row in the collection. Reload the page and try again.",
    );
  }
  return id;
}

function assertSingleRow(op: string, res: ActionResponse, id: string): ActionResponse {
  if (!res.acknowledged) {
    throw new Error(res.message ?? `The gateway did not acknowledge the ${op}.`);
  }
  if (res.totalImpactedData > 1) {
    throw new Error(
      `The ${op} changed ${res.totalImpactedData} records when it should have changed one ` +
        `(${id}). Reload and check the data before making further changes.`,
    );
  }
  /*
   * The gateway echoes the row it acted on. `update<Schema>` / `delete<Schema>` are the
   * SINGULAR forms — given a filter they do not honour, they act on one arbitrary row rather
   * than erroring, which is how a deactivate or a delete ends up hitting a record the user
   * never picked. Comparing the echo against the id we targeted is the only way to catch
   * that from the client, so it is checked on every single-row mutation.
   */
  if (res.itemId && res.itemId !== id) {
    throw new Error(
      `The ${op} was applied to a different record (${res.itemId}) than the one selected ` +
        `(${id}). Reload the page and check the data — the gateway did not honour the filter.`,
    );
  }
  return res;
}

/**
 * NOTE ON SORTING AND PAGING.
 *
 * `get<Schema>` does accept `order` (the gateway playground documents `order: [...]`, entries
 * shaped `{ direction, field }`). It is not used here: the collections are small enough to
 * sort client-side, and the gateway silently IGNORES unknown arguments, so a wrong field or
 * enum spelling would look like it worked while doing nothing. Sorting therefore stays with
 * the callers, where it is visible and testable.
 *
 * Two consequences the callers must respect:
 *
 *  1. Rows arrive in whatever order the gateway chose, and that order is NOT stable between
 *     fetches. Array.sort is stable, so rows comparing equal keep their arrival order — a
 *     refetch could reshuffle visually identical rows and make a mutation look as though it
 *     hit the wrong record. Every list sort therefore ends with an ItemId tie-break.
 *  2. Unordered paging can return the same row on two pages. `useAll` pages at 500 and some
 *     collections are larger than that (billing runs to ~800 rows), and a duplicated row
 *     would be summed twice — silently inflating money on the dashboard. `useAll` therefore
 *     de-duplicates on ItemId before returning.
 */
export function makeCrud<TRecord, TInsert, TUpdate>(
  names: CrudNames,
  fieldSelection: string,
) {
  const listKey = ["data", names.query] as const;

  function useList(vars: { where?: unknown; paging?: Paging } = {}) {
    return useQuery({
      queryKey: [...listKey, vars],
      queryFn: () =>
        gql<Record<string, GqlResult<TRecord>>>(
          `query($where:${names.filterType},$paging:PaginationInput){
             ${names.query}(where:$where,paging:$paging){
               totalCount pageNo pageSize totalPages hasNextPage hasPreviousPage
               items { ${fieldSelection} }
             }
           }`,
          vars,
        ).then((d) => d[names.query]),
    });
  }

  /**
   * Fetch every record, paging until the set is complete.
   *
   * Pages rather than assuming one big page: a single pageSize=1000 request silently
   * truncates once a collection outgrows it, and a dashboard quietly missing the oldest
   * months is worse than a slower query. Used for the master collections the UI caches to
   * resolve names, and for multi-period reporting where the range is chosen client-side.
   */
  function useAll() {
    return useQuery({
      queryKey: [...listKey, "all"],
      queryFn: async () => {
        const out: TRecord[] = [];
        const pageSize = 500;
        for (let page = 1; ; page += 1) {
          const d = await gql<Record<string, GqlResult<TRecord>>>(
            `query{ ${names.query}(paging:{pageNo:${page},pageSize:${pageSize}}){
                totalCount items { ${fieldSelection} } } }`,
          );
          const res = d[names.query];
          out.push(...res.items);
          if (res.items.length < pageSize || out.length >= res.totalCount) break;
          // Backstop: never loop forever on an endpoint that ignores paging.
          if (page > 40) break;
        }
        /*
         * De-duplicate on ItemId. Paging without an ORDER BY is not guaranteed to partition
         * the collection, so the same row can appear on two pages — and for billing rows that
         * means an amount counted twice in every total that reads this list. Keeps the first
         * occurrence, so ordering is otherwise untouched.
         */
        const seen = new Set<string>();
        return out.filter((row) => {
          const id = (row as { ItemId?: string }).ItemId;
          if (typeof id !== "string" || id === "") return true;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
      },
      staleTime: 5 * 60 * 1000,
    });
  }

  function useCreate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (input: TInsert) =>
        gql<Record<string, ActionResponse>>(
          `mutation($input:${names.insertType}!){
             ${names.insert}(input:$input){ acknowledged itemId totalImpactedData message } }`,
          { input },
        ).then((d) => d[names.insert]),
      // Invalidate the whole listKey prefix so the dashboard's useAll cache (keyed under
      // [...listKey, "all"]) drops too. Without the prefix match, mutations through one
      // page leave other pages showing the stale set until the 5-minute staleTime expires.
      onSuccess: () => qc.invalidateQueries({ queryKey: listKey, exact: false }),
    });
  }

  /*
   * The raw single-row mutations, WITHOUT cache invalidation.
   *
   * These exist for bulk work. `useUpdate`/`useDelete` invalidate on every success, which is
   * right for one row and wrong for two hundred: a bulk deactivate of 131 templates would fire
   * 131 invalidations, each refetching the whole collection, so the run spends most of its time
   * re-reading rows it is about to change again. Bulk callers loop these and invalidate once at
   * the end via `useInvalidate`.
   *
   * The safety checks are NOT skipped — `singleTargetId` and `assertSingleRow` still run per
   * row, because the gateway's singular mutations hit an arbitrary record on a filter they do
   * not honour, and a bulk run is the worst place to let that pass unnoticed.
   */
  async function updateOne(itemId: string, input: TUpdate) {
    const where = { ItemId: { eq: itemId } };
    const id = singleTargetId(where);
    const d = await gql<Record<string, ActionResponse>>(
      `mutation($where:${names.filterType},$input:${names.updateType}!){
         ${names.update}(where:$where,input:$input){
           acknowledged itemId totalImpactedData message } }`,
      { where, input },
    );
    return assertSingleRow("update", d[names.update], id);
  }

  async function deleteOne(itemId: string) {
    const where = { ItemId: { eq: itemId } };
    const id = singleTargetId(where);
    /*
     * `input` is part of the delete contract — omitting it leaves the hard/soft choice to
     * the gateway's default. `isHardDelete: false` is the documented soft delete: the row
     * stops being returned by queries but is recoverable, which is the right default for
     * a button a person can press by accident. Inlined rather than passed as a typed
     * variable so no `<Schema>DeleteInput` type name has to be guessed (introspection is
     * disabled on this gateway, so a wrong guess would fail at runtime, not at build).
     */
    const d = await gql<Record<string, ActionResponse>>(
      `mutation($where:${names.filterType}){
         ${names.remove}(where:$where,input:{isHardDelete:false}){
           acknowledged itemId totalImpactedData message } }`,
      { where },
    );
    return assertSingleRow("delete", d[names.remove], id);
  }

  /** Drops every cached list for this schema. Call once after a bulk run. */
  function useInvalidate() {
    const qc = useQueryClient();
    return useCallback(
      () => qc.invalidateQueries({ queryKey: listKey, exact: false }),
      [qc],
    );
  }

  function useUpdate() {
    const qc = useQueryClient();
    return useMutation({
      // Delegates to updateOne so the query text and the safety checks have one home.
      mutationFn: (v: { where: unknown; input: TUpdate }) =>
        updateOne(singleTargetId(v.where), v.input),
      onSuccess: () => qc.invalidateQueries({ queryKey: listKey, exact: false }),
    });
  }

  function useDelete() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (where: unknown) => deleteOne(singleTargetId(where)),
      onSuccess: () => qc.invalidateQueries({ queryKey: listKey, exact: false }),
    });
  }

  return {
    names,
    useList,
    useAll,
    useCreate,
    useUpdate,
    useDelete,
    updateOne,
    deleteOne,
    useInvalidate,
  };
}

/** Every entity carries these platform-managed fields; we never declare them in a schema. */
export interface SystemFields {
  ItemId: string;
  CreatedDate?: string;
  LastUpdatedDate?: string;
}

/**
 * Structural view of what makeCrud returns, narrowed to what generic components need.
 *
 * Declared explicitly rather than as `ReturnType<typeof makeCrud<T, I, U>>`: TypeScript
 * cannot invert `ReturnType`, so a component taking that type infers `T` as its constraint
 * instead of the real entity. Spelling the shape out puts `T`/`I`/`U` in inferrable
 * positions, so `<MasterTable crud={wings} …>` correctly infers `T = Wing`.
 */
export interface CrudApi<T, I, U> {
  names: CrudNames;
  useAll: () => { data: T[] | undefined; isPending: boolean; error: Error | null };
  useCreate: () => {
    mutateAsync: (input: I) => Promise<ActionResponse>;
    isPending: boolean;
    error: Error | null;
  };
  useUpdate: () => {
    mutateAsync: (v: { where: unknown; input: U }) => Promise<ActionResponse>;
    isPending: boolean;
    error: Error | null;
  };
  useDelete: () => {
    mutateAsync: (where: unknown) => Promise<ActionResponse>;
    isPending: boolean;
    error: Error | null;
  };
  /* The bulk primitives — single-row writes that do NOT invalidate. See the note above them. */
  updateOne: (itemId: string, input: U) => Promise<ActionResponse>;
  deleteOne: (itemId: string) => Promise<ActionResponse>;
  useInvalidate: () => () => Promise<void>;
}
