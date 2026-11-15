# Examples

Each file is a ready-to-use Chart-Output card composition spec.

POST any file directly to the API:

```bash
curl -X POST https://www.chart-output.com/api/v1/render \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d @campaign-performance.json \
  --output chart.png && open chart.png
```

Examples are 1200 px at scale 1 so they run on a Free key. On Pro or Agency you can set `scale` to 2. Free renders carry a small watermark.

Get a free API key at [chart-output.com](https://www.chart-output.com/auth/sign-up).
