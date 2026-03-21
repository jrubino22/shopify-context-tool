# shopify-context-tool

Exports a full Shopify store snapshot to a single JSON file. Drop the output into a conversation as context so an LLM has all the GIDs, handles, metaobject entries, and metafield definitions it needs to generate precise, ready-to-run operations.

## Setup

```bash
npm install
cp .env.example .env
# fill in SHOP_URL and ACCESS_TOKEN
```

### Required API scopes

Your custom app token needs:
- `read_products`
- `read_content`
- `read_metaobjects`

## Usage

```bash
# Export to store-context.json (minified)
node index.js export

# Export with pretty-printed JSON (easier to read)
node index.js export --pretty

# Export to a custom path
node index.js export --out snapshots/2026-03-20.json

# npm shortcuts
npm run export
npm run export:pretty
```

## Output shape

```json
{
  "exportedAt": "2026-03-20T12:00:00.000Z",
  "shop": "your-store.myshopify.com",
  "products": [
    {
      "id": "gid://shopify/Product/123",
      "handle": "smittybilt-recoil-kinetic-recovery-rope",
      "title": "Smittybilt Recoil Kinetic Recovery Rope",
      "status": "ACTIVE",
      "vendor": "Smittybilt",
      "tags": ["Stage 1", "Recovery"],
      "variants": [...],
      "metafields": [...]
    }
  ],
  "collections": [...],
  "pages": [...],
  "metaobjects": {
    "overland_vehicle": {
      "definition": { "id": "gid://...", "type": "overland_vehicle", "fieldDefinitions": [...] },
      "entries": [
        {
          "id": "gid://shopify/Metaobject/456",
          "handle": "tacoma-gen3-5ft",
          "displayName": "Tacoma Gen 3 – 5ft Bed",
          "fields": {
            "make":  { "value": "Toyota", "type": "single_line_text_field" },
            "model": { "value": "Tacoma", "type": "single_line_text_field" }
          }
        }
      ]
    }
  },
  "metafieldDefinitions": {
    "PRODUCT": [...],
    "COLLECTION": [...],
    "PAGE": [...]
  }
}
```

## Notes

- `store-context.json` is gitignored — it may contain sensitive store data
- The tool is read-only — it makes no mutations to your store
- Rate limit delay of 250ms between paginated requests matches the metaobject-creator tool
