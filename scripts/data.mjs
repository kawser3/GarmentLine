// Thin GraphQL data helpers over the Blocks Data gateway.
//
// Verified operation shapes on this tenant:
//   query    getIncidents(where: IncidentFilterInput, order: [...],
//                         paging: {pageNo, pageSize})
//              -> { items, totalCount, pageNo, pageSize, totalPages, hasNextPage }
//   insert   insertIncident(input: IncidentInsertInput)   -> { itemId }
//   bulk     insertManyIncident(input: [IncidentInsertInput])
//   update   updateIncident(where: FilterInput, input: UpdateInput)
//   delete   deleteIncident(where: FilterInput, input: {isHardDelete: Boolean!})
//
// Note paging is 1-based: pageNo 0 makes the service compute a negative skip
// and return a 500.

export const PAGE = 200;

export function makeData(s) {
  return {
    async query(name, { where, order, pageNo = 1, pageSize = PAGE, fields = 'ItemId' } = {}) {
      const q = `query($w: ${name}FilterInput, $p: PaginationInput){
        get${plural(name)}(where:$w, paging:$p){ totalCount pageNo totalPages hasNextPage items{ ${fields} } }
      }`;
      const d = await s.gql(q, { w: where ?? null, p: { pageNo, pageSize } });
      return d[`get${plural(name)}`];
    },

    // Walks every page so callers never silently truncate at 200.
    async all(name, opts = {}) {
      const out = [];
      for (let page = 1; ; page++) {
        const r = await this.query(name, { ...opts, pageNo: page });
        out.push(...r.items);
        if (!r.hasNextPage) return out;
      }
    },

    async count(name, where) {
      const r = await this.query(name, { where, pageSize: 1 });
      return r.totalCount;
    },

    async insert(name, input) {
      const d = await s.gql(`mutation($i: ${name}InsertInput){ insert${name}(input:$i){ itemId } }`, { i: input });
      return d[`insert${name}`].itemId;
    },

    // insertMany in chunks - one large payload is rejected outright.
    async insertMany(name, rows, chunk = 25) {
      let n = 0;
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk);
        await s.gql(`mutation($i: [${name}InsertInput]){ insertMany${name}(input:$i){ itemIds totalImpactedData } }`,
          { i: slice });
        n += slice.length;
      }
      return n;
    },

    async update(name, where, input) {
      const d = await s.gql(
        `mutation($w: ${name}FilterInput, $i: ${name}UpdateInput){ update${name}(where:$w, input:$i){ totalImpactedData } }`,
        { w: where, i: input });
      return d[`update${name}`];
    },

    /**
     * Purge a whole collection. Deliberately takes NO where: an extra argument
     * is rejected rather than ignored — on 5 Sept 2026 a probe passed a where
     * here, the argument was silently dropped, and the entire MonitoringEvent
     * inbox went with it. If you need a narrowed delete, write the mutation
     * yourself with a concrete id and assert the affected count afterwards.
     */
    async deleteAll(name, ...extra) {
      if (extra.length > 0) {
        throw new Error(`deleteAll(${name}) purges the WHOLE collection and takes no filter — you passed ${extra.length} extra argument(s). Write a narrowed deleteMany mutation with a concrete id instead.`);
      }
      const d = await s.gql(
        `mutation($w: ${name}FilterInput){ deleteMany${name}(where:$w, input:{isHardDelete:true}){ totalImpactedData } }`,
        { w: {} });
      return d[`deleteMany${name}`];
    },
  };
}

// Blocks pluralises naively: Incident -> Incidents, SlaPolicy -> SlaPolicys.
// Never hand-derive these in app code - read generated/schema-map.json.
const plural = n => `${n}s`;
