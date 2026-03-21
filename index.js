/**
 * shopify-context-tool
 *
 * Exports a full store snapshot to a single JSON file for use as context
 * when generating metafield definitions, assignments, and other store operations.
 *
 * Commands:
 *   node index.js export                  Export full store snapshot to store-context.json
 *   node index.js export --pretty         Export with pretty-printed JSON
 *   node index.js export --out <file>     Export to a custom output path
 *
 * Exports:
 *   - Products (with variants and existing metafields)
 *   - Metaobjects (all types and entries, with field values)
 *   - Collections
 *   - Pages
 *   - Metafield definitions (on Product, Collection, Page resources)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

dotenv.config();

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const API_VERSION = process.env.API_VERSION || "2025-01";

const SHOP_URL     = process.env.SHOP_URL;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

// Resources to export metafield definitions for
const METAFIELD_DEFINITION_OWNERS = [
  "PRODUCT",
  "COLLECTION",
  "PAGE",
];

// ─── Logging ──────────────────────────────────────────────────────────────────
const log     = (msg) => console.log(`  ${msg}`);
const ok      = (msg) => console.log(`✅ ${msg}`);
const fail    = (msg) => { console.error(`❌ ${msg}`); process.exit(1); };
const divider = (msg) => console.log(`\n${"─".repeat(60)}\n  ${msg}\n${"─".repeat(60)}`);
const sleep   = (ms)  => new Promise((r) => setTimeout(r, ms));

// ─── GraphQL client ───────────────────────────────────────────────────────────
async function gql(query, variables = {}) {
  const res = await fetch(
    `https://${SHOP_URL}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type":           "application/json",
        "X-Shopify-Access-Token": ACCESS_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const json = await res.json();

  if (json.errors?.length) {
    throw new Error(`GraphQL errors:\n${JSON.stringify(json.errors, null, 2)}`);
  }

  return json.data;
}

// ─── Pagination helper ────────────────────────────────────────────────────────
// Fetches all pages of a paginated query. The query must accept $cursor and
// return a connection at `data[connectionKey]` with edges.node and pageInfo.
async function fetchAllPages(query, variables = {}, connectionKey) {
  const all    = [];
  let cursor   = null;

  while (true) {
    const data = await gql(query, { ...variables, cursor });
    const connection = data[connectionKey];

    if (!connection) break;

    all.push(...connection.edges.map((e) => e.node));

    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
    await sleep(250);
  }

  return all;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

const PRODUCTS_QUERY = `
  query GetProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      edges {
        node {
          id
          handle
          title
          status
          productType
          vendor
          tags
          variants(first: 10) {
            edges {
              node {
                id
                title
                sku
                price
                compareAtPrice
                inventoryQuantity
              }
            }
          }
          metafields(first: 20) {
            edges {
              node {
                id
                namespace
                key
                type
                value
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const COLLECTIONS_QUERY = `
  query GetCollections($cursor: String) {
    collections(first: 50, after: $cursor) {
      edges {
        node {
          id
          handle
          title
          description
          metafields(first: 10) {
            edges {
              node {
                id
                namespace
                key
                type
                value
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PAGES_QUERY = `
  query GetPages($cursor: String) {
    pages(first: 50, after: $cursor) {
      edges {
        node {
          id
          handle
          title
          metafields(first: 10) {
            edges {
              node {
                id
                namespace
                key
                type
                value
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const METAOBJECT_TYPES_QUERY = `
  query GetMetaobjectDefinitions($cursor: String) {
    metaobjectDefinitions(first: 50, after: $cursor) {
      edges {
        node {
          id
          type
          name
          fieldDefinitions {
            key
            name
            required
            type { name }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const METAOBJECT_ENTRIES_QUERY = `
  query GetMetaobjectEntries($type: String!, $cursor: String) {
    metaobjects(type: $type, first: 50, after: $cursor) {
      edges {
        node {
          id
          handle
          displayName
          fields {
            key
            value
            type
            references(first: 10) {
              edges {
                node {
                  ... on Metaobject {
                    id
                    handle
                    type
                  }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const METAFIELD_DEFINITIONS_QUERY = `
  query GetMetafieldDefinitions($ownerType: MetafieldOwnerType!, $cursor: String) {
    metafieldDefinitions(ownerType: $ownerType, first: 50, after: $cursor) {
      edges {
        node {
          id
          name
          namespace
          key
          type { name }
          ownerType
          validations {
            name
            value
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchProducts() {
  divider("Fetching products");
  const raw = await fetchAllPages(PRODUCTS_QUERY, {}, "products");

  const products = raw.map((p) => ({
    id:          p.id,
    handle:      p.handle,
    title:       p.title,
    status:      p.status,
    productType: p.productType,
    vendor:      p.vendor,
    tags:        p.tags,
    variants:    p.variants.edges.map((e) => e.node),
    metafields:  p.metafields.edges.map((e) => e.node),
  }));

  ok(`Fetched ${products.length} products`);
  return products;
}

async function fetchCollections() {
  divider("Fetching collections");
  const raw = await fetchAllPages(COLLECTIONS_QUERY, {}, "collections");

  const collections = raw.map((c) => ({
    id:          c.id,
    handle:      c.handle,
    title:       c.title,
    description: c.description,
    metafields:  c.metafields.edges.map((e) => e.node),
  }));

  ok(`Fetched ${collections.length} collections`);
  return collections;
}

async function fetchPages() {
  divider("Fetching pages");
  const raw = await fetchAllPages(PAGES_QUERY, {}, "pages");

  const pages = raw.map((p) => ({
    id:         p.id,
    handle:     p.handle,
    title:      p.title,
    metafields: p.metafields.edges.map((e) => e.node),
  }));

  ok(`Fetched ${pages.length} pages`);
  return pages;
}

async function fetchMetaobjects() {
  divider("Fetching metaobjects");

  // First get all definitions
  const definitions = await fetchAllPages(
    METAOBJECT_TYPES_QUERY,
    {},
    "metaobjectDefinitions"
  );

  log(`Found ${definitions.length} metaobject definition(s): ${definitions.map((d) => d.type).join(", ")}`);

  // Then fetch entries for each type
  const result = {};

  for (const def of definitions) {
    log(`Fetching entries for type: ${def.type}`);

    const rawEntries = await fetchAllPages(
      METAOBJECT_ENTRIES_QUERY,
      { type: def.type },
      "metaobjects"
    );

    const entries = rawEntries.map((entry) => {
      const fields = {};
      for (const f of entry.fields) {
        // If there are references, include both the raw value and resolved references
        const references = f.references?.edges?.map((e) => e.node) ?? [];
        fields[f.key] = references.length
          ? { value: f.value, type: f.type, references }
          : { value: f.value, type: f.type };
      }

      return {
        id:          entry.id,
        handle:      entry.handle,
        displayName: entry.displayName,
        fields,
      };
    });

    result[def.type] = {
      definition: {
        id:               def.id,
        type:             def.type,
        name:             def.name,
        fieldDefinitions: def.fieldDefinitions,
      },
      entries,
    };

    ok(`  ${def.type}: ${entries.length} entries`);
    await sleep(250);
  }

  return result;
}

async function fetchMetafieldDefinitions() {
  divider("Fetching metafield definitions");

  const result = {};

  for (const ownerType of METAFIELD_DEFINITION_OWNERS) {
    const defs = await fetchAllPages(
      METAFIELD_DEFINITIONS_QUERY,
      { ownerType },
      "metafieldDefinitions"
    );

    result[ownerType] = defs;
    log(`${ownerType}: ${defs.length} definition(s)`);
    await sleep(250);
  }

  ok("Fetched metafield definitions");
  return result;
}

// ─── Validate environment ─────────────────────────────────────────────────────
function validateEnv() {
  if (!SHOP_URL)     fail("Missing SHOP_URL in .env");
  if (!ACCESS_TOKEN) fail("Missing ACCESS_TOKEN in .env");
}

// ─── CLI entry ────────────────────────────────────────────────────────────────
const [,, command, ...args] = process.argv;

async function main() {
  validateEnv();

  if (command !== "export") {
    console.log(`
Shopify Context Tool

Usage:
  node index.js export                   Export store snapshot to store-context.json
  node index.js export --pretty          Export with pretty-printed JSON
  node index.js export --out <file>      Export to a custom output path

Exports:
  - Products (with variants and metafields)
  - Collections (with metafields)
  - Pages (with metafields)
  - Metaobjects (all types, definitions, and entries with field values)
  - Metafield definitions (Product, Collection, Page)

Config:
  Copy .env.example to .env and fill in SHOP_URL and ACCESS_TOKEN

Required API scopes:
  read_products, read_content, read_metaobjects, read_metaobject_definitions
`);
    process.exit(0);
  }

  const pretty  = args.includes("--pretty");
  const outIdx  = args.indexOf("--out");
  const outFile = outIdx !== -1 ? args[outIdx + 1] : "store-context.json";

  if (!outFile) fail("--out requires a file path argument");

  console.log(`\n🔍 Exporting store context from ${SHOP_URL}...\n`);

  const [products, collections, pages, metaobjects, metafieldDefinitions] =
    await Promise.all([
      fetchProducts(),
      fetchCollections(),
      fetchPages(),
      fetchMetaobjects(),
      fetchMetafieldDefinitions(),
    ]);

  const context = {
    exportedAt: new Date().toISOString(),
    shop:       SHOP_URL,
    products,
    collections,
    pages,
    metaobjects,
    metafieldDefinitions,
  };

  const json = pretty
    ? JSON.stringify(context, null, 2)
    : JSON.stringify(context);

  const outPath = path.resolve(outFile);
  fs.writeFileSync(outPath, json, "utf-8");

  console.log(`
${"─".repeat(60)}
  EXPORT COMPLETE
${"─".repeat(60)}
  Products            : ${products.length}
  Collections         : ${collections.length}
  Pages               : ${pages.length}
  Metaobject types    : ${Object.keys(metaobjects).length}
  Output              : ${outPath}
${"─".repeat(60)}
`);
}

main().catch((e) => fail(e.message));
