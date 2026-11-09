# Privilege A2A Anthropic demo

Three Node processes that show an access review through A2A and MCP, on Anthropic or Google models.

## Run and test

```sh
npm ci
npm test
```

## Rules that bite

- No real tenant ids, client ids, customer names or internal hostnames. Use `.example` or `.invalid` hosts only.
- Never commit `.env` files or keys. Copy `config.example` to `.env` and fill it in locally (optional; with no `.env` the app starts offline).
- Mock mode works fully offline. Live mode is optional.
